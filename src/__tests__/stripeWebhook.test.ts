import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Stripe from 'stripe';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const WEBHOOK_SECRET = 'whsec_test_secret';

// Must be set before the router (and the Slack client behind it) is imported.
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
delete process.env.STRIPE_CONNECTED_WEBHOOK_SECRET;
// No bot token => the Slack client short-circuits, so notifications are inert here.
delete process.env.SLACK_BOT_TOKEN;

/* eslint-disable @typescript-eslint/no-var-requires */
const { pool } = require('../db/db') as typeof import('../db/db');
const { migrate } = require('../db/migrate') as typeof import('../db/migrate');
const stripeRouter = require('../routes/stripe').default as express.Router;

let server: Server;
let baseUrl: string;

before(async () => {
  await pool.query('DROP TABLE IF EXISTS withdrawals, deposits, users');
  await migrate();

  // Mirrors the body-parser wiring in index.ts.
  const app = express();
  app.use('/stripe/webhook', express.raw({ type: 'application/json' }));
  app.use('/stripe', stripeRouter);

  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM deposits');
});

function paymentIntentSucceeded(intentId: string, amountCents: number) {
  return JSON.stringify({
    id: `evt_${intentId}`,
    object: 'event',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: intentId,
        object: 'payment_intent',
        amount: amountCents,
        metadata: { user_id: 'user-42', username: 'alice' },
      },
    },
  });
}

async function deliver(payload: string): Promise<Response> {
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });

  return fetch(`${baseUrl}/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
}

/** The notifier is fire-and-forget; let its DB work settle before assertions. */
const settle = () => new Promise(resolve => setTimeout(resolve, 150));

test('records a deposit from a payment_intent.succeeded event', async () => {
  const response = await deliver(paymentIntentSucceeded('pi_first', 2500));
  await settle();

  assert.equal(response.status, 200);
  const rows = await pool.query('SELECT amount, user_id FROM deposits');
  assert.equal(rows.rowCount, 1);
  assert.equal(parseFloat(rows.rows[0].amount), 25.0);
});

test('a redelivered webhook does not create a second deposit', async () => {
  const payload = paymentIntentSucceeded('pi_retried', 2500);

  const first = await deliver(payload);
  await settle();
  const second = await deliver(payload);
  await settle();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200, 'a retry must ack, or Stripe keeps redelivering');

  const rows = await pool.query(
    `SELECT id FROM deposits WHERE stripe_payment_intent_id = 'pi_retried'`
  );
  assert.equal(rows.rowCount, 1, 'redelivery must not double-count the deposit');
});
