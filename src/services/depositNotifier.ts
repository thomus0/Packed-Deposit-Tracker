import { pool } from '../db/db';
import { notifyNewUserDeposit, notifyReturningUserDeposit } from './slackService';

export async function notifyDeposit(username: string, amount: number, stripePaymentIntentId: string): Promise<void> {
  // Count all deposits from this same user (excluding the one just inserted)
  const result = await pool.query(
    `SELECT amount FROM deposits
     WHERE stripe_payment_intent_id != $1
     AND user_id = (SELECT user_id FROM deposits WHERE stripe_payment_intent_id = $1)`,
    [stripePaymentIntentId]
  );

  const previousDeposits = result.rows;
  const depositCount = previousDeposits.length + 1;
  const totalDeposited = previousDeposits.reduce((sum: number, d: { amount: string }) => sum + parseFloat(d.amount), 0) + amount;

  if (depositCount <= 1) {
    await notifyNewUserDeposit({ amount, username });
  } else {
    await notifyReturningUserDeposit({ amount, username, depositCount, totalDeposited });
  }
}
