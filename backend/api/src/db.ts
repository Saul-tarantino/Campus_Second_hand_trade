import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.js';

export function openDatabase(config: Config): DatabaseSync {
  mkdirSync(dirname(config.databasePath), { recursive: true });
  mkdirSync(config.uploadDir, { recursive: true });
  const db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  migrate(db);
  return db;
}

const SCHEMA_VERSION = 4;

function migrate(db: DatabaseSync): void {
  const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version.user_version > SCHEMA_VERSION) throw new Error('Database schema is newer than this API');
  if (version.user_version >= SCHEMA_VERSION) return;
  if (version.user_version === 0) createInitialSchema(db);
  if (version.user_version < 2) upgradeToV2(db);
  if (version.user_version < 3) upgradeToV3(db);
  upgradeToV4(db);
}

/** Adds the account role that grants administrator access. */
function upgradeToV4(db: DatabaseSync): void {
  db.exec(`
    BEGIN IMMEDIATE;
    ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
    CREATE INDEX users_role ON users(role);
    PRAGMA user_version=4;
    COMMIT;
  `);
}

function createInitialSchema(db: DatabaseSync): void {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE users (
      id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL,
      avatar TEXT NOT NULL DEFAULT '', school_id TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE auth_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, revoked_at INTEGER
    );
    CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
    CREATE TABLE products (
      id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES users(id), school_id TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents > 0),
      category TEXT NOT NULL, condition TEXT NOT NULL, campus TEXT NOT NULL, version TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SOLD')),
      published_at INTEGER NOT NULL
    );
    CREATE INDEX products_feed ON products(school_id,status,published_at DESC,id DESC);
    CREATE INDEX products_seller ON products(seller_id,published_at DESC,id DESC);
    CREATE TABLE product_images (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
      product_id TEXT REFERENCES products(id), mime TEXT NOT NULL, extension TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX product_images_product ON product_images(product_id);
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
      buyer_id TEXT NOT NULL REFERENCES users(id), seller_id TEXT NOT NULL REFERENCES users(id),
      school_id TEXT NOT NULL, create_time INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING','ACCEPTED','REJECTED','COMPLETED')),
      price_cents INTEGER NOT NULL, title_snapshot TEXT NOT NULL
    );
    CREATE UNIQUE INDEX one_active_transaction_per_product ON transactions(product_id)
      WHERE status IN ('PENDING','ACCEPTED');
    CREATE INDEX transactions_buyer ON transactions(buyer_id,create_time DESC,id DESC);
    CREATE INDEX transactions_seller ON transactions(seller_id,create_time DESC,id DESC);
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id),
      sender_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, send_time INTEGER NOT NULL
    );
    CREATE INDEX messages_feed ON messages(transaction_id,send_time,id);
    CREATE TABLE idempotency_records (
      scope TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL,
      request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(scope,user_id,key)
    );
    CREATE TABLE agent_sessions (
      session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL
    );
    CREATE TABLE user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id), favorite_categories TEXT NOT NULL DEFAULT '[]',
      preferred_campuses TEXT NOT NULL DEFAULT '[]', price_ceiling_cents INTEGER
    );
    PRAGMA user_version=1;
    COMMIT;
  `);
}

/** Adds the OFFLINE product status and the CANCELLED transaction status. */
function upgradeToV2(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;');
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE products_v2 (
        id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES users(id), school_id TEXT NOT NULL,
        title TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents > 0),
        category TEXT NOT NULL, condition TEXT NOT NULL, campus TEXT NOT NULL, version TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SOLD','OFFLINE')),
        published_at INTEGER NOT NULL
      );
      INSERT INTO products_v2 SELECT id,seller_id,school_id,title,description,price_cents,category,condition,campus,version,status,published_at FROM products;
      DROP TABLE products;
      ALTER TABLE products_v2 RENAME TO products;
      CREATE INDEX products_feed ON products(school_id,status,published_at DESC,id DESC);
      CREATE INDEX products_seller ON products(seller_id,published_at DESC,id DESC);
      CREATE INDEX products_campus ON products(school_id,status,campus);

      CREATE TABLE transactions_v2 (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
        buyer_id TEXT NOT NULL REFERENCES users(id), seller_id TEXT NOT NULL REFERENCES users(id),
        school_id TEXT NOT NULL, create_time INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING','ACCEPTED','REJECTED','COMPLETED','CANCELLED')),
        price_cents INTEGER NOT NULL, title_snapshot TEXT NOT NULL
      );
      INSERT INTO transactions_v2(id,product_id,buyer_id,seller_id,school_id,create_time,status,price_cents,title_snapshot)
        SELECT id,product_id,buyer_id,seller_id,school_id,create_time,status,price_cents,title_snapshot FROM transactions;
      DROP TABLE transactions;
      ALTER TABLE transactions_v2 RENAME TO transactions;
      CREATE UNIQUE INDEX one_active_transaction_per_product ON transactions(product_id)
        WHERE status IN ('PENDING','ACCEPTED');
      CREATE INDEX transactions_buyer ON transactions(buyer_id,create_time DESC,id DESC);
      CREATE INDEX transactions_seller ON transactions(seller_id,create_time DESC,id DESC);
      PRAGMA user_version=2;
      COMMIT;
    `);
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length > 0) throw new Error(`Database migration left ${violations.length} foreign key violation(s)`);
  } finally {
    db.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;');
  }
}

/** Keeps Agent conversations (transcript plus resumable state) instead of only the ownership map. */
function upgradeToV3(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys=OFF;');
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE agent_conversations (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), school_id TEXT NOT NULL,
        title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        filters_json TEXT NOT NULL DEFAULT '{}', displayed_ids_json TEXT NOT NULL DEFAULT '[]',
        search_page INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX agent_conversations_user ON agent_conversations(user_id, updated_at DESC, id DESC);
      CREATE TABLE agent_conversation_messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES agent_conversations(id),
        role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
        recommendations_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
      );
      CREATE INDEX agent_conversation_messages_feed ON agent_conversation_messages(conversation_id, created_at, id);
      INSERT INTO agent_conversations(id, user_id, school_id, title, created_at, updated_at)
        SELECT s.session_id, s.user_id, u.school_id, '历史对话', s.created_at, s.created_at
        FROM agent_sessions s JOIN users u ON u.id = s.user_id;
      DROP TABLE agent_sessions;
      PRAGMA user_version=3;
      COMMIT;
    `);
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length > 0) throw new Error(`Database migration left ${violations.length} foreign key violation(s)`);
  } finally {
    db.exec('PRAGMA foreign_keys=ON;');
  }
}

export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
