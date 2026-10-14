import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.js';
import { transaction } from './db.js';
import { ApiError, bodyHash, cursorDecode, cursorEncode, moneyToCents, optionalText, positiveInt, text, tokenHash } from './http.js';
import { categorySearchSpec, keywordGroups } from './search.js';

type UserRow = { id: string; phone: string; nickname: string; avatar: string; school_id: string; role: string };
type ProductStatus = 'ACTIVE' | 'SOLD' | 'OFFLINE';
type TransactionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';
type ProductRow = { id: string; seller_id: string; school_id: string; title: string; description: string; price_cents: number; category: string; condition: string; campus: string; version: string | null; status: ProductStatus; published_at: number };
type TransactionRow = { id: string; product_id: string; buyer_id: string; seller_id: string; school_id: string; create_time: number; status: TransactionStatus; price_cents: number; title_snapshot: string };
type MessageRow = { id: string; transaction_id: string; sender_id: string; content: string; send_time: number };
type ImageRow = { id: string; owner_id: string; product_id: string | null; mime: string; extension: string; size_bytes: number };
type ConversationRow = { id: string; user_id: string; school_id: string; title: string; created_at: number; updated_at: number; filters_json: string; displayed_ids_json: string; search_page: number };
type ConversationMessageRow = { id: string; conversation_id: string; role: 'user' | 'assistant'; content: string; recommendations_json: string; created_at: number };

const productIdPattern = /^listing_[a-z0-9_-]{1,64}$/;
const conditions = ['new', 'like_new', 'good', 'fair', 'unknown'];
const MAX_FILTER_VALUES = 40;
const MAX_PRICE_FILTERS = 8;
const MAX_CONVERSATIONS = 5;
const MAX_TITLE_CHARS = 20;

function conversationTitle(message: string): string {
  const cleaned = message.trim().replace(/\s+/gu, ' ');
  if (cleaned === '') return '新对话';
  return cleaned.length > MAX_TITLE_CHARS ? `${cleaned.slice(0, MAX_TITLE_CHARS)}…` : cleaned;
}

function safeFilters(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

function safeIdList(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 20) : [];
  } catch { return []; }
}

function safePage(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 1000 ? value : 1;
}

function multiValues(params: URLSearchParams, name: string): string[] {
  const values = params.getAll(name).flatMap(value => value.split(',')).map(value => value.trim()).filter(value => value !== '');
  if (values.length > MAX_FILTER_VALUES) throw new ApiError(400, 'BAD_REQUEST', `${name} 参数过多`);
  return values;
}

/** Parses a `min-max` price filter in yuan; either side may be omitted. */
function priceRangeCents(raw: string): { min?: number; max?: number } {
  const match = /^(\d+(?:\.\d{1,2})?)?\s*-\s*(\d+(?:\.\d{1,2})?)?$/.exec(raw);
  if (!match || (match[1] === undefined && match[2] === undefined)) {
    throw new ApiError(400, 'BAD_REQUEST', `价格区间格式不正确：${raw}`);
  }
  const min = match[1] === undefined ? undefined : Math.round(Number(match[1]) * 100);
  const max = match[2] === undefined ? undefined : Math.round(Number(match[2]) * 100);
  if (min !== undefined && max !== undefined && min > max) {
    throw new ApiError(400, 'BAD_REQUEST', `价格区间最小值不能大于最大值：${raw}`);
  }
  return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
}

/** Expands selected categories to every stored value in the same group. */
function categoryFilterValues(values: string[]): string[] {
  const expanded = new Set<string>();
  for (const value of values) {
    for (const member of categorySearchSpec(text(value, 'category', 1, 50)).exact) expanded.add(member);
  }
  return [...expanded].slice(0, MAX_FILTER_VALUES);
}

/** Same dimension uses OR, different dimensions are ANDed. */
function applyFeedFilters(where: string[], args: (string | number)[], params: URLSearchParams): void {
  const categories = categoryFilterValues(multiValues(params, 'category'));
  if (categories.length > 0) {
    where.push(`category IN (${categories.map(() => '?').join(',')})`);
    args.push(...categories);
  }
  const campuses = multiValues(params, 'campus').map(value => text(value, 'campus', 1, 100));
  if (campuses.length > 0) {
    where.push(`campus IN (${campuses.map(() => '?').join(',')})`);
    args.push(...campuses);
  }
  const ranges = multiValues(params, 'price').map(priceRangeCents);
  if (ranges.length > MAX_PRICE_FILTERS) throw new ApiError(400, 'BAD_REQUEST', `价格区间最多 ${MAX_PRICE_FILTERS} 个`);
  if (ranges.length > 0) {
    const clauses = ranges.map((range) => {
      if (range.min === undefined) { args.push(range.max!); return 'price_cents<=?'; }
      if (range.max === undefined) { args.push(range.min); return 'price_cents>=?'; }
      args.push(range.min, range.max);
      return '(price_cents>=? AND price_cents<=?)';
    });
    where.push(`(${clauses.join(' OR ')})`);
  }
}

export class Store {
  constructor(public db: DatabaseSync, public config: Config) {}

