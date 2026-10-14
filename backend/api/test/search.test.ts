import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import type { Config } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { Store } from '../src/store.js';

function fixture() {
  const config: Config = {
    mode: 'local', host: '127.0.0.1', port: 0, databasePath: ':memory:', uploadDir: tmpdir(),
    publicBaseUrl: 'http://127.0.0.1', sessionSecret: 'test-search-secret-longer-than-thirty-two-characters',
    devLoginCode: '123456', agentBaseUrl: 'http://127.0.0.1:3000',
    agentServiceToken: 'test-search-agent-service-token', internalAgentToken: 'test-search-internal-token', schoolId: 'school_demo',
    adminPhones: []
  };
  const db = openDatabase(config);
  const store = new Store(db, config);
  const session = store.login({ phone: '13800000001', smsCode: '123456' });
  const user = store.authenticate(session.token);
  const insert = db.prepare(`INSERT INTO products
    (id,seller_id,school_id,title,description,price_cents,category,condition,campus,status,published_at)
    VALUES(?,?,?,?,'测试商品',?,'教材','like_new','邯郸校区',?,1)`);
  insert.run('listing_english', user.id, user.school_id, 'english book', 10_000_000, 'ACTIVE');
  insert.run('listing_chinese', user.id, user.school_id, '英语课本', 5000, 'ACTIVE');
  insert.run('listing_math', user.id, user.school_id, '高等数学教材', 3000, 'ACTIVE');
  insert.run('listing_foreign', user.id, 'school_other', 'english book', 3000, 'ACTIVE');
  insert.run('listing_sold', user.id, user.school_id, 'english book', 3000, 'SOLD');
  insert.run('listing_reserved', user.id, user.school_id, 'english book', 3000, 'ACTIVE');
  db.prepare(`INSERT INTO transactions
    (id,product_id,buyer_id,seller_id,school_id,create_time,status,price_cents,title_snapshot)
    VALUES('trade_reserved','listing_reserved',?,?,?,1,'PENDING',3000,'english book')`)
    .run(user.id, user.id, user.school_id);
  const search = (keyword: string, extra: Record<string, string> = {}) => {
    const result = store.internalSearch(user, new URLSearchParams({ keyword, ...extra }));
    return (result.listings as Array<{ listingId: string }>).map(item => item.listingId).sort();
  };
  const add = (id: string, title: string, category: string, school = user.school_id, status = 'ACTIVE') => {
    db.prepare(`INSERT INTO products
      (id,seller_id,school_id,title,description,price_cents,category,condition,campus,status,published_at)
      VALUES(?,?,?,?,'测试商品',5000,?,'like_new','邯郸校区',?,2)`)
      .run(id, user.id, school, title, category, status);
  };
  return { db, search, add };
}

test('英语书与 English book 可以交叉搜索，且保持学校、在售和交易占用限制', t => {
  const { db, search } = fixture();
  t.after(() => db.close());
  for (const query of ['英语', '英语书', '英文教材', 'English book', 'english textbooks']) {
    assert.deepEqual(search(query), ['listing_chinese', 'listing_english'], query);
  }
  assert.deepEqual(search('english keyboard'), []);
});

test('大类搜索包含新商品与历史小类，并继续执行学校和在售限制', t => {
  const { db, search, add } = fixture();
  t.after(() => db.close());
  add('listing_old_keyboard', '机械键盘', '键盘');
  add('listing_new_keyboard', '机械键盘', '外设');
  add('listing_new_headphone', '蓝牙耳机', '外设');
  add('listing_foreign_keyboard', '机械键盘', '外设', 'school_other');
  add('listing_sold_keyboard', '机械键盘', '外设', 'school_demo', 'SOLD');
  add('listing_old_daily', '台灯', '生活用品');
  add('listing_new_daily', '收纳盒', '日用');
  assert.deepEqual(search('', { category: '外设' }), ['listing_new_headphone', 'listing_new_keyboard', 'listing_old_keyboard']);
  assert.deepEqual(search('', { category: '日用' }), ['listing_new_daily', 'listing_old_daily']);
  assert.deepEqual(search('', { category: '教材' }), ['listing_chinese', 'listing_english', 'listing_math']);
});

test('按具体小物件搜索新大类时不会混入同类其他物件，预算仍有效', t => {
  const { db, search, add } = fixture();
  t.after(() => db.close());
  add('listing_old_keyboard', '机械键盘', '键盘');
  add('listing_new_keyboard', 'mechanical keyboard', '外设');
  add('listing_new_headphone', '蓝牙耳机', '外设');
  add('listing_new_bike', '山地单车', '运动');
  assert.deepEqual(search('', { category: '键盘' }), ['listing_new_keyboard', 'listing_old_keyboard']);
  assert.deepEqual(search('键盘', { category: '外设' }), ['listing_new_keyboard', 'listing_old_keyboard']);
  assert.deepEqual(search('', { category: '耳机' }), ['listing_new_headphone']);
  assert.deepEqual(search('', { category: '自行车' }), ['listing_new_bike']);
  assert.deepEqual(search('', { category: '键盘', maxPriceCents: '4000' }), []);
});

test('中英文同义匹配仍严格执行预算和校区条件', t => {
  const { db, search } = fixture();
  t.after(() => db.close());
  assert.deepEqual(search('英语书', { maxPriceCents: '8000' }), ['listing_chinese']);
  assert.deepEqual(search('english book', { maxPriceCents: '8000' }), ['listing_chinese']);
  assert.deepEqual(search('English book', { campus: '江湾校区' }), []);
});
