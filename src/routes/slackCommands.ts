import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { computeStats } from '../services/statsService';
import { sendStatsMessage } from '../services/slackService';

const router = Router();

export function verifySlackSignature(req: Request): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error('[SlackCommands] SLACK_SIGNING_SECRET is not set — rejecting request');
    return false;
  }

  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const slackSig = req.headers['x-slack-signature'] as string;
  if (!timestamp || !slackSig) return false;

  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const baseString = `v0:${timestamp}:${(req as Request & { rawBody?: string }).rawBody ?? ''}`;
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(baseString);
  const computed = Buffer.from(`v0=${hmac.digest('hex')}`);
  const provided = Buffer.from(slackSig);

  // timingSafeEqual throws on a length mismatch, so screen that out first. Valid
  // signatures are always the same length, so this leaks nothing useful.
  if (computed.length !== provided.length) return false;

  return crypto.timingSafeEqual(computed, provided);
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
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const period = days === 1 ? 'last 24 hours' : `last ${days} days`;

    // Acknowledge immediately — Slack times out after 3 seconds
    res.json({
      response_type: 'in_channel',
      text: `⏳ Pulling stats for the ${period}...`,
    });

    try {
      const stats = await computeStats(since);
      await sendStatsMessage(channel_id, days, stats);
    } catch (err) {
      console.error('[SlackCommands] /stats error:', err);
    }

    return;
  }

  return res.json({ text: `Unknown command: ${command}` });
});

export default router;
