/**
 * Database Connection - PostgreSQL with Drizzle ORM
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, Client } from 'pg';
import { config } from '../config/index.js';
import * as schema from './schema.js';

type DrizzleDB = ReturnType<typeof drizzle>;

let pool: Pool | null = null;
let db: DrizzleDB | null = null;

export async function initDatabase(): Promise<DrizzleDB> {
  if (db) return db;

  const testClient = new Client({ connectionString: config.database.url, connectionTimeoutMillis: 5000 });

  try {
    await testClient.connect();
    console.log('[DB] Connected to PostgreSQL');
    await testClient.end();
  } catch (err: any) {
    console.error('[DB] Failed to connect to PostgreSQL:', err.message);
    throw err;
  }

  pool = new Pool({
    connectionString: config.database.url,
    max: config.database.maxConnections,
  });
  db = drizzle(pool, { schema });
  return db;
}

/**
 * Get database instance
 */
export function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

/**
 * Get connection pool
 */
export function getPool() {
  if (!pool) throw new Error('Database pool not initialized');
  return pool;
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
    console.log('[DB] Connection closed');
  }
}

export { schema };