  cleanupAbandonedUploads(now = Date.now()): number {
    const rows = this.db.prepare('SELECT id,extension FROM product_images WHERE product_id IS NULL AND created_at<?')
      .all(now - 86_400_000) as { id: string; extension: string }[];
    let removed = 0;
    for (const row of rows) {
      if (!/^img_[a-f0-9]{32}$/.test(row.id) || !['jpg', 'png', 'webp'].includes(row.extension)) continue;
      const filename = join(this.config.uploadDir, `${row.id}.${row.extension}`);
      if (existsSync(filename)) unlinkSync(filename);
      this.db.prepare('DELETE FROM product_images WHERE id=? AND product_id IS NULL').run(row.id);
      removed++;
    }
    return removed;
  }

  user(row: UserRow): Record<string, unknown> {
    return { id: row.id, nickname: row.nickname, avatar: row.avatar, phone: row.phone, role: row.role };
  }

  findUser(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow | undefined;
  }

  login(body: Record<string, unknown>): { user: Record<string, unknown>; token: string; expiresAt: number } {
    const phone = text(body.phone, '手机号', 11, 11);
    if (!/^1\d{10}$/.test(phone)) throw new ApiError(400, 'BAD_REQUEST', '请输入 11 位手机号');
    if (body.smsCode !== this.config.devLoginCode && body.code !== this.config.devLoginCode) {
      throw new ApiError(401, 'INVALID_CODE', '验证码错误');
    }
    const now = Date.now();
    return transaction(this.db, () => {
      let row = this.db.prepare('SELECT * FROM users WHERE phone=?').get(phone) as UserRow | undefined;
      if (!row) {
        const id = `user_${randomUUID().replaceAll('-', '')}`;
        this.db.prepare('INSERT INTO users(id,phone,nickname,avatar,school_id,created_at) VALUES(?,?,?,?,?,?)')
          .run(id, phone, `同学${phone.slice(-4)}`, '', this.config.schoolId, now);
        row = this.findUser(id)!;
      }
      const shouldBeAdmin = this.config.adminPhones.includes(phone);
      if (shouldBeAdmin !== (row.role === 'admin')) {
        this.db.prepare('UPDATE users SET role=? WHERE id=?').run(shouldBeAdmin ? 'admin' : 'user', row.id);
        row = this.findUser(row.id)!;
      }
      const token = randomBytes(32).toString('base64url');
      const expiresAt = now + 7 * 86_400_000;
      this.db.prepare('INSERT INTO auth_sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)')
        .run(`auth_${randomUUID()}`, row.id, tokenHash(token, this.config), expiresAt);
      return { user: this.user(row), token, expiresAt };
    });
  }

  authenticate(token: string): UserRow {
    const row = this.db.prepare(`SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?`)
      .get(tokenHash(token, this.config), Date.now()) as UserRow | undefined;
    if (!row) throw new ApiError(401, 'UNAUTHORIZED', '登录已失效，请重新登录');
    return row;
  }

  logout(token: string): void {
    this.db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL')
      .run(Date.now(), tokenHash(token, this.config));
  }

  image(id: string): ImageRow | undefined {
    return this.db.prepare('SELECT * FROM product_images WHERE id=?').get(id) as ImageRow | undefined;
  }

  imageUrl(id: string): string {
    const expires = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const signature = createHmac('sha256', this.config.sessionSecret).update(`${id}:${expires}`).digest('hex');
    return `${this.config.publicBaseUrl}/api/v1/images/${id}?expires=${expires}&signature=${signature}`;
  }

  validImageSignature(id: string, params: URLSearchParams): boolean {
    const expires = Number(params.get('expires'));
    const provided = params.get('signature') ?? '';
    if (!Number.isSafeInteger(expires) || expires < Date.now() / 1000 || expires > Date.now() / 1000 + 24 * 60 * 60 + 60 || !/^[a-f0-9]{64}$/.test(provided)) return false;
    const expected = createHmac('sha256', this.config.sessionSecret).update(`${id}:${expires}`).digest('hex');
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  }

  product(row: ProductRow): Record<string, unknown> {
    const images = this.db.prepare('SELECT id FROM product_images WHERE product_id=? ORDER BY created_at,id').all(row.id) as { id: string }[];
    return {
      id: row.id, title: row.title, description: row.description, price: row.price_cents / 100,
      images: images.map(item => this.imageUrl(item.id)),
      publishTime: row.published_at, sellerId: row.seller_id,
      category: row.category, condition: row.condition, campus: row.campus,
      status: row.status, version: row.version
    };
  }

  findProduct(id: string): ProductRow | undefined {
    return this.db.prepare('SELECT * FROM products WHERE id=?').get(id) as ProductRow | undefined;
  }

  publicProduct(id: string, user: UserRow): { product: Record<string, unknown>; seller: Record<string, unknown> } {
    const row = this.findProduct(id);
    if (!row || row.school_id !== user.school_id) throw new ApiError(404, 'NOT_FOUND', '商品不存在');
    const canSeeSold = row.seller_id === user.id || !!this.db.prepare('SELECT 1 FROM transactions WHERE product_id=? AND buyer_id=? LIMIT 1').get(id, user.id);
    if (row.status !== 'ACTIVE' && !canSeeSold) throw new ApiError(404, 'NOT_FOUND', '商品不存在');
    return { product: this.product(row), seller: this.user(this.findUser(row.seller_id)!) };
  }

