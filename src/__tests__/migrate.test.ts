import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../db/db';
import { migrate } from '../db/migrate';

before(async () => {
  await pool.query('DROP TABLE IF EXISTS withdrawals, deposits, users');
});

after(async () => {
  await pool.end();
});

test('creates the tables when they do not exist yet', async () => {
  await migrate();

  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('users', 'deposits', 'withdrawals')
     ORDER BY table_name`
  );

  assert.deepEqual(
    result.rows.map(r => r.table_name),
    ['deposits', 'users', 'withdrawals']
  );
});

test('indexes the created_at columns that /stats filters on', async () => {
  await migrate();

  const result = await pool.query<{ tablename: string; indexdef: string }>(
    `SELECT tablename, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename IN ('deposits', 'withdrawals')`
  );

  const indexesCreatedAt = (table: string) =>
    result.rows.some(r => r.tablename === table && /\(created_at/.test(r.indexdef));

  assert.ok(indexesCreatedAt('deposits'), 'deposits needs an index on created_at');
  assert.ok(indexesCreatedAt('withdrawals'), 'withdrawals needs an index on created_at');
});

test('collapses duplicate payment intents left behind by earlier redeliveries', async () => {
  await migrate();
  // Recreate the pre-fix state: duplicates were possible before the unique index.
  await pool.query('DROP INDEX IF EXISTS deposits_stripe_payment_intent_id_uniq');
  await pool.query(
    `INSERT INTO deposits (user_id, amount, stripe_payment_intent_id, created_at) VALUES
       ('user-dupe', 10.00, 'pi_double_charged', NOW() - INTERVAL '2 hours'),
       ('user-dupe', 10.00, 'pi_double_charged', NOW() - INTERVAL '1 hour')`
  );

  await migrate();

  const result = await pool.query<{ created_at: Date }>(
    `SELECT created_at FROM deposits WHERE stripe_payment_intent_id = 'pi_double_charged'`
  );
  assert.equal(result.rowCount, 1, 'duplicates should collapse to a single row');

  const ageMinutes = (Date.now() - result.rows[0].created_at.getTime()) / 60000;
  assert.ok(ageMinutes > 90, 'the earliest row should be the survivor');
});

test('leaves rows without a payment intent id untouched', async () => {
  await migrate();
  await pool.query(
    `INSERT INTO deposits (user_id, amount, stripe_payment_intent_id) VALUES
       ('user-a', 5.00, NULL),
       ('user-b', 6.00, NULL)`
  );

  await migrate();

  const result = await pool.query(
    'SELECT id FROM deposits WHERE stripe_payment_intent_id IS NULL'
  );
  assert.equal(result.rowCount, 2, 'NULL intent ids are not duplicates of each other');
});

test('upgrades a legacy schema so the deposit webhook can insert', async () => {
  // The schema production was actually running: tables from the original
  // migration, with no unique index on stripe_payment_intent_id.
  await pool.query('DROP TABLE IF EXISTS withdrawals, deposits, users');
  await pool.query(`
    CREATE TABLE deposits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT,
      amount NUMERIC(10,2) NOT NULL,
      payment_method TEXT DEFAULT 'stripe',
      stripe_payment_intent_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // The INSERT in routes/stripe.ts, verbatim. Without the index Postgres
  // raises 42P10 and every deposit webhook 500s.
  const depositInsert = `INSERT INTO deposits (user_id, amount, payment_method, stripe_payment_intent_id)
     VALUES ($1, $2, 'stripe', $3)
     ON CONFLICT (stripe_payment_intent_id) DO NOTHING
     RETURNING id`;

  await assert.rejects(
    () => pool.query(depositInsert, ['user-legacy', 25.0, 'pi_legacy']),
    /no unique or exclusion constraint/,
    'precondition: the legacy schema cannot serve this INSERT'
  );

  await migrate();

  const inserted = await pool.query(depositInsert, ['user-legacy', 25.0, 'pi_legacy']);
  assert.equal(inserted.rowCount, 1, 'migrate() must supply the index the webhook depends on');
});

test('preserves existing rows when re-run', async () => {
  await migrate();
  await pool.query(
    `INSERT INTO deposits (user_id, amount, stripe_payment_intent_id)
     VALUES ('user-keepme', 42.00, 'pi_survives_migration')`
  );

  await migrate();

  const result = await pool.query<{ amount: string }>(
    `SELECT amount FROM deposits WHERE stripe_payment_intent_id = 'pi_survives_migration'`
  );
  assert.equal(result.rowCount, 1, 'deposit row should survive a second migrate()');
  assert.equal(parseFloat(result.rows[0].amount), 42.0);
});
