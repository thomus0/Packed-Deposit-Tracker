import 'dotenv/config';
import type { Pool } from 'pg';
import { pool } from './db';

export async function migrate(client: Pool = pool): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT,
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT,
      amount NUMERIC(10,2) NOT NULL,
      payment_method TEXT DEFAULT 'stripe',
      stripe_payment_intent_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT,
      amount NUMERIC(10,2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- /stats windows both tables by created_at on every invocation.
    CREATE INDEX IF NOT EXISTS deposits_created_at_idx ON deposits (created_at);
    CREATE INDEX IF NOT EXISTS withdrawals_created_at_idx ON withdrawals (created_at);

    -- Collapse duplicates that webhook redeliveries already recorded, keeping the
    -- earliest row per intent. Without this the unique index below cannot be built.
    DELETE FROM deposits a USING deposits b
    WHERE a.stripe_payment_intent_id IS NOT NULL
      AND a.stripe_payment_intent_id = b.stripe_payment_intent_id
      AND (a.created_at, a.id) > (b.created_at, b.id);

    -- Makes redelivery a no-op via ON CONFLICT. NULLs stay exempt, so rows
    -- recorded without an intent id are unaffected.
    CREATE UNIQUE INDEX IF NOT EXISTS deposits_stripe_payment_intent_id_uniq
      ON deposits (stripe_payment_intent_id);
  `);

  console.log('[migrate] Tables ready');
}

// Only run when invoked directly (npm run migrate), never on import.
if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch(err => {
      console.error('[migrate] Failed:', err);
      process.exit(1);
    });
}