  products(user: UserRow, params: URLSearchParams, mine = false): { items: unknown[]; nextCursor: string | null } {
    const limit = params.has('limit') ? positiveInt(params.get('limit'), 'limit', 100) : 20;
    const cursor = cursorDecode(params.get('cursor'));
    const keyword = params.get('q')?.trim() || params.get('keyword')?.trim() || '';
    if (keyword.length > 100) throw new ApiError(400, 'BAD_REQUEST', '搜索词过长');
    const where = mine ? ['seller_id=?'] : ["school_id=?", "status='ACTIVE'"];
    const args: (string | number)[] = [mine ? user.id : user.school_id];
    if (!mine) where.push("NOT EXISTS (SELECT 1 FROM transactions t WHERE t.product_id=products.id AND t.status IN ('PENDING','ACCEPTED'))");
    if (keyword) { where.push('instr(lower(title),lower(?))>0'); args.push(keyword); }
    if (!mine) applyFeedFilters(where, args, params);
    if (cursor) { where.push('(published_at<? OR (published_at=? AND id<?))'); args.push(cursor[0], cursor[0], cursor[1]); }
    const rows = this.db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY published_at DESC,id DESC LIMIT ?`)
      .all(...args, limit + 1) as ProductRow[];
    const slice = rows.slice(0, limit);
    const last = slice.at(-1);
    return { items: slice.map(row => this.product(row)), nextCursor: rows.length > limit && last ? cursorEncode(last.published_at, last.id) : null };
  }

  publish(user: UserRow, body: Record<string, unknown>): Record<string, unknown> {
    const title = text(body.title, '商品名称', 1, 100);
    const description = text(body.description, '商品描述', 1, 3000);
    const priceCents = moneyToCents(body.price);
    const category = optionalText(body.category, '类别', 50) ?? '其他';
    const condition = optionalText(body.condition, '成色', 30) ?? 'unknown';
    if (!conditions.includes(condition)) throw new ApiError(400, 'BAD_REQUEST', '成色不支持');
    const campus = optionalText(body.campus, '校区', 100) ?? '未填写校区';
    const version = optionalText(body.version, '版本', 100) ?? null;
    const rawImages = body.imageIds ?? body.images ?? [];
    if (!Array.isArray(rawImages) || rawImages.length > 3 || rawImages.some(x => typeof x !== 'string') || new Set(rawImages).size !== rawImages.length) {
      throw new ApiError(400, 'BAD_REQUEST', '图片必须是最多三张不重复的上传 ID');
    }
    const imageIds = rawImages as string[];
    const id = `listing_${randomUUID().replaceAll('-', '')}`;
    const now = Date.now();
    transaction(this.db, () => {
      for (const imageId of imageIds) {
        const image = this.image(imageId);
        if (!image || image.owner_id !== user.id || image.product_id) throw new ApiError(403, 'IMAGE_FORBIDDEN', '图片不属于当前用户或已被使用');
      }
      this.db.prepare(`INSERT INTO products(id,seller_id,school_id,title,description,price_cents,category,condition,campus,version,status,published_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`).run(id, user.id, user.school_id, title, description, priceCents, category, condition, campus, version, now);
      for (const imageId of imageIds) this.db.prepare('UPDATE product_images SET product_id=? WHERE id=?').run(id, imageId);
    });
    return this.product(this.findProduct(id)!);
  }

  /** Seller takes an active listing off the market; an occupied listing must be released first. */
  delist(id: string, user: UserRow): Record<string, unknown> {
    return transaction(this.db, () => {
      const row = this.findProduct(id);
      if (!row || row.school_id !== user.school_id) throw new ApiError(404, 'NOT_FOUND', '商品不存在');
      if (row.seller_id !== user.id) throw new ApiError(403, 'FORBIDDEN', '只能下架自己发布的商品');
      if (row.status === 'SOLD') throw new ApiError(409, 'PRODUCT_SOLD', '商品已售出，无法下架');
      if (row.status === 'OFFLINE') return this.product(row);
      const occupied = this.db.prepare("SELECT 1 FROM transactions WHERE product_id=? AND status IN ('PENDING','ACCEPTED')").get(id);
      if (occupied) throw new ApiError(409, 'PRODUCT_OCCUPIED', '商品有进行中的交易，请先取消交易');
      const update = this.db.prepare("UPDATE products SET status='OFFLINE' WHERE id=? AND status='ACTIVE'").run(id);
      if (update.changes !== 1) throw new ApiError(409, 'INVALID_STATUS', '商品状态已变化');
      return this.product(this.findProduct(id)!);
    });
  }

  /** Seller puts an off-market listing back on sale. */
  relist(id: string, user: UserRow): Record<string, unknown> {
    return transaction(this.db, () => {
      const row = this.findProduct(id);
      if (!row || row.school_id !== user.school_id) throw new ApiError(404, 'NOT_FOUND', '商品不存在');
      if (row.seller_id !== user.id) throw new ApiError(403, 'FORBIDDEN', '只能上架自己发布的商品');
      if (row.status === 'ACTIVE') return this.product(row);
      if (row.status === 'SOLD') throw new ApiError(409, 'PRODUCT_SOLD', '商品已售出，无法重新上架');
      const update = this.db.prepare("UPDATE products SET status='ACTIVE' WHERE id=? AND status='OFFLINE'").run(id);
      if (update.changes !== 1) throw new ApiError(409, 'INVALID_STATUS', '商品状态已变化');
      return this.product(this.findProduct(id)!);
    });
  }

  transactionView(row: TransactionRow): Record<string, unknown> {
    return { id: row.id, productId: row.product_id, buyerId: row.buyer_id, sellerId: row.seller_id,
      createTime: row.create_time, status: row.status, priceAtPurchase: row.price_cents / 100, titleAtPurchase: row.title_snapshot };
  }

  messageView(row: MessageRow): Record<string, unknown> {
    return { id: row.id, transactionId: row.transaction_id, senderId: row.sender_id, content: row.content, sendTime: row.send_time };
  }

  findTransaction(id: string, user: UserRow): TransactionRow {
    const row = this.db.prepare('SELECT * FROM transactions WHERE id=? AND school_id=? AND (buyer_id=? OR seller_id=?)')
      .get(id, user.school_id, user.id, user.id) as TransactionRow | undefined;
    if (!row) throw new ApiError(404, 'NOT_FOUND', '交易不存在');
    return row;
  }

  transactionDetail(id: string, user: UserRow): Record<string, unknown> {
    const row = this.findTransaction(id, user);
    return { transaction: this.transactionView(row), product: this.product(this.findProduct(row.product_id)!),
      buyer: this.user(this.findUser(row.buyer_id)!), seller: this.user(this.findUser(row.seller_id)!) };
  }

  transactions(user: UserRow, params: URLSearchParams): { items: unknown[]; nextCursor: string | null } {
    const limit = params.has('limit') ? positiveInt(params.get('limit'), 'limit', 100) : 20;
    const cursor = cursorDecode(params.get('cursor'));
    const args: (string | number)[] = [user.school_id, user.id, user.id];
    const continuation = cursor ? 'AND (create_time<? OR (create_time=? AND id<?))' : '';
    if (cursor) args.push(cursor[0], cursor[0], cursor[1]);
    const rows = this.db.prepare(`SELECT * FROM transactions WHERE school_id=? AND (buyer_id=? OR seller_id=?) ${continuation} ORDER BY create_time DESC,id DESC LIMIT ?`)
      .all(...args, limit + 1) as TransactionRow[];
    const slice = rows.slice(0, limit);
    const items = slice.map(row => {
      const other = row.buyer_id === user.id ? row.seller_id : row.buyer_id;
      const latest = this.db.prepare('SELECT * FROM messages WHERE transaction_id=? ORDER BY send_time DESC,id DESC LIMIT 1').get(row.id) as MessageRow | undefined;
      return { transaction: this.transactionView(row), product: this.product(this.findProduct(row.product_id)!),
        counterparty: this.user(this.findUser(other)!), ...(latest ? { latestMessage: this.messageView(latest) } : {}) };
    });
    const last = slice.at(-1);
    return { items, nextCursor: rows.length > limit && last ? cursorEncode(last.create_time, last.id) : null };
  }

  private replay(scope: string, userId: string, key: string | undefined, input: unknown): unknown | undefined {
    if (!key) return undefined;
    const row = this.db.prepare('SELECT request_hash,response_json FROM idempotency_records WHERE scope=? AND user_id=? AND key=?')
      .get(scope, userId, key) as { request_hash: string; response_json: string } | undefined;
    if (!row) return undefined;
    if (row.request_hash !== bodyHash(input)) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
    return JSON.parse(row.response_json) as unknown;
  }

  private remember(scope: string, userId: string, key: string | undefined, input: unknown, result: unknown): void {
    if (key) this.db.prepare('INSERT INTO idempotency_records VALUES(?,?,?,?,?,?)')
      .run(scope, userId, key, bodyHash(input), JSON.stringify(result), Date.now());
  }

  createTransaction(user: UserRow, body: Record<string, unknown>, key?: string): Record<string, unknown> {
    const productId = text(body.productId, '商品 ID', 1, 100);
    return transaction(this.db, () => {
      const replay = this.replay('create_transaction', user.id, key, body);
      if (replay) return replay as Record<string, unknown>;
      const product = this.findProduct(productId);
      if (!product || product.school_id !== user.school_id) throw new ApiError(404, 'NOT_FOUND', '商品不存在');
      if (product.seller_id === user.id) throw new ApiError(403, 'OWN_PRODUCT', '不能购买自己的商品');
      if (product.status !== 'ACTIVE') throw new ApiError(409, 'PRODUCT_SOLD', '商品已售出');
      const occupied = this.db.prepare("SELECT 1 FROM transactions WHERE product_id=? AND status IN ('PENDING','ACCEPTED')").get(productId);
      if (occupied) throw new ApiError(409, 'PRODUCT_OCCUPIED', '商品已有进行中的交易');
      const id = `trade_${randomUUID()}`;
      const now = Date.now();
      this.db.prepare(`INSERT INTO transactions(id,product_id,buyer_id,seller_id,school_id,create_time,status,price_cents,title_snapshot)
        VALUES(?,?,?,?,?,?,'PENDING',?,?)`).run(id, productId, user.id, product.seller_id, user.school_id, now, product.price_cents, product.title);
      const result = this.transactionView(this.findTransaction(id, user));
      this.remember('create_transaction', user.id, key, body, result);
      return result;
    });
  }

  transition(id: string, user: UserRow, action: 'accept' | 'reject' | 'complete' | 'cancel'): Record<string, unknown> {
    return transaction(this.db, () => {
      const row = this.findTransaction(id, user);
      if (action === 'cancel') {
        if (row.status !== 'PENDING' && row.status !== 'ACCEPTED') {
          throw new ApiError(409, 'INVALID_STATUS', '交易已结束，无法取消');
        }
        const cancelled = this.db.prepare("UPDATE transactions SET status='CANCELLED' WHERE id=? AND status IN ('PENDING','ACCEPTED')").run(id);
        if (cancelled.changes !== 1) throw new ApiError(409, 'INVALID_STATUS', '交易状态已变化');
        return this.transactionView(this.findTransaction(id, user));
      }
      const expected = action === 'complete' ? 'ACCEPTED' : 'PENDING';
      const next = { accept: 'ACCEPTED', reject: 'REJECTED', complete: 'COMPLETED' }[action];
      if (row.seller_id !== user.id) throw new ApiError(403, 'FORBIDDEN', '只有卖家可以处理交易');
      if (row.status !== expected) throw new ApiError(409, 'INVALID_STATUS', '交易状态不允许此操作');
      const update = this.db.prepare('UPDATE transactions SET status=? WHERE id=? AND status=?').run(next, id, expected);
      if (update.changes !== 1) throw new ApiError(409, 'INVALID_STATUS', '交易状态已变化');
      if (next === 'COMPLETED') this.db.prepare("UPDATE products SET status='SOLD' WHERE id=? AND status='ACTIVE'").run(row.product_id);
      return this.transactionView(this.findTransaction(id, user));
    });
  }

  messages(id: string, user: UserRow, params: URLSearchParams): { items: unknown[]; nextCursor: string | null } {
    this.findTransaction(id, user);
    const limit = params.has('limit') ? positiveInt(params.get('limit'), 'limit', 100) : 50;
    const cursor = cursorDecode(params.get('cursor'));
    const args: (string | number)[] = [id];
    const continuation = cursor ? 'AND (send_time>? OR (send_time=? AND id>?))' : '';
    if (cursor) args.push(cursor[0], cursor[0], cursor[1]);
    const rows = this.db.prepare(`SELECT * FROM messages WHERE transaction_id=? ${continuation} ORDER BY send_time,id LIMIT ?`)
      .all(...args, limit + 1) as MessageRow[];
    const slice = rows.slice(0, limit);
    const last = slice.at(-1);
    return { items: slice.map(row => this.messageView(row)), nextCursor: rows.length > limit && last ? cursorEncode(last.send_time, last.id) : null };
  }

  sendMessage(id: string, user: UserRow, body: Record<string, unknown>, key?: string): Record<string, unknown> {
    const content = text(body.content, '消息', 1, 2000);
    return transaction(this.db, () => {
      const row = this.findTransaction(id, user);
      const replay = this.replay(`message:${id}`, user.id, key, body);
      if (replay) return replay as Record<string, unknown>;
      if (!['PENDING', 'ACCEPTED'].includes(row.status)) throw new ApiError(409, 'TRANSACTION_CLOSED', '交易已结束，仅可查看历史消息');
      const messageId = `msg_${randomUUID()}`;
      this.db.prepare('INSERT INTO messages(id,transaction_id,sender_id,content,send_time) VALUES(?,?,?,?,?)')
        .run(messageId, id, user.id, content, Date.now());
      const result = this.messageView(this.db.prepare('SELECT * FROM messages WHERE id=?').get(messageId) as MessageRow);
      this.remember(`message:${id}`, user.id, key, body, result);
      return result;
    });
  }

  private conversationOwned(sessionId: string, user: UserRow): ConversationRow {
    const row = this.db.prepare('SELECT * FROM agent_conversations WHERE id=?').get(sessionId) as ConversationRow | undefined;
    if (!row) throw new ApiError(404, 'SESSION_NOT_FOUND', '对话不存在或已删除');
    if (row.user_id !== user.id) throw new ApiError(403, 'SESSION_FORBIDDEN', '不能访问其他用户的对话');
    return row;
  }

  /** Newest activity first, capped at the retention limit. */
  listConversations(user: UserRow): Record<string, unknown>[] {
    const rows = this.db.prepare(`SELECT * FROM agent_conversations WHERE user_id=?
      ORDER BY updated_at DESC, id DESC LIMIT ?`).all(user.id, MAX_CONVERSATIONS) as ConversationRow[];
    return rows.map(row => {
      const last = this.db.prepare(`SELECT role, content FROM agent_conversation_messages
        WHERE conversation_id=? ORDER BY created_at DESC, id DESC LIMIT 1`).get(row.id) as { role: string; content: string } | undefined;
      const count = (this.db.prepare('SELECT COUNT(*) AS n FROM agent_conversation_messages WHERE conversation_id=?')
        .get(row.id) as { n: number }).n;
      return {
        sessionId: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at,
        messageCount: count,
        ...(last ? { lastMessageRole: last.role, lastMessage: last.content } : {})
      };
    });
  }

  conversationDetail(sessionId: string, user: UserRow): Record<string, unknown> {
    const row = this.conversationOwned(sessionId, user);
    const rows = this.db.prepare(`SELECT * FROM agent_conversation_messages WHERE conversation_id=?
      ORDER BY created_at, id`).all(sessionId) as ConversationMessageRow[];
    return {
      conversation: { sessionId: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at },
      messages: rows.map(item => ({
        id: item.id, role: item.role, content: item.content, createdAt: item.created_at,
        recommendations: item.role === 'assistant' ? safeIdList(item.recommendations_json) : []
      }))
    };
  }

  deleteConversation(sessionId: string, user: UserRow): void {
    transaction(this.db, () => {
      this.conversationOwned(sessionId, user);
      this.db.prepare('DELETE FROM agent_conversation_messages WHERE conversation_id=?').run(sessionId);
      this.db.prepare('DELETE FROM agent_conversations WHERE id=?').run(sessionId);
    });
  }

  /** Resumable state handed to the Agent when it no longer holds the session in memory. */
  conversationState(sessionId: string, user: UserRow): Record<string, unknown> {
    const row = this.conversationOwned(sessionId, user);
    return { filters: safeFilters(row.filters_json), displayedListingIds: safeIdList(row.displayed_ids_json), searchPage: safePage(row.search_page) };
  }

  recordAgentTurn(input: { sessionId: string; user: UserRow; message: string; reply: string;
    recommendations: unknown[]; state?: Record<string, unknown> | undefined }): void {
    const now = Date.now();
    transaction(this.db, () => {
      const existing = this.db.prepare('SELECT * FROM agent_conversations WHERE id=?').get(input.sessionId) as ConversationRow | undefined;
      if (existing && existing.user_id !== input.user.id) throw new ApiError(403, 'SESSION_FORBIDDEN', 'Agent 会话归属冲突');
      if (existing) {
        this.db.prepare('UPDATE agent_conversations SET updated_at=? WHERE id=?').run(now, input.sessionId);
      } else {
        this.db.prepare(`INSERT INTO agent_conversations(id,user_id,school_id,title,created_at,updated_at)
          VALUES(?,?,?,?,?,?)`).run(input.sessionId, input.user.id, input.user.school_id, conversationTitle(input.message), now, now);
      }
      const insert = this.db.prepare(`INSERT INTO agent_conversation_messages(id,conversation_id,role,content,recommendations_json,created_at)
        VALUES(?,?,?,?,?,?)`);
      insert.run(`amsg_${randomUUID()}`, input.sessionId, 'user', input.message, '[]', now);
      insert.run(`amsg_${randomUUID()}`, input.sessionId, 'assistant', input.reply, JSON.stringify(input.recommendations.slice(0, 10)), now + 1);
      if (input.state) {
        this.db.prepare('UPDATE agent_conversations SET filters_json=?, displayed_ids_json=?, search_page=? WHERE id=?')
          .run(JSON.stringify(input.state.filters ?? {}), JSON.stringify(input.state.displayedListingIds ?? []),
            safePage(input.state.searchPage), input.sessionId);
      }
      this.pruneConversations(input.user);
    });
  }

  /** Retention limit: the least recently used conversations are removed with their messages. */
  pruneConversations(user: UserRow): number {
    const stale = this.db.prepare(`SELECT id FROM agent_conversations WHERE user_id=?
      ORDER BY updated_at DESC, id DESC LIMIT -1 OFFSET ?`).all(user.id, MAX_CONVERSATIONS) as { id: string }[];
    for (const row of stale) {
      this.db.prepare('DELETE FROM agent_conversation_messages WHERE conversation_id=?').run(row.id);
      this.db.prepare('DELETE FROM agent_conversations WHERE id=?').run(row.id);
    }
    return stale.length;
  }

  isAdmin(user: UserRow): boolean {
    return user.role === 'admin';
  }

  requireAdmin(user: UserRow): void {
    if (user.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', '需要管理员权限');
  }

  /** Every product of the school, including occupied, offline and sold ones. */
  adminProducts(user: UserRow, params: URLSearchParams): { items: unknown[]; nextCursor: string | null } {
    this.requireAdmin(user);
    const limit = params.has('limit') ? positiveInt(params.get('limit'), 'limit', 100) : 50;
    const cursor = cursorDecode(params.get('cursor'));
    const where = ['school_id=?'];
    const args: (string | number)[] = [user.school_id];
    const status = params.get('status');
    if (status) { where.push('status=?'); args.push(text(status, 'status', 1, 20)); }
    if (cursor) { where.push('(published_at<? OR (published_at=? AND id<?))'); args.push(cursor[0], cursor[0], cursor[1]); }
    const rows = this.db.prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY published_at DESC,id DESC LIMIT ?`)
      .all(...args, limit + 1) as ProductRow[];
    const slice = rows.slice(0, limit);
    const items = slice.map(row => ({
      ...this.product(row),
      seller: this.user(this.findUser(row.seller_id)!),
      activeTransactionCount: (this.db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE product_id=? AND status IN ('PENDING','ACCEPTED')")
        .get(row.id) as { n: number }).n
    }));
    const last = slice.at(-1);
    return { items, nextCursor: rows.length > limit && last ? cursorEncode(last.published_at, last.id) : null };
  }

