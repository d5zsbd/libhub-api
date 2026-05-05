import type { QueryExecutor } from "../service.js";

async function getPost(postId: number, executor: QueryExecutor) {
  const post = (await executor.execute({
    sql: 'SELECT * FROM posts WHERE id = ?',
    args: [postId]
  })).rows[0];
  if (typeof post === 'undefined') throw new Error('no post');
  return post;
}

async function getUser(userId: number, executor: QueryExecutor) {
  const user = (await executor.execute({
    sql: 'SELECT * FROM users WHERE id = ?',
    args: [userId]
  })).rows[0];
  if (typeof user === 'undefined') throw new Error('no user');
  return user;
}

export async function notifyFollower(postId: number, executor: QueryExecutor) {
  const post = await getPost(postId, executor);
  const followingId = post.user_id as number;

  const following = (await executor.execute({
    sql: 'SELECT * FROM users WHERE id = ?',
    args: [followingId]
  })).rows[0];

  const followers = (await executor.execute({
    sql: 'SELECT * FROM users JOIN users_follow_users ON following_id = ? WHERE follower_id = users.id',
    args: [followingId]
  })).rows;
  if (followers.length === 0) return;

  const json = JSON.stringify({
    type: 'followingPost',
    post: {
      id: postId,
      title: post.title
    },
    following: {
      id: followingId,
      username: following!.username
    }
  });

  await executor.execute({
    sql: `INSERT INTO notifications(user_id, json) VALUES ${followers.map(() => '(?,?)').join(',')}`,
    args: [...followers.flatMap(follower => [follower.id as number, json])]
  });
}

function createSimpleNotify(type: string) {
  return async function(userId: number, postId: number, executor: QueryExecutor) {
    const user = await getUser(userId, executor);

    const post = await getPost(postId, executor);
    const receiverId = post.user_id as number;

    const json = JSON.stringify({
      type,
      post: {
        id: postId,
        title: post.title
      },
      user: {
        id: userId,
        username: user.username
      },
    });

    await executor.execute({
      sql: 'INSERT INTO notifications(user_id, json) VALUES (?, ?)',
      args: [receiverId, json]
    });
  }
}

export const notifyLike = createSimpleNotify('like');

export const notifyFavorite = createSimpleNotify('favorite');

export const notifyComment = createSimpleNotify('comment');

export async function notifyReply(userId: number, commentId: number, executor: QueryExecutor) {
  const user = await getUser(userId, executor);

  const comment = (await executor.execute({
    sql: 'SELECT * FROM comments WHERE id = ?',
    args: [commentId]
  })).rows[0];
  if (typeof comment === 'undefined') throw new Error('no comment');
  const receiverId = comment.user_id as number;

  const json = JSON.stringify({
    type: 'reply',
    comment: {
      id: commentId,
      content: comment.content,
      postId: comment.post_id
    },
    user: {
      id: userId,
      username: user.username
    },
  });

  await executor.execute({
    sql: 'INSERT INTO notifications(user_id, json) VALUES (?, ?)',
    args: [receiverId, json]
  }); 
};