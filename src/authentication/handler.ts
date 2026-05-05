import type { Client } from "@libsql/client";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";
import { createAccessToken, createRefreshToken, destroyRefreshToken, isRefreshTokenExist } from "./service.js";
import { ACCESS_SECRET, REFRESH_SECRET } from "../env.js";
import type { UserPayload } from "../user/service.js";

export function createRefresh(db: Client): RequestHandler {
  return async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) return res.status(400).json({ error: 'no token' });
  
    const decoded = jwt.decode(refreshToken, { complete: true, json: true });
    if (!decoded) return res.status(401).json({ error: '无效的token' });

    const trx = await db.transaction();
    
    if (!await isRefreshTokenExist(decoded.signature, trx)) return res.status(401).json({ error: '不存在的token' });
    
    try {
      jwt.verify(refreshToken, REFRESH_SECRET);

      const jwtPayload = decoded.payload as UserPayload & JwtPayload;
      const payload = { id: jwtPayload.id, role: jwtPayload.role };

      const result = await destroyRefreshToken(decoded.signature, trx);
      if (result.rowsAffected === 0) throw new Error('令牌已消耗');

      const newRefreshToken = await createRefreshToken(payload, trx);

      await trx.commit();

      res.json({ 
        success: true, 
        accessToken: createAccessToken(payload),
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      await trx.rollback();

      if (error instanceof jwt.TokenExpiredError) {
        await destroyRefreshToken(decoded.signature, db);

        return res.status(401).json({ error: 'token已过期' });
      }

      if (error instanceof Error && error.message === '令牌已消耗') {
        return res.status(401).json({ error: '令牌已消耗' });
      }

      res.status(401).json({ error: '无效的token' });
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'no token' });

  try {
    req.user = jwt.verify(token, ACCESS_SECRET) as JwtPayload & UserPayload;

    return next();
  } catch(error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'token已过期' });
    }
    res.status(401).json({ error: '无效的token' });
  }
}

export type Role = 
  | { type: 'guest' }
  | { type: 'user', id: number }
  | { type: 'admin', id: number }
;
export function role(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    req.role = { type: 'guest' };
    return next();
  }

  try {
    const payload = jwt.verify(token, ACCESS_SECRET) as JwtPayload & UserPayload;
    req.role = {
      type: payload.role ? 'user' : 'admin',
      id: payload.id
    };
    return next();
  } catch(error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'token已过期' });
    }
    res.status(401).json({ error: '无效的token' });
  }
}