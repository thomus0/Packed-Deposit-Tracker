import type { Pool } from 'pg';
import { pool } from '../db/db';

export interface Stats {
  depositCount: number;
  totalDeposits: number;
  avgDeposit: number;
  medianDeposit: number;
  largestDeposit: number;
  withdrawalCount: number;
  totalWithdrawals: number;
  avgWithdrawal: number;
  cashflow: number;
  uniqueDepositors: number;
  firstTimePayingUsers: number;
  repeatRate: number;
}

/** NUMERIC comes back from pg as a string; keep money at cent precision. */
function money(value: unknown): number {
  return Math.round(parseFloat(String(value ?? 0)) * 100) / 100;
}

/**
 * Every figure behind /stats, aggregated in Postgres rather than by pulling rows
 * into Node. Both windowed scans use the created_at indexes.
 *
 * Deposits with no user_id still count toward the money totals but have no
 * identity, so they are excluded from uniqueDepositors, firstTimePayingUsers
 * and repeatRate.
 */
export async function computeStats(since: Date, client: Pool = pool): Promise<Stats> {
  const [deposits, withdrawals, people] = await Promise.all([
    client.query(
      `SELECT count(*)::int                                                   AS count,
              coalesce(sum(amount), 0)                                        AS total,
              coalesce(avg(amount), 0)                                        AS avg,
              coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY amount), 0) AS median,
              coalesce(max(amount), 0)                                        AS largest
       FROM deposits
       WHERE created_at >= $1`,
      [since]
    ),
    client.query(
      `SELECT count(*)::int             AS count,
              coalesce(sum(amount), 0)  AS total,
              coalesce(avg(amount), 0)  AS avg
       FROM withdrawals
       WHERE created_at >= $1`,
      [since]
    ),
    // first_ever spans all history, so a returning user is never miscounted as
    // first-time; in_window restricts the repeat check to this window.
    client.query(
      `SELECT count(*)::int                                  AS unique_depositors,
              count(*) FILTER (WHERE first_ever >= $1)::int  AS first_time_payers,
              count(*) FILTER (WHERE in_window >= 2)::int    AS repeat_depositors
       FROM (
         SELECT user_id,
                min(created_at)                          AS first_ever,
                count(*) FILTER (WHERE created_at >= $1) AS in_window
         FROM deposits
         WHERE user_id IS NOT NULL
         GROUP BY user_id
       ) t
       WHERE in_window > 0`,
      [since]
    ),
  ]);

  const totalDeposits = money(deposits.rows[0].total);
  const totalWithdrawals = money(withdrawals.rows[0].total);
  const uniqueDepositors = people.rows[0].unique_depositors;

  return {
    depositCount: deposits.rows[0].count,
    totalDeposits,
    avgDeposit: money(deposits.rows[0].avg),
    medianDeposit: money(deposits.rows[0].median),
    largestDeposit: money(deposits.rows[0].largest),
    withdrawalCount: withdrawals.rows[0].count,
    totalWithdrawals,
    avgWithdrawal: money(withdrawals.rows[0].avg),
    cashflow: money(totalDeposits - totalWithdrawals),
    uniqueDepositors,
    firstTimePayingUsers: people.rows[0].first_time_payers,
    repeatRate: uniqueDepositors > 0 ? people.rows[0].repeat_depositors / uniqueDepositors : 0,
  };
}
