import bcrypt from 'bcrypt';
import { SALTROUND } from "../env.js";
import type { QueryExecutor } from "../service.js";

export type User = {
  id: number,
  username: string,
  account: string,
  password: string,
  role: 0 | 1,
};

export type Signup = Pick<User, 'account' | 'password' | 'username'>;
export type Login = Pick<User, 'account' | 'password'>;
export type UserPayload = Pick<User, 'id' | 'role'>;

export async function signup(user: Signup, executor: QueryExecutor) {
  const hash = await bcrypt.hash(user.password, SALTROUND);

  return executor.execute({
    sql: 'INSERT INTO users (username, account, password) VALUES (?, ?, ?)',
    args: [user.username, user.account, hash],
  });
}

export async function login(user: Login, executor: QueryExecutor): Promise<UserPayload | null> {
  const result = await executor.execute({
    sql: 'SELECT id, password, role FROM users WHERE account = ?',
    args: [user.account],
  });

  if (result.rows.length) {
    const row = result.rows[0] as unknown as Pick<User, 'id' | 'password' | 'role'>;
    
    if (await bcrypt.compare(user.password, row.password)) {
      return { id: row.id, role: row.role  };
    }
  } 

  return null;
}

export async function hasUser(id: number, executor: QueryExecutor): Promise<boolean> {
  const result = await executor.execute({
    sql: 'SELECT id FROM users WHERE id = ?',
    args: [id]
  });

  return result.rows.length !== 0;
}