  /** Every transaction of the school, any status. */
  adminTransactions(user: UserRow, params: URLSearchParams): { items: unknown[]; nextCursor: string | null } {
    this.requireAdmin(user);
    const limit = params.has('limit') ? positiveInt(params.get('limit'), 'limit', 100) : 50;
    const cursor = cursorDecode(params.get('cursor'));
    const where = ['school_id=?'];
    const args: (string | number)[] = [user.school_id];
    const status = params.get('status');
    if (status) { where.push('status=?'); args.push(text(status, 'status', 1, 20)); }
    if (cursor) { where.push('(create_time<? OR (create_time=? AND id<?))'); args.push(cursor[0], cursor[0], cursor[1]); }
    const rows = this.db.prepare(`SELECT * FROM transactions WHERE ${where.join(' AND ')} ORDER BY create_time DESC,id DESC LIMIT ?`)
      .all(...args, limit + 1) as TransactionRow[];
    const slice = rows.slice(0, limit);
    const items = slice.map(row => ({ transaction: this.transactionView(row),
      product: this.product(this.findProduct(row.product_id)!),
      buyer: this.user(this.findUser(row.buyer_id)!), seller: this.user(this.findUser(row.seller_id)!) }));
    const last = slice.at(-1);
    return { items, nextCursor: rows.length > limit && last ? cursorEncode(last.create_time, last.id) : null };
  }

