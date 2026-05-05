import type { Client } from "@libsql/client";
import type { RequestHandler } from "express";

export function createGetNotifications(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(400).json({ error: 'no user' });

    if (!req.params.page) return res.status(400).json({ error: 'no page' });
    else if (typeof req.params.page !== 'string') return res.status(400).json({ error: 'invalid page' });
    const page = Number.parseInt(req.params.page);
    if (!Number.isInteger(page)) return res.status(400).json({ error: 'invalid page' });

    const result = await db.execute({
      sql: 'SELECT *, COUNT(*) OVER() AS total_count FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      args: [req.role.id, 10, 10 * (page - 1)]
    });

    res.json({ success: true, notifications: result.rows });
  }
}

export function createHasUnread(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(400).json({ error: 'no user' });

    const result = await db.execute({
      sql: 'SELECT EXISTS (SELECT 1 FROM notifications WHERE user_id = ? AND is_read = 0) AS is_exist',
      args: [req.role.id]
    });

    res.json({ success: true, hasUnread: result.rows[0]?.is_exist });
  }
}

export function createReadNotifications(db: Client): RequestHandler {
  return async (req, res) => {
    if (req.role.type === 'guest') return res.status(400).json({ error: 'no user' });

    const { id } = req.body;
    if (typeof id === 'undefined') return res.status(400).json({ error: 'no post id' });
    
    // 外部调用api可以传入单个整数也可以传入一个整数数组
    const readId = (() => {
      if (Number.isInteger(id)) return [id as number];
      else if (!Array.isArray(id)) throw new Error('invalid post id');
      else if (id.length === 0) throw new Error('no post id');
      const array = [];

      for (const n of id) {
        if (Number.isInteger(n)) array.push(n);
        else throw new Error('invalid post id');
      }

      return array as number[];
    })();

    await db.execute({
      sql: `UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id IN (${readId.map(() => '?').join(',')})`,
      args: [req.role.id, ...readId]
    });

    res.json({ success: true });
  }
}