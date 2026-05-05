import type { RequestHandler } from "express";
import validator from '../validation/user.js';
import { LibsqlError, type Client } from "@libsql/client";
import type { Signup } from "./service.js";
import { signup, login } from "./service.js";
import { createRefreshToken } from "../authentication/service.js";
import { isErr, validatePage, validateParamUserId } from "../post/validation.js";

export function createSignup(db: Client): RequestHandler {
  return async (req, res) => {
    const { username, account, password } = req.body;

    const errors = validator.signup({
      username,
      account,
      password
    });
    if (errors) {
      return res
              .status(400)
              .json({
                errors,
                error: 'invalid fields'
              });
    }

    const user: Signup = { username, account, password };
    try {
      await signup(user, db);

      return res.json({ success: true });
    } catch (error) {
      if (error instanceof LibsqlError) {
        if (error.code === 'SQLITE_CONSTRAINT') {
          return res.status(409).json({ error: 'user has been exist' });
        } 
      }

      throw error;
    }
  };
}

export function createLogin(db: Client): RequestHandler {
  return async (req, res) => {
    const { account, password } = req.body;

    const errors = validator.login({
      account,
      password
    });
    if (errors) {
      return res
              .status(400)
              .json({
                errors,
                error: 'invalid fields'
              });
    }

    const result = await login({ account, password }, db);
    if (result) {
      res.json({ 
        success: true, 
        refreshToken: await createRefreshToken(result, db),
      });
    } else {
      res.status(400).json({ error: 'wrong account or password' })
    } 
  };
}

export type UserProfile = {
  id: number,
  username: string,
  account: string,
  signature: string | null,
  avatar: any,
  status: 0 | 1 | 2
};

export function createProfile(db: Client): RequestHandler {
  return async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(401).json({ error: 'no user id' });
    else if (typeof id !== 'string') return res.status(400).json({ error: 'invalid user id' });

    const userId = Number.parseInt(id);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'invalid user id' });

    
    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE id = ?',
      args: [userId]
    });
    if (result.rows.length !== 1) return res.status(404).json({ error: 'no user' });
    const row: any = result.rows[0];

    const avatarResult = await db.execute({
      sql: 'SELECT * FROM users_avatars WHERE user_id = ? ORDER BY version DESC LIMIT 1',
      args: [id]
    });
    const avatarRow = avatarResult.rows[0];

    const userProfile: UserProfile = {
      id: row.id,
      username: row.username,
      account: row.account,
      signature: row.signature,
      avatar: avatarRow,
      status: row.status
    };
    res.json({ success: true, ...userProfile });
  };
}

// 后面需要修改一下
export function createDetail(db: Client): RequestHandler {
  return async (req, res) => {
    const id = validateParamUserId(req.params.id);
    if (isErr(id)) return res.status(400).json({ error: id.err });

    const result: any = (await db.execute({
      sql: `SELECT id, username, avatar, 
            (SELECT count(*) FROM posts WHERE posts.user_id = users_profiles.id) AS posts_count, 
            (SELECT count(*) FROM users_like_posts WHERE users_like_posts.owner_id = ?) AS likes_count,
            (SELECT count(*) FROM users_favorite_posts WHERE users_favorite_posts.owner_id = ?) AS favorites_count
            FROM users_profiles WHERE id = ?`,
      args: [id.ok, id.ok, id.ok]
    })).rows[0];

    // 检查是否关注
    if (req.role.type !== 'guest') {
      result.is_followed = (await db.execute({
        sql: 'SELECT 1 FROM users_follow_users WHERE follower_id = ? AND following_id = ?',
        args: [req.role.id, id.ok]
      })).rows.length !== 0;
    }
    
    res.json({ success: true, ...result });
  }
}

export function createFollow(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no user' });
    const { followingId } = req.body;
    if (!followingId) return res.status(400).json({ error: 'no id' });
    else if (typeof followingId !== 'number') return res.status(400).json({ error: 'invalid id' });

    await db.execute({
      sql: 'INSERT INTO users_follow_users(follower_id, following_id) VALUES (?, ?)',
      args: [req.role.id, followingId]
    });

    res.json({ success: true });
  }
}

export function createUnfollow(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no user' });
    const { followingId } = req.body;
    if (!followingId) return res.status(400).json({ error: 'no id' });
    else if (typeof followingId !== 'number') return res.status(400).json({ error: 'invalid id' });

    await db.execute({
      sql: 'DELETE FROM users_follow_users WHERE follower_id = ? AND following_id = ?',
      args: [req.role.id, followingId]
    });

    res.json({ success: true});
  }
}

export function createGetFollowings(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no user' });
    
    const page = validatePage(req.params.page);
    if (isErr(page)) return res.status(400).json({ error: page.err });

    const result = await db.execute({
      sql: `SELECT *, 
            (SELECT count(*) FROM posts WHERE posts.user_id = users_profiles.id) AS posts_count, 
            (SELECT count(*) FROM users_like_posts WHERE users_like_posts.owner_id = users_profiles.id) AS likes_count,
            (SELECT count(*) FROM users_favorite_posts WHERE users_favorite_posts.owner_id = users_profiles.id) AS favorites_count,
            COUNT(*) OVER() AS total_count
            FROM users_profiles JOIN users_follow_users ON users_follow_users.follower_id = ? AND users_profiles.id = users_follow_users.following_id
            ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      args: [req.role.id, 10, 10 * (page.ok - 1)]
    });

    res.json({ success: true, followings: result.rows });
  }
}

export function createUpdateUser(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(401).json({ error: 'no user' });
    const { username, signature } = req.body;

    await db.execute({
      sql: 'UPDATE users SET username = ?, signature = ? WHERE id = ?',
      args: [username, signature, req.role.id]
    });

    res.json({ success: true });
  }
}