  private scopedTransaction(id: string, schoolId: string): TransactionRow {
    const row = this.db.prepare('SELECT * FROM transactions WHERE id=? AND school_id=?').get(id, schoolId) as TransactionRow | undefined;
    if (!row) throw new ApiError(404, 'NOT_FOUND', '交易不存在');
    return row;
  }

  /** Administrator delist: no ownership requirement, but an occupied listing must be released first. */
  adminDelist(id: string, user: UserRow): Record<string, unknown> {
    this.requireAdmin(user);
    return transaction(this.db, () => {
      const row = this.findProduct(id);
      if (!row || row.school_id !== user.school_id) throw new ApiError(404, 'NOT_FOUND', '商品不存在');
      if (row.status === 'OFFLINE') return this.product(row);
      const occupied = this.db.prepare("SELECT 1 FROM transactions WHERE product_id=? AND status IN ('PENDING','ACCEPTED')").get(id);
      if (occupied) throw new ApiError(409, 'PRODUCT_OCCUPIED', '商品有进行中的交易，请先取消交易');
      const update = this.db.prepare("UPDATE products SET status='OFFLINE' WHERE id=? AND status IN ('ACTIVE','SOLD')").run(id);
      if (update.changes !== 1) throw new ApiError(409, 'INVALID_STATUS', '商品状态已变化');
      return this.product(this.findProduct(id)!);
    });
  }

