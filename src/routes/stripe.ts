import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { pool } from '../db/db';
import { notifyDeposit } from '../services/depositNotifier';

const router = Router();

router.post('/webhook', async (req: Request, res: Response) => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const stripe = new Stripe(secretKey);
  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[Stripe] Invalid signature:', err);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'payment_intent.succeeded') {
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
        notifyDeposit(userId ?? intent.id, amount).catch(console.error);
      } catch (err) {
        console.error('[Stripe] Failed to record deposit:', err);
        return res.status(500).json({ error: 'Failed to record deposit' });
      }
    }
  }

  return res.json({ received: true });
});

export default router;
