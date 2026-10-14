import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.js';
import { openDatabase } from './db.js';
import { ApiError, bearer, equalToken, fail, readBytes, readJson, requestId, send, text } from './http.js';
import { Store } from './store.js';

export interface ApiApp { server: Server; db: DatabaseSync; close(): Promise<void> }

function idempotencyKey(req: IncomingMessage): string | undefined {
  const value = req.headers['idempotency-key'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) {
    throw new ApiError(400, 'BAD_REQUEST', 'Idempotency-Key 格式不正确');
  }
  return value;
}

function imageType(bytes: Buffer): { mime: string; extension: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', extension: 'png' };
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

function internalIdentity(req: IncomingMessage, store: Store) {
  if (!equalToken(bearer(req), store.config.internalAgentToken)) throw new ApiError(401, 'UNAUTHORIZED', '内部服务令牌无效');
  const userId = req.headers['x-user-id'];
  const schoolId = req.headers['x-school-id'];
  if (typeof userId !== 'string' || typeof schoolId !== 'string') throw new ApiError(400, 'BAD_REQUEST', '缺少可信用户上下文');
  return store.internalUser(userId, schoolId);
}

async function proxyAgent(req: IncomingMessage, store: Store, user: ReturnType<Store['authenticate']>, body: Record<string, unknown>, rid: string): Promise<{ status: number; body: unknown }> {
  const agentRequestId = text(body.requestId, 'requestId', 1, 100);
  const message = text(body.message, 'message', 1, 2000);
  const sessionId = body.sessionId === null || body.sessionId === undefined ? null : text(body.sessionId, 'sessionId', 1, 150);
  const resumeState = sessionId === null ? undefined : store.conversationState(sessionId, user);
  let response: Response;
  try {
    response = await fetch(`${store.config.agentBaseUrl}/internal/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-service-token': store.config.agentServiceToken,
        'x-user-id': user.id,
        'x-school-id': user.school_id
      },
      body: JSON.stringify({ requestId: agentRequestId, sessionId, message,
        ...(resumeState === undefined ? {} : { state: resumeState }) }),
      signal: AbortSignal.timeout(75_000)
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new ApiError(timedOut ? 504 : 503, timedOut ? 'AGENT_TIMEOUT' : 'AGENT_UNAVAILABLE',
      timedOut ? 'Agent 响应超时' : 'Agent 服务不可用', true);
  }
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new ApiError(502, 'AGENT_BAD_RESPONSE', 'Agent 返回了无法解析的数据', true); }
  if (!response.ok) {
    const errorBody = result && typeof result === 'object' ? result as Record<string, unknown> : {};
    return { status: response.status, body: {
      requestId: agentRequestId,
      code: typeof errorBody.code === 'string' ? errorBody.code : 'AGENT_ERROR',
      message: typeof errorBody.message === 'string' ? errorBody.message : 'Agent 调用失败',
      retryable: errorBody.retryable === true
    } };
  }
  if (!result || typeof result !== 'object') throw new ApiError(502, 'AGENT_BAD_RESPONSE', 'Agent 响应格式错误', true);
  const value = result as Record<string, unknown>;
  if (value.requestId !== agentRequestId || typeof value.sessionId !== 'string' || !value.sessionId ||
    !['completed','clarification','no_results'].includes(String(value.status)) ||
    typeof value.reply !== 'string' || !Array.isArray(value.recommendations) || !Array.isArray(value.relaxedConditions)) {
    throw new ApiError(502, 'AGENT_BAD_RESPONSE', 'Agent 响应字段错误', true);
  }
  if (sessionId && sessionId !== value.sessionId) throw new ApiError(502, 'AGENT_BAD_RESPONSE', 'Agent 会话 ID 异常', true);
  store.recordAgentTurn({
    sessionId: value.sessionId, user, message,
    reply: typeof value.reply === 'string' ? value.reply : '',
    recommendations: Array.isArray(value.recommendations) ? value.recommendations : [],
    state: value.state !== null && typeof value.state === 'object' ? value.state as Record<string, unknown> : undefined
  });
  return { status: 200, body: value };
}

async function route(req: IncomingMessage, res: ServerResponse, store: Store, rid: string): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = decodeURIComponent(url.pathname);
  const method = req.method || 'GET';
  if (method === 'GET' && (path === '/health/live' || path === '/health/ready')) {
    if (path.endsWith('ready')) store.db.prepare('SELECT 1').get();
    send(res, 200, { status: 'ok' }, rid); return;
  }
  if (method === 'POST' && path === '/api/v1/auth/local/sessions') {
    send(res, 201, store.login(await readJson(req)), rid); return;
  }
  if (path.startsWith('/internal/')) {
    if (method !== 'GET') throw new ApiError(404, 'NOT_FOUND', '接口不存在');
    const user = internalIdentity(req, store);
    if (path === '/internal/listings/search') { send(res, 200, store.internalSearch(user, url.searchParams), rid); return; }
    if (path === '/internal/users/preferences') { send(res, 200, store.preferences(user), rid); return; }
    const match = /^\/internal\/listings\/(listing_[a-z0-9_-]{1,64})$/.exec(path);
    if (match?.[1]) { send(res, 200, store.internalListing(match[1], user), rid); return; }
    throw new ApiError(404, 'NOT_FOUND', '接口不存在');
  }
  const signedImageMatch = /^\/api\/v1\/images\/(img_[a-f0-9]{32})$/.exec(path);
  if (method === 'GET' && signedImageMatch?.[1] && store.validImageSignature(signedImageMatch[1], url.searchParams)) {
    const image = store.image(signedImageMatch[1]);
    if (!image?.product_id || !store.findProduct(image.product_id)) throw new ApiError(404, 'NOT_FOUND', '图片不存在');
    const filename = join(store.config.uploadDir, `${image.id}.${image.extension}`);
    if (!existsSync(filename)) throw new ApiError(404, 'NOT_FOUND', '图片文件不存在');
    res.writeHead(200, { 'Content-Type': image.mime, 'Content-Length': image.size_bytes, 'Cache-Control': 'private, max-age=300', 'X-Request-Id': rid });
    createReadStream(filename).pipe(res); return;
  }
  const token = bearer(req);
  const user = store.authenticate(token);
  if (method === 'POST' && path === '/api/v1/auth/logout') {
    store.logout(token); send(res, 200, { ok: true }, rid); return;
  }
  if (method === 'GET' && path === '/api/v1/me') { send(res, 200, store.user(user), rid); return; }
  if (method === 'GET' && path === '/api/v1/products') { send(res, 200, store.products(user, url.searchParams), rid); return; }
  if (method === 'GET' && path === '/api/v1/me/products') { send(res, 200, store.products(user, url.searchParams, true), rid); return; }
  if (method === 'POST' && path === '/api/v1/products') { send(res, 201, store.publish(user, await readJson(req)), rid); return; }
  const productMatch = /^\/api\/v1\/products\/(listing_[a-z0-9_-]{1,64})$/.exec(path);
  if (method === 'GET' && productMatch?.[1]) { send(res, 200, store.publicProduct(productMatch[1], user), rid); return; }
  const delistMatch = /^\/api\/v1\/products\/(listing_[a-z0-9_-]{1,64})\/delist$/.exec(path);
  if (method === 'POST' && delistMatch?.[1]) { send(res, 200, store.delist(delistMatch[1], user), rid); return; }
  const relistMatch = /^\/api\/v1\/products\/(listing_[a-z0-9_-]{1,64})\/relist$/.exec(path);
  if (method === 'POST' && relistMatch?.[1]) { send(res, 200, store.relist(relistMatch[1], user), rid); return; }
  if (method === 'POST' && path === '/api/v1/uploads') {
    const bytes = await readBytes(req, 5_000_000);
    const type = imageType(bytes);
    if (!type || bytes.length === 0 || req.headers['content-type'] !== type.mime) {
      throw new ApiError(400, 'INVALID_IMAGE', '只接受内容匹配的 JPEG、PNG 或 WebP 图片');
    }
    const id = `img_${randomUUID().replaceAll('-', '')}`;
    const filename = join(store.config.uploadDir, `${id}.${type.extension}`);
    writeFileSync(filename, bytes, { flag: 'wx' });
    try {
      store.db.prepare('INSERT INTO product_images(id,owner_id,mime,extension,size_bytes,created_at) VALUES(?,?,?,?,?,?)')
        .run(id, user.id, type.mime, type.extension, bytes.length, Date.now());
    } catch (error) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(filename);
      throw error;
    }
    send(res, 201, { id, url: `${store.config.publicBaseUrl}/api/v1/images/${id}` }, rid); return;
  }
  const imageMatch = /^\/api\/v1\/images\/(img_[a-f0-9]{32})$/.exec(path);
  if (method === 'GET' && imageMatch?.[1]) {
    const image = store.image(imageMatch[1]);
    if (!image) throw new ApiError(404, 'NOT_FOUND', '图片不存在');
    if (image.product_id) store.publicProduct(image.product_id, user);
    else if (image.owner_id !== user.id) throw new ApiError(404, 'NOT_FOUND', '图片不存在');
    const filename = join(store.config.uploadDir, `${image.id}.${image.extension}`);
    if (!existsSync(filename)) throw new ApiError(404, 'NOT_FOUND', '图片文件不存在');
    res.writeHead(200, { 'Content-Type': image.mime, 'Content-Length': image.size_bytes, 'Cache-Control': 'private, max-age=300', 'X-Request-Id': rid });
    createReadStream(filename).pipe(res); return;
  }
  if (method === 'POST' && path === '/api/v1/transactions') {
    send(res, 201, store.createTransaction(user, await readJson(req), idempotencyKey(req)), rid); return;
  }
  if (method === 'GET' && path === '/api/v1/transactions') { send(res, 200, store.transactions(user, url.searchParams), rid); return; }
  const transactionMatch = /^\/api\/v1\/transactions\/(trade_[a-f0-9-]{36})$/.exec(path);
  if (method === 'GET' && transactionMatch?.[1]) { send(res, 200, store.transactionDetail(transactionMatch[1], user), rid); return; }
  const actionMatch = /^\/api\/v1\/transactions\/(trade_[a-f0-9-]{36})\/(accept|reject|complete|cancel)$/.exec(path);
  if (method === 'POST' && actionMatch?.[1] && actionMatch[2]) {
    send(res, 200, store.transition(actionMatch[1], user, actionMatch[2] as 'accept' | 'reject' | 'complete' | 'cancel'), rid); return;
  }
  const messagesMatch = /^\/api\/v1\/transactions\/(trade_[a-f0-9-]{36})\/messages$/.exec(path);
  if (messagesMatch?.[1] && method === 'GET') { send(res, 200, store.messages(messagesMatch[1], user, url.searchParams), rid); return; }
  if (messagesMatch?.[1] && method === 'POST') {
    send(res, 201, store.sendMessage(messagesMatch[1], user, await readJson(req), idempotencyKey(req)), rid); return;
  }
  if (method === 'POST' && path === '/api/agent/chat') {
    const outcome = await proxyAgent(req, store, user, await readJson(req), rid);
    send(res, outcome.status, outcome.body, rid); return;
  }
  if (method === 'GET' && path === '/api/v1/agent/conversations') {
    send(res, 200, { items: store.listConversations(user) }, rid); return;
  }
  const conversationMatch = /^\/api\/v1\/agent\/conversations\/(session_[a-zA-Z0-9_-]{1,100})$/.exec(path);
  if (method === 'GET' && conversationMatch?.[1]) {
    send(res, 200, store.conversationDetail(conversationMatch[1], user), rid); return;
  }
  if (method === 'DELETE' && conversationMatch?.[1]) {
    store.deleteConversation(conversationMatch[1], user);
    send(res, 200, { ok: true }, rid); return;
  }
  if (path.startsWith('/api/v1/admin/')) {
    store.requireAdmin(user);
    if (method === 'GET' && path === '/api/v1/admin/products') {
      send(res, 200, store.adminProducts(user, url.searchParams), rid); return;
    }
    if (method === 'GET' && path === '/api/v1/admin/transactions') {
      send(res, 200, store.adminTransactions(user, url.searchParams), rid); return;
    }
    const adminProduct = /^\/api\/v1\/admin\/products\/(listing_[a-z0-9_-]{1,64})\/(delist|relist)$/.exec(path);
    if (method === 'POST' && adminProduct?.[1] && adminProduct[2]) {
      send(res, 200, adminProduct[2] === 'delist'
        ? store.adminDelist(adminProduct[1], user) : store.adminRelist(adminProduct[1], user), rid); return;
    }
    const adminTrade = /^\/api\/v1\/admin\/transactions\/(trade_[a-f0-9-]{36})\/(cancel|restore)$/.exec(path);
    if (method === 'POST' && adminTrade?.[1] && adminTrade[2]) {
      send(res, 200, adminTrade[2] === 'cancel'
        ? store.adminCancel(adminTrade[1], user) : store.adminRestore(adminTrade[1], user), rid); return;
    }
    throw new ApiError(404, 'NOT_FOUND', '接口不存在');
  }
  throw new ApiError(404, 'NOT_FOUND', '接口不存在');
}

export function createApiApp(config: Config): ApiApp {
  const db = openDatabase(config);
  const store = new Store(db, config);
  store.cleanupAbandonedUploads();
  const server = createServer((req, res) => {
    const rid = requestId(req);
    const started = Date.now();
    res.on('finish', () => console.log(JSON.stringify({ event: 'http_request', requestId: rid,
      method: req.method, path: (req.url || '/').split('?')[0], status: res.statusCode, durationMs: Date.now() - started })));
    route(req, res, store, rid).catch(error => fail(res, error, rid));
  });
  return { server, db, close: () => new Promise<void>((resolve, reject) => server.close(error => {
    if (error) reject(error); else { db.close(); resolve(); }
  })) };
}