  adminRelist(id: string, user: UserRow): Record<string, unknown> {
    this.requireAdmin(user);
    return transaction(this.db, () => {
      const row = this.findProduct(id);
      if (!row || row.school_id !== user.school_id) throw new ApiError(404, 'NOT_FOUND', '商品不存在');
      if (row.status === 'ACTIVE') return this.product(row);
      const occupied = this.db.prepare("SELECT 1 FROM transactions WHERE product_id=? AND status IN ('PENDING','ACCEPTED')").get(id);
      if (occupied) throw new ApiError(409, 'PRODUCT_OCCUPIED', '商品有进行中的交易，请先取消交易');
      const update = this.db.prepare("UPDATE products SET status='ACTIVE' WHERE id=? AND status='OFFLINE'").run(id);
      if (update.changes !== 1) throw new ApiError(409, 'INVALID_STATUS', '商品状态已变化');
      return this.product(this.findProduct(id)!);
    });
  }

  /** Administrator cancel: releases the product back to sellable. */
  adminCancel(id: string, user: UserRow): Record<string, unknown> {
    this.requireAdmin(user);
    return transaction(this.db, () => {
      const row = this.scopedTransaction(id, user.school_id);
      if (row.status !== 'PENDING' && row.status !== 'ACCEPTED') throw new ApiError(409, 'INVALID_STATUS', '交易已结束，无法取消');
      const cancelled = this.db.prepare("UPDATE transactions SET status='CANCELLED' WHERE id=? AND status IN ('PENDING','ACCEPTED')").run(id);
      if (cancelled.changes !== 1) throw new ApiError(409, 'INVALID_STATUS', '交易状态已变化');
      return this.transactionView(this.scopedTransaction(id, user.school_id));
    });
  }

