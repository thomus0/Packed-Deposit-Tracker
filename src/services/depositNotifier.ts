import { pool } from '../db/db';
import { notifyNewUserDeposit, notifyReturningUserDeposit } from './slackService';

export async function notifyDeposit(userId: string, amount: number): Promise<void> {
  const userResult = await pool.query(
    'SELECT username, email FROM users WHERE id = $1',
    [userId]
  );
  const user = userResult.rows[0];
  const username = user?.username ?? user?.email ?? userId;

  const depositsResult = await pool.query(
    'SELECT amount FROM deposits WHERE user_id = $1',
    [userId]
  );

  const allDeposits = depositsResult.rows;
  const depositCount = allDeposits.length;
  const totalDeposited = allDeposits.reduce((sum: number, d: { amount: string }) => sum + parseFloat(d.amount), 0);

  if (depositCount <= 1) {
    await notifyNewUserDeposit({ amount, username });
  } else {
    await notifyReturningUserDeposit({ amount, username, depositCount, totalDeposited });
  }
}
