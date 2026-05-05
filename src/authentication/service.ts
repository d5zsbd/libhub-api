import type { UserPayload } from "../user/service.js";
import jwt from "jsonwebtoken";
import type { Jwt } from "jsonwebtoken";
import { ACCESS_SECRET, ACCESS_EXPIRES_IN, REFRESH_SECRET, REFRESH_EXPIRES_IN } from "../env.js";
import type { QueryExecutor } from "../service.js";

export function createAccessToken(payload: UserPayload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

export async function createRefreshToken(payload: UserPayload, executor: QueryExecutor) {
  const token = jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
  const decoded = jwt.decode(token, { complete: true, json: true }) as Jwt;

  await executor.execute({
    sql: 'INSERT INTO refresh_tokens (signature, user_id) VALUES (?, ?)',
    args: [decoded.signature, payload.id], // 等有时间了改成存放自己生成的jti (uuid)
  });

  return token;
}

export async function isRefreshTokenExist(signature: string, executor: QueryExecutor) {
  const result = await executor.execute({
    sql: 'SELECT * FROM refresh_tokens WHERE signature = ?',
    args: [signature]
  });

  return !!result.rows[0];
}

export async function destroyRefreshToken(signature: string, executor: QueryExecutor) {
  return executor.execute({
    sql: 'DELETE FROM refresh_tokens WHERE signature = ?',
    args: [signature]
  });
}