  /** Undo a terminal transaction: the deal becomes active again and the product sellable. */
  adminRestore(id: string, user: UserRow): Record<string, unknown> {
    this.requireAdmin(user);
    return transaction(this.db, () => {
      const row = this.scopedTransaction(id, user.school_id);
      if (row.status === 'COMPLETED') {
        this.db.prepare("UPDATE transactions SET status='ACCEPTED' WHERE id=? AND status='COMPLETED'").run(id);
        this.db.prepare("UPDATE products SET status='ACTIVE' WHERE id=? AND status='SOLD'").run(row.product_id);
      } else if (row.status === 'CANCELLED' || row.status === 'REJECTED') {
        const busy = this.db.prepare("SELECT 1 FROM transactions WHERE product_id=? AND id<>? AND status IN ('PENDING','ACCEPTED')").get(row.product_id, id);
        if (busy) throw new ApiError(409, 'PRODUCT_OCCUPIED', '该商品已有新的进行中交易，无法恢复这笔交易');
        this.db.prepare("UPDATE transactions SET status='PENDING' WHERE id=? AND status IN ('CANCELLED','REJECTED')").run(id);
      } else {
        throw new ApiError(409, 'INVALID_STATUS', '该交易处于进行中，无需恢复');
      }
      return this.transactionView(this.scopedTransaction(id, user.school_id));
    });
  }

  internalUser(userId: string, schoolId: string): UserRow {
    const row = this.findUser(userId);
    if (!row || row.school_id !== schoolId) throw new ApiError(403, 'FORBIDDEN', '用户或学校范围无效');
    return row;
  }

  listing(row: ProductRow, detail = false): Record<string, unknown> {
    const firstImage = this.db.prepare('SELECT id FROM product_images WHERE product_id=? ORDER BY created_at,id LIMIT 1').get(row.id) as { id: string } | undefined;
    const base: Record<string, unknown> = {
      listingId: row.id, title: row.title, category: row.category, priceCents: row.price_cents,
      condition: row.condition, campus: row.campus, description: row.description,
      status: 'active', schoolId: row.school_id
    };
    if (firstImage) base.imageUrl = this.imageUrl(firstImage.id);
    if (detail) {
      base.sellerLabel = this.findUser(row.seller_id)!.nickname;
      base.publishedAt = new Date(row.published_at).toISOString();
      if (row.version) base.version = row.version;
    }
    return base;
  }

