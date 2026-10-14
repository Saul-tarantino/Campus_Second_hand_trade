import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Config } from '../src/config.js';
import { createApiApp } from '../src/server.js';

type Result = { status: number; body: any };

test('本机业务闭环、越权、幂等、Agent 契约与重启持久化', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'campusbazaar-api-'));
  let agentCalls = 0;
  let expectedListing = '';
  const agent = createServer(async (req, res) => {
    agentCalls++;
    assert.equal(req.headers['x-agent-service-token'], 'agent-service-token-test-a');
    assert.equal(req.headers['x-school-id'], 'school_demo');
    assert.equal(req.url, '/internal/agent/chat');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ requestId: input.requestId, sessionId: input.sessionId ?? 'session_test_1',
      status: 'completed', reply: '已找到商品', recommendations: [{ listingId: expectedListing, reasons: ['匹配'] }], relaxedConditions: [] }));
  });
  await new Promise<void>(resolve => agent.listen(0, '127.0.0.1', resolve));
  const agentAddress = agent.address();
  assert(agentAddress && typeof agentAddress !== 'string');
  const config: Config = {
    mode: 'local', host: '127.0.0.1', port: 0, databasePath: join(directory, 'database.sqlite'),
    uploadDir: join(directory, 'uploads'), publicBaseUrl: 'http://127.0.0.1:0',
    adminPhones: ['13900000000'],
    sessionSecret: 'this-is-a-long-random-test-only-session-secret', devLoginCode: '123456',
    agentBaseUrl: `http://127.0.0.1:${agentAddress.port}`, agentServiceToken: 'agent-service-token-test-a',
    internalAgentToken: 'business-backend-token-test-b', schoolId: 'school_demo'
  };
  let app = createApiApp(config);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  assert(address && typeof address !== 'string');
  let base = `http://127.0.0.1:${address.port}`;
  config.publicBaseUrl = base;

  async function call(method: string, path: string, token?: string, body?: unknown, extra: Record<string, string> = {}): Promise<Result> {
    const response = await fetch(base + path, { method, headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  try {
    assert.equal((await call('GET', '/health/ready')).status, 200);
    assert.equal((await call('POST', '/api/v1/auth/local/sessions', undefined, { phone: '13800000001', smsCode: '000000' })).status, 401);
    const loginA = await call('POST', '/api/v1/auth/local/sessions', undefined, { phone: '13800000001', smsCode: '123456' });
    const loginB = await call('POST', '/api/v1/auth/local/sessions', undefined, { phone: '13800000002', smsCode: '123456' });
    const loginC = await call('POST', '/api/v1/auth/local/sessions', undefined, { phone: '13800000003', smsCode: '123456' });
    assert.equal(loginA.status, 201);
    assert.notEqual(loginA.body.user.id, loginB.body.user.id);
    const a = loginA.body.token as string;
    const b = loginB.body.token as string;
    const c = loginC.body.token as string;
    assert.equal((await call('GET', '/api/v1/me', a)).body.id, loginA.body.user.id);
    assert.equal((await call('GET', '/api/v1/me')).status, 401);

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6GQAAAABJRU5ErkJggg==', 'base64');
    const uploadResponse = await fetch(base + '/api/v1/uploads', { method: 'POST', headers: { authorization: `Bearer ${a}`, 'content-type': 'image/png' }, body: png });
    assert.equal(uploadResponse.status, 201);
    const upload = await uploadResponse.json();
    assert.equal((await call('POST', '/api/v1/products', b, { title: '盗用图片', description: 'test', price: 2, imageIds: [upload.id] })).status, 403);
    const published = await call('POST', '/api/v1/products', a, {
      title: '高等数学教材', description: '无缺页', price: 45.5, imageIds: [upload.id], category: '教材', condition: 'good', campus: '江湾校区'
    });
    assert.equal(published.status, 201);
    expectedListing = published.body.id;
    assert.match(expectedListing, /^listing_[a-z0-9_-]{1,64}$/);
    assert.equal((await call('GET', `/api/v1/products/${expectedListing}`, b)).body.product.price, 45.5);
    assert.equal((await call('GET', '/api/v1/products?q=高等数学', b)).body.items.length, 1);
    assert.equal((await call('GET', '/api/v1/products?q=不存在', b)).body.items.length, 0);
    assert.equal((await call('POST', '/api/v1/products', a, { title: '无效价格', description: 'test', price: -1 })).status, 400);
    assert.equal((await call('POST', '/api/v1/products', a, { title: '非法图片', description: 'test', price: 1, imageIds: ['file://device/photo'] })).status, 403);
    const imageResult = await fetch(base + `/api/v1/images/${upload.id}`, { headers: { authorization: `Bearer ${b}` } });
    assert.equal(imageResult.status, 200);
    assert.equal((await imageResult.arrayBuffer()).byteLength, png.length);
    const signedImage = await fetch(published.body.images[0]);
    assert.equal(signedImage.status, 200);
    assert.equal((await signedImage.arrayBuffer()).byteLength, png.length);
    assert.equal((await fetch(published.body.images[0].replace('signature=', 'signature=0'))).status, 401);

    const internalHeaders = { authorization: `Bearer ${config.internalAgentToken}`, 'x-user-id': loginB.body.user.id, 'x-school-id': 'school_demo' };
    const search = await call('GET', '/internal/listings/search?keyword=高等数学&maxPriceCents=5000', undefined, undefined, internalHeaders);
    assert.equal(search.status, 200);
    assert.equal(search.body.listings[0].listingId, expectedListing);
    assert.equal(search.body.listings[0].priceCents, 4550);
    assert.equal(search.body.source, 'business_backend');
    assert.equal((await call('GET', '/internal/listings/search?keyword=高等数学%20教材&maxPriceCents=5000', undefined, undefined, internalHeaders)).body.total, 1);
    assert.equal((await call('GET', '/internal/listings/search?keyword=高数%20教材', undefined, undefined, internalHeaders)).body.total, 1);
    assert.equal((await call('GET', `/internal/listings/${expectedListing}`, undefined, undefined, internalHeaders)).body.sellerLabel, loginA.body.user.nickname);
    assert.deepEqual((await call('GET', '/internal/users/preferences', undefined, undefined, internalHeaders)).body.favoriteCategories, []);
    assert.equal((await call('GET', '/internal/listings/search', undefined, undefined, { ...internalHeaders, authorization: 'Bearer bad' })).status, 401);
    assert.equal((await call('GET', '/internal/listings/search', undefined, undefined, { ...internalHeaders, 'x-school-id': 'wrong' })).status, 403);

    const chat = await call('POST', '/api/agent/chat', b, { requestId: 'req_test_1', sessionId: null, message: '找高数书' });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.recommendations[0].listingId, expectedListing);
    assert.equal(agentCalls, 1);
    assert.equal((await call('POST', '/api/agent/chat', a, { requestId: 'req_test_2', sessionId: chat.body.sessionId, message: '继续' })).status, 403);
    assert.equal(agentCalls, 1);

    assert.equal((await call('POST', '/api/v1/transactions', a, { productId: expectedListing })).status, 403);
    const key = `trade_${randomUUID()}`;
    const trade = await call('POST', '/api/v1/transactions', b, { productId: expectedListing, buyerId: loginA.body.user.id }, { 'idempotency-key': key });
    assert.equal(trade.status, 201);
    assert.equal(trade.body.buyerId, loginB.body.user.id);
    assert.equal((await call('POST', '/api/v1/transactions', b, { productId: expectedListing, buyerId: loginA.body.user.id }, { 'idempotency-key': key })).body.id, trade.body.id);
    assert.equal((await call('POST', '/api/v1/transactions', c, { productId: expectedListing })).status, 409);
    assert.equal((await call('GET', `/api/v1/transactions/${trade.body.id}`, c)).status, 404);
    assert.equal((await call('POST', `/api/v1/transactions/${trade.body.id}/accept`, b)).status, 403);
    assert.equal((await call('GET', '/internal/listings/search?keyword=高等数学', undefined, undefined, internalHeaders)).body.total, 0);

    const messageKey = `message_${randomUUID()}`;
    const message = await call('POST', `/api/v1/transactions/${trade.body.id}/messages`, b, { content: '您好，方便面交吗？' }, { 'idempotency-key': messageKey });
    assert.equal(message.status, 201);
    assert.equal((await call('POST', `/api/v1/transactions/${trade.body.id}/messages`, b, { content: '您好，方便面交吗？' }, { 'idempotency-key': messageKey })).body.id, message.body.id);
    assert.equal((await call('POST', `/api/v1/transactions/${trade.body.id}/messages`, c, { content: '偷窥' })).status, 404);
    assert.equal((await call('GET', `/api/v1/transactions/${trade.body.id}/messages`, a)).body.items.length, 1);
    assert.equal((await call('POST', `/api/v1/transactions/${trade.body.id}/accept`, a)).body.status, 'ACCEPTED');
    assert.equal((await call('POST', `/api/v1/transactions/${trade.body.id}/complete`, a)).body.status, 'COMPLETED');
    assert.equal((await call('POST', `/api/v1/transactions/${trade.body.id}/messages`, b, { content: '晚了' })).status, 409);
    assert.equal((await call('POST', '/api/v1/transactions', c, { productId: expectedListing })).status, 409);

    const raceProduct = await call('POST', '/api/v1/products', a, { title: '竞价商品', description: '测试并发', price: 10 });
    const race = await Promise.all([call('POST', '/api/v1/transactions', b, { productId: raceProduct.body.id }),
      call('POST', '/api/v1/transactions', c, { productId: raceProduct.body.id })]);
    assert.deepEqual(race.map(result => result.status).sort(), [201, 409]);

    const releaseProduct = await call('POST', '/api/v1/products', a, { title: '释放占用', description: '测试拒绝后重购', price: 0.29 });
    assert.equal(releaseProduct.status, 201);
    const rejectedTrade = await call('POST', '/api/v1/transactions', b, { productId: releaseProduct.body.id });
    assert.equal((await call('POST', `/api/v1/transactions/${rejectedTrade.body.id}/reject`, a)).body.status, 'REJECTED');
    assert.equal((await call('POST', '/api/v1/transactions', c, { productId: releaseProduct.body.id })).status, 201);

    const concurrentProduct = await call('POST', '/api/v1/products', a, { title: '状态并发', description: '消息与拒绝同时进行', price: 1 });
    const concurrentTrade = await call('POST', '/api/v1/transactions', b, { productId: concurrentProduct.body.id });
    const concurrent = await Promise.all([
      call('POST', `/api/v1/transactions/${concurrentTrade.body.id}/messages`, b, { content: '同时发送' }),
      call('POST', `/api/v1/transactions/${concurrentTrade.body.id}/reject`, a)
    ]);
    assert.equal(concurrent[1]?.status, 200);
    assert([201, 409].includes(concurrent[0]!.status));
    const concurrentMessages = await call('GET', `/api/v1/transactions/${concurrentTrade.body.id}/messages`, a);
    assert.equal(concurrentMessages.body.items.length, concurrent[0]?.status === 201 ? 1 : 0);

    await app.close();
    app = createApiApp(config);
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const restartedAddress = app.server.address();
    assert(restartedAddress && typeof restartedAddress !== 'string');
    base = `http://127.0.0.1:${restartedAddress.port}`;
    assert.equal((await call('GET', `/api/v1/transactions/${trade.body.id}`, b)).body.transaction.status, 'COMPLETED');
    assert.equal((await call('GET', `/api/v1/transactions/${trade.body.id}/messages`, a)).body.items.length, 1);
    const restoredImage = await fetch(base + `/api/v1/images/${upload.id}`, { headers: { authorization: `Bearer ${b}` } });
    assert.equal(restoredImage.status, 200);
    assert.equal((await restoredImage.arrayBuffer()).byteLength, png.length);
    assert.equal((await call('GET', '/api/v1/me/products', a)).body.items.length, 4);
    assert.equal((await call('POST', '/api/v1/auth/logout', b)).status, 200);
    assert.equal((await call('GET', '/api/v1/me', b)).status, 401);
  } finally {
    await app.close();
    await new Promise<void>(resolve => agent.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
