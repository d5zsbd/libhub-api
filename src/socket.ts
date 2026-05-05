import { Server } from "socket.io";
import type http from 'http';
import type { RequestHandler } from "express";

// 等基本功能完成和前端联调实现
export function createSocketIO(server: http.Server): RequestHandler {
  const io = new Server(server, {
    cors: {
      origin: 'http://localhost:5173',
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  io.on('connection', socket => {
    console.log('一个用户连接了, id: ' + socket.id);
  });

  return (req, res, next) => {
    req.io = io;
    next();
  }
}