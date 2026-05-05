import type { Server } from "socket.io";
import type { Role } from "../src/authentication/handler.ts";
import { UserPayload } from "../src/user/service.ts";

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
      role: Role;
      io: Server
    }
  }
}