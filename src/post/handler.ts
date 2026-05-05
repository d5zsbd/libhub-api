import type { Client, ResultSet } from "@libsql/client";
import type { RequestHandler } from "express";
import { contentFilter, type ContentNode } from "./index.js";
import { getImageIds, getUnlinkedImageIds, linkPostImages } from "../image.js";
import { isErr, validatePostId, validatePage, validatePost, validateUpdatePost, validateParamUserId } from "./validation.js";
import { hasNoTags, createPost as createPostService, createTags, getTags, linkPostTags, getPost, updatePost, getPubPosts, getDrafts, hitPost } from "./service.js";
import { notifyComment, notifyFavorite, notifyFollower, notifyLike, notifyReply } from "../notification/service.js";

export function createPost(db: Client): RequestHandler {
  return async (req, res) => {
    // 目前只有user和admin能发帖
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no user' });

    const validateResult = validatePost(req.body);
    if (isErr(validateResult)) return res.status(400).json({ error: 'wrong fields', errors: validateResult.err });

    const { title, unsafeNodes, tags, visibility, status } = validateResult.ok;

    // 恶意请求传给集中错误处理
    // images 在帖子保存前就已经上传
    const { content, hasContent, images, text } = contentFilter(unsafeNodes as ContentNode[]);
    if (!hasContent) return res.status(400).json({ error: 'no content' });

    // 后面创建tag时存在并发风险(tag在其他请求中创建了)
    const noTags = await hasNoTags(tags, db);

    const imageIds = await getImageIds(images, db);

    // 数据库错误留给express5捕获
    const trx = await db.transaction();

    try { 
      if (noTags.length > 0) await createTags(noTags, trx);

      const postId = await createPostService({
        title,
        content: JSON.stringify(content),
        user_id: req.role.id,
        visibility: visibility ? 1 : 0,
        status: status === 'publish' ? 1 : 0
      }, text, trx);

      const tagRows = await getTags(tags, trx);

      await linkPostTags(postId, tagRows, trx);

      if (imageIds.length !== 0) await linkPostImages(postId, imageIds, trx); // 把帖子对图片的引用注册在中间表

      await notifyFollower(postId, trx);
      
      await trx.commit();
      res.status(201).json({ success: true, id: postId });
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  };
}

export function createUpdateContent(db: Client): RequestHandler {
  return async (req, res) => {
    const role = req.role;
    if (role.type === 'guest') return res.status(401).json({ error: 'no authentication' });

    const validateResult = validateUpdatePost(req.body);
    if (isErr(validateResult)) return res.status(400).json({ error: 'wrong fields', errors: validateResult.err });
    const { postId, unsafeNodes } = validateResult.ok;

    const { content: newContent, hasContent, images } = contentFilter(unsafeNodes);
    if (!hasContent) return res.status(400).json({ error: 'no content' });
  
    const post = await getPost(postId, db);
    if (!post) return res.status(401).json({ error: 'no post' });
    if (post.user_id !== role.id) return res.status(401).json({ error: 'no authentication' });

    // 需要实现查找未关联的image
    const imageIds = await getUnlinkedImageIds(postId, images, db);

    const trx = await db.transaction();
    try {
      if (imageIds.length !== 0) await linkPostImages(postId, imageIds, trx); 

      const content = JSON.stringify(newContent);
      
      await trx.execute({
        sql: 'INSERT INTO posts_contents(post_id, content, version) VALUES (?, ?, ?)',
        args: [post.id, post.content, post.version]
      });

      await trx.execute({
        sql: 'UPDATE posts SET content = ?, version = ? WHERE posts.id = ?',
        args: [content, post.version + 1, post.id]
      });

      trx.commit();
      res.json({ success: true });
    } catch (error) {
      trx.rollback();
      throw error;
    }
  }
}

export function createUpdatePost(db: Client): RequestHandler {
  return async (req, res) => {
    const role = req.role;
    if (role.type === 'guest') return res.status(401).json({ error: 'no authentication' });

    // 目前可以修改content，visibility和status，但是如果版本化的话content应该是不可变数据
    // const { postId, content: newContent, visibility: newVisibility, status: newStatus } = req.body;
    const validateResult = validateUpdatePost(req.body);
    if (isErr(validateResult)) return res.status(400).json({ error: 'wrong fields', errors: validateResult.err });
    const { postId, unsafeNodes, visibility: newVisibility, status: newStatus } = validateResult.ok;

    const { content: newContent, hasContent, images } = contentFilter(unsafeNodes);
    if (!hasContent) return res.status(400).json({ error: 'no content' });

    if (role.type === 'user' && newStatus === 'blocked') {
      return res.status(401).json({ error: 'no authentication' });
    }
  
    const post = await getPost(postId, db);
    if (!post) return res.status(401).json({ error: 'no post' });

    // 需要实现查找未关联的image
    const imageIds = await getUnlinkedImageIds(postId, images, db);

    const trx = await db.transaction();
    try {
      if (imageIds.length !== 0) await linkPostImages(postId, imageIds, trx); 

      const content = newContent ? JSON.stringify(newContent) : post.content;
      const visibility = (() => {
        if (newVisibility !== undefined) {
          return newVisibility ? 1 : 0;
        } else {
          return post.visibility;
        }
      })();
      const status = (() => {
        if (newStatus !== undefined) {
          switch (newStatus) {
          case "draft": return 0;
          case "publish": return 1;
          case "blocked": return 2;
          }
        } else {
          return post.status;
        }
      })();

      await updatePost(postId, {
        content,
        visibility,
        status
      }, trx);

      trx.commit();
      res.json({ success: true });
    } catch (error) {
      trx.rollback();
      throw error;
    }
  }
}

export function createDeletePost(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no authentication' });

    const { id } = req.body;
    
    const postId = validatePostId(id);
    if (isErr(postId)) return res.status(400).json({ error: postId.err });

    const result = await db.execute({
      sql: 'UPDATE posts SET status = 3, deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      args: [postId.ok, req.role.id]
    });

    res.json({ success: result.rowsAffected !== 0 });
  }
}