  internalListing(id: string, user: UserRow): Record<string, unknown> {
    if (!productIdPattern.test(id)) throw new ApiError(400, 'BAD_REQUEST', 'listingId 格式不正确');
    const row = this.findProduct(id);
    if (!row || row.school_id !== user.school_id || row.status !== 'ACTIVE') throw new ApiError(404, 'NOT_FOUND', '商品不存在');
    const occupied = this.db.prepare("SELECT 1 FROM transactions WHERE product_id=? AND status IN ('PENDING','ACCEPTED')").get(id);
    if (occupied) throw new ApiError(404, 'NOT_FOUND', '商品暂不可购买');
    return this.listing(row, true);
  }

  internalSearch(user: UserRow, params: URLSearchParams): Record<string, unknown> {
    const page = params.has('page') ? positiveInt(params.get('page'), 'page', 10000) : 1;
    const pageSize = params.has('pageSize') ? positiveInt(params.get('pageSize'), 'pageSize', 10) : 10;
    const hard: Record<string, unknown> = {};
    const soft: Record<string, unknown> = {};
    const where = ["p.school_id=?", "p.status='ACTIVE'", "NOT EXISTS (SELECT 1 FROM transactions t WHERE t.product_id=p.id AND t.status IN ('PENDING','ACCEPTED'))"];
    const args: (string | number)[] = [user.school_id];
    const category = params.get('category');
    if (category) {
      const checked = text(category, 'category', 1, 50);
      hard.category = checked;
      const spec = categorySearchSpec(checked);
      const exact = `p.category IN (${spec.exact.map(() => '?').join(',')})`;
      args.push(...spec.exact);
      if (spec.grouped) {
        const terms = spec.grouped.keywords.map(() =>
          '(instr(lower(p.title),lower(?))>0 OR instr(lower(p.description),lower(?))>0)'
        ).join(' OR ');
        where.push(`(${exact} OR (p.category=? AND (${terms})))`);
        args.push(spec.grouped.category);
        for (const term of spec.grouped.keywords) args.push(term, term);
      } else where.push(exact);
    }
    for (const [key, column, max] of [
      ['campus','campus',100], ['condition','condition',30], ['version','version',100]
    ] as const) {
      const value = params.get(key);
      if (value) { const checked = text(value, key, 1, max); hard[key] = checked; where.push(`p.${column}=?`); args.push(checked); }
    }
    const keyword = params.get('keyword');
    if (keyword) {
      const checked = text(keyword, 'keyword', 1, 100);
      hard.keyword = checked;
      for (const aliases of keywordGroups(checked)) {
        where.push(`(${aliases.map(() =>
          '(instr(lower(p.title),lower(?))>0 OR instr(lower(p.category),lower(?))>0 OR instr(lower(p.description),lower(?))>0 OR instr(lower(coalesce(p.version,\'\')),lower(?))>0)'
        ).join(' OR ')})`);
        for (const alias of aliases) args.push(alias, alias, alias, alias);
      }
    }
    for (const [key, op] of [['minPriceCents','>='],['maxPriceCents','<=']] as const) {
      const value = params.get(key);
      if (value !== null) { const num = Number(value); if (!Number.isSafeInteger(num) || num < 0 || num > 10_000_000) throw new ApiError(400, 'BAD_REQUEST', `${key} 无效`);
        hard[key] = num; where.push(`p.price_cents${op}?`); args.push(num); }
    }
    const preferredCampus = params.get('preferredCampus');
    if (preferredCampus) soft.preferredCampus = text(preferredCampus, 'preferredCampus', 1, 100);
    const clause = where.join(' AND ');
    const total = (this.db.prepare(`SELECT count(*) AS n FROM products p WHERE ${clause}`).get(...args) as { n: number }).n;
    const offset = (page - 1) * pageSize;
    const preferredOrder = preferredCampus ? 'CASE WHEN p.campus=? THEN 0 ELSE 1 END,' : '';
    const orderArgs = preferredCampus ? [preferredCampus] : [];
    const rows = this.db.prepare(`SELECT p.* FROM products p WHERE ${clause} ORDER BY ${preferredOrder}p.published_at DESC,p.id DESC LIMIT ? OFFSET ?`)
      .all(...args, ...orderArgs, pageSize, offset) as ProductRow[];
    return { listings: rows.map(row => this.listing(row)), page, pageSize, total, hasMore: offset + rows.length < total,
      appliedConditions: { hard, soft }, source: 'business_backend' };
  }

  preferences(user: UserRow): Record<string, unknown> {
    const row = this.db.prepare('SELECT * FROM user_preferences WHERE user_id=?').get(user.id) as
      { favorite_categories: string; preferred_campuses: string; price_ceiling_cents: number | null } | undefined;
    return { favoriteCategories: row ? JSON.parse(row.favorite_categories) : [],
      preferredCampuses: row ? JSON.parse(row.preferred_campuses) : [],
      ...(row?.price_ceiling_cents != null ? { priceCeilingCents: row.price_ceiling_cents } : {}), source: 'business_backend' };
  }
}
