import multer from "multer";
import path from "path";
import fs from "fs";
import type { Request, RequestHandler, Response } from "express";
import crypto from "crypto";
import type { Client } from "@libsql/client";
import { createImageRecord, refImage } from "./image.js";
import { imageSize } from "image-size";

export const updateDirPath = path.join(import.meta.dirname, '/uploads/');
if (!fs.existsSync(updateDirPath)) fs.mkdirSync(updateDirPath, { recursive: true });

const storage = multer.memoryStorage();
const upload = multer({ 
  storage, 
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('only image allowed'));
  }
});
export const uploadImage = upload.single('image');

export function createRenameImage(db: Client): RequestHandler {
  return async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });

    try {
      const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

      const filename = sha256 + path.extname(req.file.originalname);
      const filePath = path.join(updateDirPath, filename);

      try {
        await fs.promises.access(filePath);
        await refImage(filename, db);

        return res.json({ filename });
      } catch { 
        await fs.promises.writeFile(filePath, req.file.buffer);
        await createImageRecord(filename, db);

        return res.json({ filename });
      }   
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'failed to update file' });
    }
  };
}

export async function isExist(req: Request, res: Response) {
  const { filename } = req.params;
  if (!filename || typeof filename !== 'string') return res.status(400).json({ error: 'no file' });

  try {
    await fs.promises.access(path.join(updateDirPath, filename));

    return res.json({ success: true, isExist: true });
  } catch {
    return res.json({ success: true, isExist: false });
  }
}

export function createUpdateAvatar(db: Client): RequestHandler {
  return async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'no user' });
    if (!req.file) return res.status(400).json({ error: 'no file' });

    const dimensions = imageSize(req.file.buffer);
    const { width, height } = dimensions;

    if (width !== 512 || height !== 512) return res.status(400).json({ error: 'illegal size' });

    const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const filename = sha256 + '.png';
    const filePath = path.join(updateDirPath, filename);

    let isNewFile = false;
    try {
      await fs.promises.writeFile(filePath, req.file.buffer, { flag: 'wx' });
      isNewFile = true;
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
    }
    
    const trx = await db.transaction();
    try {
      if (isNewFile) {
        await trx.execute({
          sql: 'INSERT INTO avatars (filename) VALUES (?)',
          args: [filename]
        }); // avatars 表存储 avatar的存储记录，方便实现定时删除
      }

      const result = await trx.execute({
        sql: 'SELECT * FROM users_avatars WHERE user_id = ? ORDER BY version DESC LIMIT 1',
        args: [req.user.id]
      });
      const version = result.rows[0]?.version as number | undefined || 1;

      await trx.execute({
        sql: 'INSERT INTO users_avatars (user_id, version, filename) VALUES (?, ?, ?)',
        args: [req.user.id, version + 1, filename]
      }); // user_id 和 version 有唯一性约束，冲突会报错

      await trx.commit();

      res.json({ success: true });
    } catch (error) {
      await trx.rollback();

      if (isNewFile) await fs.promises.unlink(filePath);

      res.status(500).json({ error: 'failed to update avatar' });
    }
  }
}