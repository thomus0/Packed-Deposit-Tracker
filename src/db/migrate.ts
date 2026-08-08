import 'dotenv/config';
import { pool } from './db';

async function migrate() {
  await pool.query(`
    DROP TABLE IF EXISTS withdrawals;
    DROP TABLE IF EXISTS deposits;
    DROP TABLE IF EXISTS users;

    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT,
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE deposits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT,
      amount NUMERIC(10,2) NOT NULL,
      payment_method TEXT DEFAULT 'stripe',
      stripe_payment_intent_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE withdrawals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT,
      amount NUMERIC(10,2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('[migrate] Tables ready');
  await pool.end();
}

migrate().catch(err => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
