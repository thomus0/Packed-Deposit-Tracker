import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatStatsMessage } from '../services/slackService';
import type { Stats } from '../services/statsService';

/** Mirrors the real /stats 5 output the team sees in Slack. */
const stats: Stats = {
  depositCount: 1507,
  totalDeposits: 24528.81,
  avgDeposit: 16.28,
  medianDeposit: 9.99,
  largestDeposit: 500,
  withdrawalCount: 101,
  totalWithdrawals: 5817.89,
  avgWithdrawal: 57.6,
  cashflow: 18710.92,
  uniqueDepositors: 812,
  firstTimePayingUsers: 589,
  repeatRate: 1 / 3,
};

test('labels a multi-day window in days, not hours', () => {
  assert.match(formatStatsMessage(5, stats), /last 5 days/);
});

test('labels a single-day window as 24 hours', () => {
  assert.match(formatStatsMessage(1, stats), /last 24 hours/);
});

test('formats money as USD with thousands separators', () => {
  const message = formatStatsMessage(5, stats);

  assert.match(message, /Total Deposits: \*\$24,528\.81\*/);
  assert.match(message, /Total Withdrawals: \*\$5,817\.89\*/);
  assert.match(message, /Cashflow: \*\$18,710\.92\*/);
});

test('separates median from average so skew is visible', () => {
  const message = formatStatsMessage(5, stats);

  assert.match(message, /Average: \*\$16\.28\*/);
  assert.match(message, /Median: \*\$9\.99\*/);
  assert.match(message, /Largest: \*\$500\.00\*/);
});

test('reports withdrawal count alongside the withdrawal total', () => {
  const message = formatStatsMessage(5, stats);

  assert.match(message, /Count: \*101\*/);
  assert.match(message, /Average: \*\$57\.60\*/);
});

test('groups counts with thousands separators', () => {
  assert.match(formatStatsMessage(5, stats), /Count: \*1,507\*/);
});

test('renders repeat rate as a whole percentage', () => {
  assert.match(formatStatsMessage(5, stats), /Repeat Rate: \*33%\*/);
});

test('reports unique depositors and first-time payers', () => {
  const message = formatStatsMessage(5, stats);

  assert.match(message, /Unique Depositors: \*812\*/);
  assert.match(message, /First-Time Payers: \*589\*/);
});

test('drops the permanently-zero New Users line', () => {
  assert.doesNotMatch(formatStatsMessage(5, stats), /New Users/);
});

test('shows zeroes without NaN or Infinity on an empty window', () => {
  const empty: Stats = {
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
  };

  const message = formatStatsMessage(1, empty);

  assert.doesNotMatch(message, /NaN|Infinity/);
  assert.match(message, /Repeat Rate: \*0%\*/);
});
