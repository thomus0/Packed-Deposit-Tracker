import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { pool } from '../db/db';
import { notifyDeposit } from '../services/depositNotifier';
import { notifyWithdrawal } from '../services/slackService';

const router = Router();

router.post('/webhook', async (req: Request, res: Response) => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const sig = req.headers['stripe-signature'] as string;

  if (!secretKey) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const stripe = new Stripe(secretKey);

  // Try connected account webhook secret first (withdrawals), then platform secret (deposits)
  const connectedSecret = process.env.STRIPE_CONNECTED_WEBHOOK_SECRET;
  const platformSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;
  let isConnectedAccount = false;

  if (connectedSecret) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, connectedSecret);
      isConnectedAccount = true;
    } catch {
      if (!platformSecret) {
        console.error('[Stripe] Invalid signature');
        return res.status(400).json({ error: 'Invalid signature' });
      }
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, platformSecret);
      } catch (err) {
        console.error('[Stripe] Invalid signature:', err);
        return res.status(400).json({ error: 'Invalid signature' });
      }
    }
  } else if (platformSecret) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, platformSecret);
    } catch (err) {
      console.error('[Stripe] Invalid signature:', err);
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } else {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  if (event.type === 'payment_intent.succeeded' && !isConnectedAccount) {
    const intent = event.data.object as Stripe.PaymentIntent;
    const userId = intent.metadata?.user_id ?? null;
    const amount = intent.amount / 100;

    if (amount > 0) {
      try {
        await pool.query(
          `INSERT INTO deposits (user_id, amount, payment_method, stripe_payment_intent_id)
           VALUES ($1, $2, 'stripe', $3)`,
          [userId, amount, intent.id]
        );
        const username = intent.metadata?.username ?? intent.receipt_email ?? userId ?? 'Unknown';
        notifyDeposit(username, amount, intent.id).catch(console.error);
      } catch (err) {
        console.error('[Stripe] Failed to record deposit:', err);
        return res.status(500).json({ error: 'Failed to record deposit' });
      }
    }
  }

  if (event.type === 'payout.created' && isConnectedAccount) {
    const payout = event.data.object as Stripe.Payout;
    const amount = payout.amount / 100;
    const connectedAccountId = (event as any).account as string ?? 'unknown';

    // Look up user_id from the most recent transfer to this connected account
    let userId = (payout.metadata as Record<string, string>)?.user_id ?? null;
    if (!userId) {
      try {
        const transfers = await stripe.transfers.list({ destination: connectedAccountId, limit: 1 });
        userId = transfers.data[0]?.metadata?.user_id ?? connectedAccountId;
      } catch {
        userId = connectedAccountId;
      }
    }
    const username = userId;

    try {
      await pool.query(
        'INSERT INTO withdrawals (user_id, amount) VALUES ($1, $2)',
        [userId, amount]
      );

      const [depositsResult, withdrawalsResult] = await Promise.all([
        pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE user_id = $1', [userId]),
        pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE user_id = $1', [userId]),
      ]);

      const totalDeposits = parseFloat(depositsResult.rows[0].total);
      const totalWithdrawals = parseFloat(withdrawalsResult.rows[0].total);

      notifyWithdrawal({ amount, username, totalDeposits, totalWithdrawals }).catch(console.error);
    } catch (err) {
      console.error('[Stripe] Failed to record payout:', err);
      return res.status(500).json({ error: 'Failed to record payout' });
    }
  }

  return res.json({ received: true });
});

export default router;
