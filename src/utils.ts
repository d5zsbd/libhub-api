import type { RequestHandler } from "express";
import pLimit from "p-limit";

export function once<T extends (...args: any[]) => any>(fn: T): (...args: Parameters<T>) => ReturnType<T> {
  let isCalled = false;
  let result: ReturnType<T>;

  return function (this: any, ...args: any[]): ReturnType<T> {
    if (isCalled) return result;

    isCalled = true;
    result = fn.apply(this, args);

    return result;
  } as T;
} 

export function createRequestLimit(concurrency: number): RequestHandler {
  const limit = pLimit(concurrency);

  return async (req, res, next) => {
    await limit(() => new Promise((resolve) => {
      const resolveOnce = once(resolve);

      res.once('close', resolveOnce);
      res.once('finish', resolveOnce);
      res.once('error', resolveOnce);
      
      next();
    }));
  }
}