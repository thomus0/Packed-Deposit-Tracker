import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../db/db';
import { sendStatsMessage } from '../services/slackService';

const router = Router();

function verifySlackSignature(req: Request): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return true;

  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const slackSig = req.headers['x-slack-signature'] as string;
  if (!timestamp || !slackSig) return false;

  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const baseString = `v0:${timestamp}:${(req as Request & { rawBody?: string }).rawBody ?? ''}`;
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(baseString);
  const computed = `v0=${hmac.digest('hex')}`;

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(slackSig));
}

router.post('/', async (req: Request, res: Response) => {
  if (!verifySlackSignature(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { command, text, channel_id } = req.body as {
    command: string;
    text: string;
    channel_id: string;
  };

  if (command === '/stats') {
    const days = Math.max(1, parseInt(text?.trim()) || 1);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Acknowledge immediately — Slack times out after 3 seconds
    res.json({
      response_type: 'in_channel',
      text: `⏳ Pulling stats for the last ${days * 24} hours...`,
    });

    try {
      const [depositsResult, withdrawalsResult, newUsersResult] = await Promise.all([
        pool.query('SELECT user_id, amount FROM deposits WHERE created_at >= $1', [since]),
        pool.query('SELECT amount FROM withdrawals WHERE created_at >= $1', [since]),
        pool.query('SELECT id FROM users WHERE created_at >= $1', [since]),
      ]);

      const deposits = depositsResult.rows;
      const withdrawals = withdrawalsResult.rows;

      const depositCount = deposits.length;
      const totalDeposits = deposits.reduce((s: number, d: { amount: string }) => s + parseFloat(d.amount), 0);
      const avgDeposit = depositCount > 0 ? totalDeposits / depositCount : 0;
      const totalWithdrawals = withdrawals.reduce((s: number, w: { amount: string }) => s + parseFloat(w.amount), 0);
      const cashflow = totalDeposits - totalWithdrawals;

      // First-time paying users: users whose very first deposit is within the window
      const uniqueUserIds = [...new Set(deposits.map((d: { user_id: string }) => d.user_id))];
      let firstTimePayingUsers = 0;

      if (uniqueUserIds.length > 0) {
        const firstDepositsResult = await pool.query(
          `SELECT user_id, MIN(created_at) as first_deposit
           FROM deposits
           WHERE user_id = ANY($1)
           GROUP BY user_id
           HAVING MIN(created_at) >= $2`,
          [uniqueUserIds, since]
        );
        firstTimePayingUsers = firstDepositsResult.rows.length;
      }

      await sendStatsMessage(channel_id, days, {
        newUsers: newUsersResult.rows.length,
        firstTimePayingUsers,
        totalDeposits,
        depositCount,
        avgDeposit,
        cashflow,
        totalWithdrawals,
      });
    } catch (err) {
      console.error('[SlackCommands] /stats error:', err);
    }

    return;
  }

  return res.json({ text: `Unknown command: ${command}` });
});

export default router;
