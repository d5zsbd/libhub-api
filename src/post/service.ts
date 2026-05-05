import type { InStatement, Transaction } from "@libsql/client";
import type { QueryExecutor } from "../service.js";

type TagRow = {
  id: number,
  name: string,
  created_at: string,
  updated_at: string
};

export async function hasTags(tags: string[], executor: QueryExecutor) {
  return (await executor.execute({
    sql: `SELECT name FROM tags WHERE name IN (${tags.map(_ => '?').join(', ')})`,
    args: tags
  })).rows.map(row => row.name as string);
}

export async function hasNoTags(tags: string[], executor: QueryExecutor) {
  const existedTags = await hasTags(tags, executor);
  return tags.filter(tag => !existedTags.includes(tag));
}

export function createTags(tags: string[], executor: QueryExecutor) {
  return executor.execute({
    sql: `INSERT INTO tags (name) VALUES ${tags.map(() => '(?)').join(', ')}`,
    args: tags
  });
}

export async function getTags(tags: string[], executor: QueryExecutor) {
  return (await executor.execute({
    sql: `SELECT * FROM tags WHERE name in (${tags.map(_ => '?').join(', ')})`,
    args: tags
  })).rows as unknown as TagRow[];
}

type PostRow = {
  id: number,
  title: string,
  content: string,
  user_id: number,
  visibility: 0 | 1,
  version: string,
  child_id?: number,
  deleted_at?: string,
  status: 0 | 1 | 2 | 3,
  hit: number,
  created_at: string,
  updated_at: string
};

type CreatePostRow = Pick<PostRow, 'title' | 'content' | 'user_id'| 'visibility' | 'status'>;

// 使用事务类型是要求外部处理全文搜索可能添加失败了的情况(回滚post插入)
export async function createPost(row: CreatePostRow, text: string[], trx: Transaction) {
  const { title, content, user_id, visibility, status } = row;

  const id = (await trx.execute({
    sql: 'INSERT INTO posts (title, content, user_id, visibility, status) VALUES (?, ?, ?, ?, ?) RETURNING id',
    args: [title, content, user_id, visibility, status]
  })).rows[0]?.id as number; // 版本系统还没实装

  // 添加全文搜索缓存，text是干净的文本数组而不是json字符串
  await trx.execute({
    sql: "INSERT INTO posts_fts(rowid, title, content) VALUES (?, ?, ?)",
    args: [id, title, text.join(' ')]
  });

  return id;
}

type UpdatePostRow = Pick<PostRow, 'content' | 'visibility' | 'status'>;

export function updatePost(id: number, row: UpdatePostRow, executor: QueryExecutor) {
  return executor.execute({
    sql: 'UPDATE posts SET content = ?, visibility = ?, status = ? WHERE id = ?',
    args: [row.content, row.visibility, row.status, id]
  });
}

export function linkPostTags(postId: number, tags: Pick<TagRow, 'id'>[], executor: QueryExecutor) {
  return executor.execute({
    sql: `INSERT INTO posts_tags (post_id, tag_id) VALUES ${tags.map(() => '(?, ?)').join(', ')}`,
    args: tags.flatMap((tag) => [postId, tag.id])
  });
}

// 后面修改成sql控制显示结果
export async function getPost(id: number, executor: QueryExecutor) {
  // const post = (await executor.execute({
  //   sql: 'SELECT * FROM posts WHERE id = ?',
  //   args: [id]
  // })).rows[0];

  // return post ? post as unknown as PostRow : null;

  const post = (await executor.execute({
    sql: 'SELECT * FROM posts_details WHERE id = ?',
    args: [id]
  })).rows[0];

  return post ? post as unknown as PostRow : null;
}

// 这边得单独新建一种类型而不是postrow
// 重构时得优化sql逻辑
export async function getPubPosts(page: number, size: number, executor: QueryExecutor, search: string = '', tags: string[] = []) {
  const tagIds = tags.length !== 0 ? (await executor.execute({
    sql: `SELECT id FROM tags WHERE name IN (${tags.map(() => '?').join(',')})`,
    args: tags
  })).rows.map(row => row.id as number) : [];
  const where = tags.length !== 0 ? `(SELECT count(*) = ${tags.length} FROM posts_tags WHERE post_id = pub_posts_details.id AND tag_id IN (${tagIds.map(() => '?').join(',')})) AND` : '';

  const stm: InStatement = (() => {
    // 全文搜索的语句 
    const sql = `SELECT *, COUNT(*) OVER() AS total_count FROM pub_posts_details JOIN posts_fts ON pub_posts_details.id = posts_fts.rowid WHERE ${where} posts_fts MATCH simple_query(?) ORDER BY posts_fts.rank LIMIT ? OFFSET ?`;

    if (search) {
      return {
        // like的模糊查询部分，如果使用like匹配search变量得是%search%，同时因为content内容是嵌套的json字符串，所以有一个全局搜索虚拟表存放纯文本的副本是更好的选择
        // sql: 'SELECT * FROM posts_details WHERE visibility = 1 AND status = 1 AND title LIKE ? ORDER BY updated_at DESC LIMIT 10 OFFSET ?',
        sql,
        args: [...tagIds, search, size, (page - 1) * size]
      };
    } else {
      return {
        sql: `SELECT *, COUNT(*) OVER() AS total_count FROM pub_posts_details WHERE ${where} 1 ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        args: [...tagIds, size, (page - 1) * size]
      };
    }
  })();

  return (await executor.execute(stm)).rows as unknown as PostRow[];
}

export async function getDrafts(userId: number, page: number, size: number, executor: QueryExecutor) {
  return (await executor.execute({
    sql: 'SELECT * FROM posts WHERE status = 0 AND user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    args: [userId, size, (page -1) * size]
  })).rows as unknown as PostRow[];
}

export function hitPost(postId: number, executor: QueryExecutor) {
  return executor.execute({
    sql: 'UPDATE posts SET hit = hit + 1 WHERE id = ?',
    args: [postId]
  });
}