export function createGetPost(db: Client): RequestHandler {
  return async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'no post id' });
    else if (typeof id !== 'string') return res.status(400).json({ error: 'invalid post id' });

    const postId = Number.parseInt(id);
    if (!Number.isInteger(postId)) return res.status(400).json({ error: 'invalid post id' });

    const post = await getPost(postId, db);
    if (!post) return res.status(404).json({ error: 'no post' });

    // 帖子不可见的情况
    // 重置成sql搜索
    if (post.visibility === 0) {
      // 之后研究switch穷尽性检查
      switch (req.role.type) {
      case "guest":
      return res.status(401).json({ error: 'no authentication' });
      case "user":
      return res.status(401).json({ error: 'no authentication' });
      case "admin":
      break;
      }
    }

    switch (post.status) {
    case 0: // 私有状态
      switch (req.role.type) {
      case "guest":
      return res.status(401).json({ error: 'no authentication' });
      case "user":
        if (post.user_id !== req.role.id) return res.status(401).json({ error: 'no authentication' });
      break;
      case "admin":
      break;
      }
    break;
    case 1: // 公开状态
    break; // 公开不限制人查看
    case 2: // 封禁状态
      if (req.role.type === 'user' && req.role.id === post.user_id) {
        break;
      } // 所有者可以查看，用于修改文章

      if (req.role.type !== 'admin') return res.status(401).json({ error: 'no authentication' });
    break;
    case 3: // 删除状态
      if (req.role.type !== 'admin') return res.status(401).json({ error: 'no authentication' });
    break;
    }

    // 临时添加的点赞检查
    if (req.role.type !== 'guest') {
      (post as any).likes = (await db.execute({
        sql: 'SELECT 1 FROM users_like_posts WHERE user_id = ? AND post_id = ?',
        args: [req.role.id, post.id]
      })).rows.length !== 0;

      (post as any).favorite = (await db.execute({
        sql: 'SELECT 1 FROM users_favorite_posts WHERE user_id = ? AND post_id = ?',
        args: [req.role.id, post.id]
      })).rows.length !== 0;
    }

    const { isRefresh } = req.query;
    if (!isRefresh) {
      await hitPost(postId, db);
      post.hit += 1;
    }

    res.json({ success: true, ...post });
  }
}

