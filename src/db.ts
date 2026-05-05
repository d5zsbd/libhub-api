import { createClient } from "@libsql/client";

// const db = createClient({ url: 'file:./data.db' });
// export const poll = await Database.create('./data.db');
// await poll.loadExtension('./simple.dll');
const db = createClient({ url: 'ws://localhost:8080'});

function updatedAtTrigger(tablename: string, when: string[] = []) {
  const whenClause = when.length !== 0 ? `WHEN (${when.map(field => `OLD.${field} != NEW.${field}`).join(' OR ')})` : '';

  return `
DROP TRIGGER IF EXISTS update_${tablename}_update_at;
CREATE TRIGGER IF NOT EXISTS update_${tablename}_update_at BEFORE UPDATE ON ${tablename}
FOR EACH ROW
${whenClause}
BEGIN
  UPDATE ${tablename} SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END; 
`;
}

await db.execute(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role INTEGER NOT NULL DEFAULT 1 CHECK (role IN (0, 1)), -- 0: 管理员, 1: 普通用户
  username TEXT NOT NULL,
  account TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  signature TEXT,
  status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0, 1, 2)), -- 0: 正常, 1: 被封禁, 2: 删除
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

await db.execute(`
CREATE TABLE IF NOT EXISTS users_follow_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  follower_id INTEGER NOT NULL,
  following_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

await db.execute(`
CREATE VIEW IF NOT EXISTS users_profiles AS
SELECT users.*, (SELECT users_avatars.filename FROM users_avatars WHERE users_avatars.user_id = users.id ORDER BY users_avatars.version DESC LIMIT 1) AS avatar
FROM users
`);

await db.executeMultiple(updatedAtTrigger('users'));

await db.execute(`
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signature TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0, 1)), -- 0: 正常, 1: 被封禁
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);
await db.executeMultiple(updatedAtTrigger('refresh_tokens'));

await db.execute(`
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  visibility INTEGER NOT NULL DEFAULT 1 CHECK (visibility IN (0, 1)), -- 0: 不可见, 1: 可见
  version INTEGER NOT NULL DEFAULT 1,
  child_id INTEGER, -- 是否存在新版本，下个版本取消这个字段，不再采用树状结构
  deleted_at TIMESTAMP,
  status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1, 2, 3)), -- 0: 草稿 1: 发布 2: 封锁 3: 删除
  hit INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) 
`);
await db.executeMultiple(updatedAtTrigger('posts', ['title', 'content']));

await db.execute(`
CREATE TABLE IF NOT EXISTS posts_contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(post_id, version)
)
`);

await db.execute(`
CREATE VIEW IF NOT EXISTS posts_details AS
SELECT posts.*, 
users.username, 
(SELECT count(*) FROM comments WHERE post_id = posts.id AND private != 1) AS comments_count, 
(SELECT count(*) FROM users_like_posts WHERE post_id = posts.id) AS likes_count,
GROUP_CONCAT(tags.name, ',') AS tags
FROM posts JOIN users ON users.id = posts.user_id 
JOIN posts_tags ON posts.id = posts_tags.post_id JOIN tags ON posts_tags.tag_id = tags.id GROUP BY posts.id;
`);

await db.execute(`
CREATE VIEW IF NOT EXISTS pub_posts_details AS 
SELECT * FROM posts_details WHERE status = 1 AND visibility = 1
`);


await db.execute(`
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(title, content, tokenize='simple 0')
`);

await db.execute(`
CREATE TABLE IF NOT EXISTS users_like_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, post_id)
)
`);

await db.execute(`
CREATE TABLE IF NOT EXISTS users_favorite_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, post_id)
)
`);

await db.execute(`
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT UNIQUE NOT NULL,
  status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0, 1)), -- 0: 未确认, 1: 已经确认
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
)  
`);
await db.executeMultiple(updatedAtTrigger('images'));

await db.execute(`
CREATE TABLE IF NOT EXISTS posts_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  image_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
)
`);
await db.executeMultiple(updatedAtTrigger('posts_images'));

await db.execute(`
CREATE TABLE IF NOT EXISTS avatars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

await db.execute(`
CREATE TABLE IF NOT EXISTS users_avatars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  filename TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, version)
)
`);

await db.execute(`
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  reply_to INTEGER DEFAULT NULL,
  root_id INTEGER DEFAULT NULL,
  private INTEGER DEFAULT 0 CHECK (private IN (0, 1)),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);
await db.executeMultiple(updatedAtTrigger('comments'));

await db.execute(`
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

await db.execute(`
CREATE TABLE IF NOT EXISTS posts_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

await db.execute(`
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  json TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

export default db;