import type { Client } from "@libsql/client";
import type { QueryExecutor } from "./service.js";
import fs from 'fs';
import { updateDirPath } from "./upload.js";
import path from "path";

type Image = {
  id: number,
  filename: string,
  created_at: string,
  updated_at: string, 
};

export function createImageRecord(filename: string, executor: QueryExecutor) {
  return executor.execute({
    sql: 'INSERT INTO images (filename) VALUES (?)',
    args: [filename]
  });
}

export async function clearImage(executor: Client) {
  const result = await executor.execute({
    sql: `SELECT * FROM images WHERE JULIANDAY(\'now\') - JULIANDAY(created_at) > 1.0
      AND NOT EXISTS (SELECT 1 FROM posts_images WHERE image_id = images.id)`
  });

  for (const row of result.rows) {
    const image = {
      id: row.id,
      filename: row.filename,
      created_at: row.created_at,
      updated_at: row.updated_at
    } as Image;

    await fs.promises.unlink(path.join(updateDirPath, image.filename))
      .then(async () => {
        await executor.execute({
          sql: 'DELETE FROM images WHERE id = ?',
          args: [image.id]
        })
      })
      .catch(console.error);
  }
}

export function refImage(filename: string, executor: QueryExecutor) {
  return executor.execute({
    sql: 'UPDATE images SET updated_at = CURRENT_TIMESTAMP WHERE filename = ?',
    args: [filename]
  });
}

export async function getImageIds(images: Set<string>, executor: QueryExecutor) {
  const imagesArray = [...images];
  
  const placeholders = imagesArray.map(() => '?').join(',');
  const imageRows = await executor.execute({
    sql: `SELECT id FROM images WHERE filename IN (${placeholders})`,
    args: imagesArray
  });
  if (imageRows.rows.length !== imagesArray.length) throw new Error('malicious post'); // 所有正常图片前端在帖子编辑时就会自动上传

  return imageRows.rows.map(row => row.id) as number[];
}

export async function getUnlinkedImageIds(postId: number, images: Set<string>, executor: QueryExecutor) {
  const imagesId = await getImageIds(images, executor);

  const linkedImagesId = (await executor.execute({
    sql: `SELECT image_id FROM posts_images WHERE post_id = ? AND image_id IN (${imagesId.map(() => '?').join(', ')})`,
    args: [postId, ...imagesId]
  })).rows.map(row => row.image_id as number);

  return imagesId.filter(id => !linkedImagesId.includes(id));
}

export function linkPostImages(postId: number, imageIds: number[], executor: QueryExecutor) {
  const placeholders = imageIds.map(() => '(?, ?)').join(', ');
  const flatArgs = imageIds.flatMap(id => [postId, id]);
  return executor.execute({
    sql: `INSERT INTO posts_images (post_id, image_id) VALUES ${placeholders}`,
    args: flatArgs
  });
}