// posts端点不进行复杂的权限检查，因为这个端点用于普通数据流展示
export function createGetPosts(db: Client): RequestHandler {
  return async (req, res) => {
    const { page } = req.params;
    const { search, tags: tagstr } = req.query;
    if (!page) return res.status(400).json({ error: 'no page' });
    else if (typeof page !== 'string') return res.status(400).json({ error: 'invalid page' });

    const pageNum = Number.parseInt(page);
    if (!Number.isInteger(pageNum)) return res.status(400).json({ error: 'invalid page' });

    if (search && typeof search !== 'string') return res.status(400).json({ error: 'invalid search' });

    if (tagstr && typeof tagstr !== 'string') return res.status(400).json({ error: 'invalid tags' });
    const tags = tagstr ? JSON.parse( tagstr) : [];
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'invalid tags' });

    const posts = await getPubPosts(pageNum, 10, db, search, tags.filter(tag => typeof tag === 'string'));

    res.json({ success: true, posts });
  }
}

export function createGetFavoritePosts(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no user' });

    const page = validatePage(req.params.page);
    if (isErr(page)) return res.status(400).json({ error: page.err });

    const posts = await db.execute({
      sql: `SELECT pub_posts_details.*, COUNT(*) OVER() AS total_count FROM pub_posts_details 
            JOIN users_favorite_posts ON pub_posts_details.id = users_favorite_posts.post_id 
            WHERE users_favorite_posts.user_id = ?
            ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      args: [req.role.id, 10, 10 * (page.ok - 1)]
    });

    res.json({ success: true, posts: posts.rows });
  }
}

export function createGetDrafts(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no user' });

    const { page: pageParam } = req.params;
    if (!pageParam) return res.status(400).json({ error: 'no page' });
    else if (typeof pageParam !== 'string') return res.status(400).json({ error: 'invalid page' });

    const page = Number.parseInt(pageParam);
    if (!Number.isInteger(page)) return res.status(400).json({ error: 'invalid page' });

    const drafts = await getDrafts(req.role.id, page, 10, db);

    res.json({ success: true, drafts });
  }
}

export function createPublishDraft(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no user' });

    const id = validatePostId(req.body.id);
    if (isErr(id)) return res.status(400).json({ error: id.err });

    const result = await db.execute({
      sql: 'UPDATE posts SET status = 1 WHERE id = ? AND user_id = ?',
      args: [id.ok, req.role.id]
    });

    res.json({ success: result.rowsAffected !== 0 });
  }
}

export function createGetOwnedPosts(db: Client): RequestHandler {
  return async (req, res) => {
    const id = validateParamUserId(req.params.id);
    if (isErr(id)) return res.status(400).json({ error: id.err });

    const page = validatePage(req.params.page);
    if (isErr(page)) return res.status(400).json({ error: page.err });

    const posts = await db.execute({
      sql: 'SELECT *, COUNT(*)  OVER() AS total_count FROM posts_details WHERE user_id = ? AND status != 3 ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      args: [id.ok, 10, (page.ok - 1) * 10]
    });

    res.json({ success: true, posts: posts.rows });
  }
}

// 后面的代码都需要再次测试与重构
// 私有评论和公开评论也许应该拆分成两个部分，这里先混合在一起
// comments端点还未稳定，先不拆解出service函数
export function createGetComments(db: Client): RequestHandler {
  return async (req, res) => {
    const { id: postIdParam } = req.params;
    if (typeof postIdParam !== 'string') return res.status(400).json({ error: 'invalid post id' });
    const postId = Number.parseInt(postIdParam);
    if (!Number.isInteger(postId)) return res.status(400).json({ error: 'invalid post id' });

    const page = validatePage(req.params.page);
    if (isErr(page)) return res.status(400).json({ error: page.err });

    // 需要查询post是否存在
    const post = await getPost(postId, db);
    if (!post) return res.status(404).json({ error: 'no post' });
 
    let result: ResultSet;
    // 这个sql语句其实已经相当于一个视图了，可以考虑像users_profiles一样设定为视图
    const sql = 'SELECT comments.*, users_profiles.avatar, users_profiles.username, COUNT(*) OVER() AS total_count FROM comments JOIN users_profiles ON users_profiles.id = comments.user_id';
    switch (req.role.type) {
    case "guest":
      result = await db.execute({
        sql: `${sql} WHERE root_id IS NULL AND post_id = ? AND private != 1 ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        args: [postId, 10, 10 * (page.ok - 1)]
      });
    break;
    case "user":
      const isPostOwner = post.user_id === req.role.id;
      if (isPostOwner) {
        result = await db.execute({
          sql: `${sql} WHERE root_id is NULL AND post_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
          args: [postId, 10, 10 * (page.ok - 1)]
        })
        break;
      }
      result = await db.execute({
        sql: `${sql} WHERE root_id IS NULL AND post_id = ? 
              AND (private != 1 OR user_id = ?) ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        args: [postId, req.role.id, 10, 10 * (page.ok - 1)]
      });
    break;
    case "admin":
      result = await db.execute({
        sql: `${sql} WHERE root_id IS NULL AND post_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        args: [postId, 10, 10 * (page.ok - 1)]
      });
    break;
    }

    for (const row of result.rows) {
      row.replies = (await db.execute({
        sql: `SELECT comments.*, users_profiles.avatar, users_profiles.username, reply_comment.content AS reply_to_content, reply_user.username AS reply_to_username
              FROM comments 
              JOIN users_profiles ON users_profiles.id = comments.user_id 
              LEFT JOIN comments reply_comment ON comments.reply_to = reply_comment.id
              LEFT JOIN users reply_user ON reply_comment.user_id = reply_user.id
              WHERE comments.root_id = ?`,
        args: [row.id as number]
      })).rows as any;
    }

    res.json({ success: true, comments: result.rows });
  }
}

// comment类型还未稳定，先不拆解出service函数
export function createGetReplies(db: Client): RequestHandler {
  return async (req, res) => {
    const role = req.role;
    if (!role) throw new Error('no role');

    const { id: commentIdParam, page: pageParam } = req.params;
    if (typeof commentIdParam !== 'string') return res.status(400).json({ error: 'invalid post id' });
    const commentId = parseInt(commentIdParam);
    if (!Number.isInteger(commentId)) return res.status(400).json({ error: 'invalid post id' });

    if (typeof pageParam !== 'string') return res.status(400).json({ error: 'invalid page' });
    const page = parseInt(pageParam);
    if (!Number.isInteger(page)) return res.status(400).json({ error: 'invalid page' });

    const commentResult = await db.execute({
      sql: 'SELECT * FROM comments WHERE id = ?',
      args: [commentId]
    });
    const comment = commentResult.rows[0];
    if (!comment) return res.status(404).json({ error: 'no comment' });

    // 游客不能查看私有评论
    // 私有评论只可以评论所有者和文章所有者查看
    if (comment.private) {
      if (role.type === 'guest') return res.status(401).json({ error: 'no authentication' });

      const postResult = await db.execute({
        sql: 'SELECT * FROM posts WHERE id = ?',
        args: [comment.post_id as number]
      });
      if (comment.user_id !== role.id && postResult.rows[0]?.user_id !== role.id) return res.status(401).json({ error: 'no authentication' });
    }

    const result = await db.execute({
      sql: 'SELECT * FROM comments WHERE root_id = ? ORDER BY updated_at DESC LIMIT 10 OFFSET ?',
      args: [commentId, 10 * (page - 1)]
    });

    res.json({ success: true, comments: result.rows });
  }
}

// comment类型还未稳定，先不拆解出service函数
export function createComment(db: Client): RequestHandler {
  return async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'no user' });

    // 其实需要检查post和comment、reply对应的数据库记录是否存在，目前先简化
    const { content: unsafeNodes, postId, rootId, replyTo, private: isPrivate } = req.body;
    if (!postId || typeof postId !== 'number') return res.status(400).json({ error: 'invalid post id' });
    if (rootId && typeof rootId !== 'number') return res.status(400).json({ error: 'invalid comment id' });
    if (replyTo && typeof replyTo !== 'number') return res.status(400).json({ error: 'invalid replied comment id' });

    const { content, hasContent, images } = contentFilter(unsafeNodes);
    if (!hasContent) return res.status(400).json({ error: 'no content' });

    const trx = await db.transaction();
    try {
      const imageIds = await getImageIds(images, trx);
      if (imageIds.length !== 0) await linkPostImages(postId, imageIds, trx); 

      // 插入评论数据表，存在对文章的评论和回复评论的评论两种情况
      if (replyTo && rootId) {
        await trx.execute({
          sql: 'INSERT INTO comments (content, user_id, post_id, reply_to, root_id, private) VALUES (?, ?, ?, ?, ?, ?)',
          args: [JSON.stringify(content), user.id, postId, replyTo, rootId, !!isPrivate]
        });
        await notifyReply(user.id, replyTo, trx);
      } else {
        await trx.execute({
          sql: 'INSERT INTO comments (content, user_id, post_id, private) VALUES (?, ?, ?, ?)',
          args: [JSON.stringify(content), user.id, postId, !!isPrivate]
        });
        await notifyComment(user.id, postId, trx);
      }

      await trx.commit();
      res.status(201).json({ success: true });
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }
}

export function createLikePost(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no authentication' });

    const postId = validatePostId(req.body.postId);
    if (isErr(postId)) return res.status(400).json({ error: postId.err });

    const post = await getPost(postId.ok, db);
    if (!post) return res.status(404).json({ error: 'no post' });

    await db.execute({
      sql: 'INSERT INTO users_like_posts (user_id, post_id, owner_id) VALUES (?, ?, ?)',
      args: [req.role.id, post.id, post.user_id]
    });

    await notifyLike(req.role.id, postId.ok, db);

    res.json({ success: true });
  }
}

export function createUnlikePost(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no authentication' });

    const postId = validatePostId(req.body.postId);
    if (isErr(postId)) return res.status(400).json({ error: postId.err });

    const post = await getPost(postId.ok, db);
    if (!post) return res.status(404).json({ error: 'no post' });

    await db.execute({
      sql: 'DELETE FROM users_like_posts WHERE user_id = ? AND post_id = ?',
      args: [req.role.id, post.id]
    });

    res.json({ success: true });
  }
}

export function createFavoritePost(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no authentication' });

    const postId = validatePostId(req.body.postId);
    if (isErr(postId)) return res.status(400).json({ error: postId.err });

    const post = await getPost(postId.ok, db);
    if (!post) return res.status(404).json({ error: 'no post' });

    await db.execute({
      sql: 'INSERT INTO users_favorite_posts (user_id, post_id, owner_id) VALUES (?, ?, ?)',
      args: [req.role.id, post.id, post.user_id]
    });

    await notifyFavorite(req.role.id, postId.ok, db);

    res.json({ success: true })
  }
}

export function createUnfavoritePost(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no authentication' });

    const postId = validatePostId(req.body.postId);
    if (isErr(postId)) return res.status(400).json({ error: postId.err });

    const post = await getPost(postId.ok, db);
    if (!post) return res.status(404).json({ error: 'no post' });

    await db.execute({
      sql: 'DELETE FROM users_favorite_posts WHERE user_id = ? AND post_id = ?',
      args: [req.role.id, post.id]
    });

    res.json({ success: true })
  }
}