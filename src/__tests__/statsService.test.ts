import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../db/db';
import { migrate } from '../db/migrate';
import { computeStats } from '../services/statsService';

/** Start of the reporting window used by every test below. */
const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

before(async () => {
  await pool.query('DROP TABLE IF EXISTS withdrawals, deposits, users');
  await migrate();
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM deposits');
  await pool.query('DELETE FROM withdrawals');

  // In-window deposits: 10, 20, 30, 40, 200 -> total 300, avg 60, median 30, max 200.
  // Deliberately different so an avg/median mix-up cannot pass.
  await pool.query(`
    INSERT INTO deposits (user_id, amount, stripe_payment_intent_id, created_at) VALUES
      ('user-a', 100.00, 'pi_a_old', NOW() - INTERVAL '30 days'),
      ('user-a',  20.00, 'pi_a_new', NOW() - INTERVAL '2 hours'),
      ('user-b',  10.00, 'pi_b_1',   NOW() - INTERVAL '3 hours'),
      ('user-b',  30.00, 'pi_b_2',   NOW() - INTERVAL '1 hour'),
      ('user-c',  40.00, 'pi_c_1',   NOW() - INTERVAL '5 hours'),
      (NULL,     200.00, 'pi_anon',  NOW() - INTERVAL '4 hours')
  `);

  await pool.query(`
    INSERT INTO withdrawals (user_id, amount, created_at) VALUES
      ('user-a',  25.00, NOW() - INTERVAL '2 hours'),
      ('user-b',  75.00, NOW() - INTERVAL '1 hour'),
      ('user-c', 999.00, NOW() - INTERVAL '10 days')
  `);
});

test('totals only the deposits inside the window', async () => {
  const stats = await computeStats(since);

  assert.equal(stats.depositCount, 5, 'the 30-day-old deposit is outside the window');
  assert.equal(stats.totalDeposits, 300);
});

test('reports median separately from average', async () => {
  const stats = await computeStats(since);

  assert.equal(stats.avgDeposit, 60);
  assert.equal(stats.medianDeposit, 30);
});

test('reports the largest deposit in the window', async () => {
  const stats = await computeStats(since);

  assert.equal(stats.largestDeposit, 200);
});

test('counts withdrawals as well as summing them', async () => {
  const stats = await computeStats(since);

  assert.equal(stats.withdrawalCount, 2, 'the 10-day-old withdrawal is outside the window');
  assert.equal(stats.totalWithdrawals, 100);
  assert.equal(stats.avgWithdrawal, 50);
});

test('cashflow is deposits minus withdrawals', async () => {
  const stats = await computeStats(since);

  assert.equal(stats.cashflow, 200);
});

test('counts unique depositors, excluding anonymous deposits', async () => {
  const stats = await computeStats(since);

  assert.equal(stats.uniqueDepositors, 3, 'user-a, user-b, user-c; the NULL row has no identity');
});

test('counts only users whose first ever deposit falls in the window', async () => {
  const stats = await computeStats(since);

  assert.equal(stats.firstTimePayingUsers, 2, 'user-a first deposited 30 days ago');
});

test('repeat rate is the share of depositors with more than one deposit', async () => {
  const stats = await computeStats(since);

  // user-b deposited twice in the window; user-a and user-c once each.
  assert.ok(
    Math.abs(stats.repeatRate - 1 / 3) < 1e-9,
    `expected 1/3, got ${stats.repeatRate}`
  );
});

test('returns zeroes rather than nulls for an empty window', async () => {
  await pool.query('DELETE FROM deposits');
  await pool.query('DELETE FROM withdrawals');

  const stats = await computeStats(since);

  assert.deepEqual(stats, {
    depositCount: 0,
    totalDeposits: 0,
    avgDeposit: 0,
    medianDeposit: 0,
    largestDeposit: 0,
    withdrawalCount: 0,
    totalWithdrawals: 0,
    avgWithdrawal: 0,
    cashflow: 0,
    uniqueDepositors: 0,
    firstTimePayingUsers: 0,
    repeatRate: 0,
  });
});
