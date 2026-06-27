import 'dotenv/config';
import express from 'express';
import { pool } from './db/db';
import stripeRouter from './routes/stripe';
import slackCommandsRouter from './routes/slackCommands';

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

// Stripe webhooks need the raw body for signature verification
app.use('/stripe/webhook', express.raw({ type: 'application/json' }));

// Slack slash commands come as URL-encoded form data
app.use('/slack/commands', express.urlencoded({ extended: true }), (req: express.Request, _res: express.Response, next: express.NextFunction) => {
  (req as express.Request & { rawBody?: string }).rawBody = new URLSearchParams(req.body as Record<string, string>).toString();
  next();
});

app.use(express.json());

app.use('/stripe', stripeRouter);
app.use('/slack/commands', slackCommandsRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, async () => {
  console.log(`[Server] Packed Deposit Tracker running on port ${PORT}`);
  try {
    await pool.query('SELECT 1');
    console.log('[Server] Database connected');
  } catch (err) {
    console.error('[Server] Database connection failed:', err);
  }
});
