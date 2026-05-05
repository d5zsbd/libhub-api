export type Result<T, E> = 
  | { ok: T }
  | { err: E }
;

export type GetErrorType<T> = T extends { err: infer E } ? E : never;

export type GetOkType<T> = T extends { ok: infer V } ? V : never;

export function isOk<T, E>(result: Result<T, E>): result is { ok: T } {
  return 'ok' in result;
}

export function isErr<T, E>(result: Result<T, E>): result is { err: E } {
  return 'err' in result;
}

type FieldErr<T extends Record<string, Result<any, any>>> = {
  [K in keyof T]: { field: K; error: GetErrorType<T[K]> };
}[keyof T];

type FieldOk<T extends Record<string, Result<any, any>>> = { [K in keyof T]: GetOkType<T[K]> };

function combineResultsWithFields<T extends Record<string, Result<any, any>>>(results: T): Result<FieldOk<T>, FieldErr<T>[]> {
  const err: FieldErr<T>[] = [];
  // 必要的类型断言，后续循环会填充所有字段
  const ok = {} as FieldOk<T>;

  for (const key in results) {
    const result: T[typeof key] = results[key];
    if (isErr(result)) {
      err.push({ field: key, error: result.err });
    } else {
      ok[key] = result.ok;
    }
  }

  if (err.length > 0) return { err };
  return { ok };
}

type TagsResult = Result<string[], 
  'no tags' | 'invalid tags' | 'invalid tag' | 'tag length is too long' | 'tags length should be less 4'>;
function validateTags(tags: unknown): TagsResult {
  if (!tags) return { err: 'no tags' };
  if (!Array.isArray(tags)) return { err: 'invalid tags'};
  if (tags.length === 0) return { err: 'no tags' };
  if (tags.length > 3) return { err: 'tags length should be less 4' }

  for (const tag of tags) {
    if (typeof tag !== 'string') return { err: 'invalid tag' };
    else if (tag.length > 12) return { err: 'tag length is too long' };
  }

  return { ok: tags };
}

type TitleResult = Result<string,
  'no title' | 'wrong title' | 'invalid title length' | 'nodes have to be a array'>;
function validateTitle(title: unknown): TitleResult {
  if (!title) return { err: 'no title' };
  if (typeof title !== 'string') return { err: 'wrong title' };
  if (title.length < 1 || title.length > 24) return { err: 'invalid title length' };

  return { ok: title };
}

type NodesResult = Result<unknown[], 'no nodes' | 'nodes have to be a array'>;
function validateContent(content: unknown): NodesResult {
  if (!content) return { err: 'no nodes' };
  if (!Array.isArray(content)) return { err: 'nodes have to be a array' };

  return { ok: content };
}

// 默认值是可见
function validateVisibility(visibility: unknown): Result<boolean, 'invalid visibility'> {
  if (typeof visibility === 'boolean') {
    return { ok: visibility };
  } else if (typeof visibility === 'undefined') {
    return { ok: true };
  } else {
    return { err: 'invalid visibility' };
  }
}

function validateStatus(status: unknown): Result<'draft' | 'publish', 'invalid status'> {
  if (typeof status === 'string') {
    if (status === 'draft' || status === 'publish') return { ok: status };
    else return { err: 'invalid status' };
  } else {
    return { err: 'invalid status' };
  }
}

export function validatePost(body: Record<string, unknown>) {
  const { title, content, tags, visibility, status } = body;

  return combineResultsWithFields({
    title: validateTitle(title),
    unsafeNodes: validateContent(content),
    tags: validateTags(tags),
    visibility: validateVisibility(visibility),
    status: validateStatus(status)
  });
}

export function validatePostId(postId: unknown): Result<number, 'invalid post id'> {
  if (typeof postId === 'number') return { ok: postId };

  return { err: 'invalid post id' };
}

export function validateParamUserId(userId: unknown): Result<number, any> {
  if (!userId) return { err: 'no user id' };
  else if (typeof userId !== 'string') return { err: 'invalid user id' };

  const id = Number.parseInt(userId);
  if (!Number.isInteger(id)) return { err: 'invalid user id' };

  return { ok: id };
}

// undefined 意味着不修改
function validateUpdateStatus(status: unknown): Result<'draft' | 'publish' | 'blocked' | undefined, 'invalid status'> {
  if (typeof status === 'undefined') return { ok: undefined };
  else if (typeof status === 'string' && (status === 'draft' || status === 'publish' || status === 'blocked')) return { ok: status };

  return { err: 'invalid status' }
}

// undefined 意味着不修改
function validateUpdateVisibility(visibility: unknown): Result<boolean | undefined, 'invalid visibility'> {
  if (typeof visibility === 'undefined') return { ok: undefined };
  else if (typeof visibility === 'boolean') return { ok: visibility };

  return { err: 'invalid visibility' }
}

export function validateUpdatePost(body:Record<string, unknown>) {
  const { postId, content, visibility, status } = body;

  return combineResultsWithFields({
    postId: validatePostId(postId),
    unsafeNodes: validateContent(content),
    visibility: validateUpdateVisibility(visibility),
    status: validateUpdateStatus(status)
  });
}

export function validatePage(page: unknown): Result<number, 'no page' | 'invalid page'> {
  if (!page) return { err: 'no page' };
  else if (typeof page !== 'string') return { err: 'invalid page' };

  const pageNumber = Number.parseInt(page);
  if (!Number.isInteger(pageNumber)) return { err: 'invalid page' };

  return { ok: pageNumber };
}