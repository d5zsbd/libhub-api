import type { StringValue} from "ms";

export const ACCESS_SECRET = (() => {
  const value = process.env.LIBHUB_JWT_ACCESS_SECRET;
  if (value) {
    return value;
  }

  throw new Error('没有设定LIBHUB_JWT_ACCESS_SECRET环境变量');
})();

export const REFRESH_SECRET = (() => {
  const value = process.env.LIBHUB_JWT_REFRESH_SECRET;
  if (value) {
    return value;
  }

  throw new Error('没有设定环境变量LIBHUB_JWT_REFRESH_SECRET');
})();

// 之后得写检查是否是StringValue的逻辑
export const ACCESS_EXPIRES_IN = process.env.LIBHUB_JWT_ACCESS_EXPIRES_IN as StringValue || '2m';

export const REFRESH_EXPIRES_IN = process.env.LIBHUB_JWT_REFRESH_EXPIRES_IN as StringValue || '7d';

export const SALTROUND = (() => {
  const value = process.env.LIBHUB_SALTROUND;
  if (value) {
    const parsed = Number.parseInt(value);

    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return 10;
})();

export const UPDATE_CONCURRENCY = (() => {
  const value = process.env.LIBHUB_UPDATE_CONCURRENCY;
  if (value) {
    const parsed = Number.parseInt(value);

    if (Number.isInteger(parsed)) return parsed;
  }

  return 3;
})();

export const PORT = (() => {
  const value = process.env.LIBHUB_PORT;
  if (value) {
    const parsed = Number.parseInt(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return 3000;
})();