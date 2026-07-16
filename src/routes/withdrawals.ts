import { Router, Request, Response } from 'express';
import { pool } from '../db/db';
import { notifyWithdrawal } from '../services/slackService';

const router = Router();

// POST /withdrawals — record a withdrawal and fire Slack notification
router.post('/', async (req: Request, res: Response) => {
  const { user_id, amount, username } = req.body as {
    user_id: string;
    amount: number;
    username?: string;
  };

  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be > 0' });

  try {
    await pool.query(
      'INSERT INTO withdrawals (user_id, amount) VALUES ($1, $2)',
      [user_id, amount]
    );

    // Get totals for this user
    const [depositsResult, withdrawalsResult] = await Promise.all([
      pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE user_id = $1', [user_id]),
      pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE user_id = $1', [user_id]),
    ]);

    const totalDeposits = parseFloat(depositsResult.rows[0].total);
    const totalWithdrawals = parseFloat(withdrawalsResult.rows[0].total);
    const displayName = username ?? user_id;

    notifyWithdrawal({ amount, username: displayName, totalDeposits, totalWithdrawals }).catch(console.error);

    return res.status(201).json({ message: 'Withdrawal recorded' });
  } catch (err) {
    console.error('[Withdrawals] Failed:', err);
    return res.status(500).json({ error: 'Failed to record withdrawal' });
  }
});

export default router;
