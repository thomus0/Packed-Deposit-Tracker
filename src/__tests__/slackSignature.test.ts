import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Request } from 'express';
import { verifySlackSignature } from '../routes/slackCommands';

const SECRET = 'test-signing-secret';

/** Builds the minimal shape verifySlackSignature reads: headers + rawBody. */
function buildRequest(opts: {
  rawBody?: string;
  timestamp?: string;
  signature?: string;
}): Request {
  return {
    headers: {
      'x-slack-request-timestamp': opts.timestamp,
      'x-slack-signature': opts.signature,
    },
    rawBody: opts.rawBody ?? '',
  } as unknown as Request;
}

function sign(rawBody: string, timestamp: string, secret = SECRET): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`v0:${timestamp}:${rawBody}`);
  return `v0=${hmac.digest('hex')}`;
}

function currentTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

test('rejects the request when no signing secret is configured', () => {
  delete process.env.SLACK_SIGNING_SECRET;
  const ts = currentTimestamp();
  const req = buildRequest({
    rawBody: 'command=%2Fstats',
    timestamp: ts,
    signature: sign('command=%2Fstats', ts),
  });

  assert.equal(verifySlackSignature(req), false);
});

test('rejects a signature of the wrong length without throwing', () => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
  const ts = currentTimestamp();
  const req = buildRequest({
    rawBody: 'command=%2Fstats',
    timestamp: ts,
    signature: 'v0=deadbeef',
  });

  assert.equal(verifySlackSignature(req), false);
});

test('accepts a correctly signed request', () => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
  const ts = currentTimestamp();
  const body = 'command=%2Fstats&text=5';
  const req = buildRequest({ rawBody: body, timestamp: ts, signature: sign(body, ts) });

  assert.equal(verifySlackSignature(req), true);
});

test('rejects a correctly shaped signature made with the wrong secret', () => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
  const ts = currentTimestamp();
  const body = 'command=%2Fstats';
  const req = buildRequest({
    rawBody: body,
    timestamp: ts,
    signature: sign(body, ts, 'not-the-secret'),
  });

  assert.equal(verifySlackSignature(req), false);
});

test('rejects a replayed request older than five minutes', () => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
  const stale = (Math.floor(Date.now() / 1000) - 600).toString();
  const body = 'command=%2Fstats';
  const req = buildRequest({ rawBody: body, timestamp: stale, signature: sign(body, stale) });

  assert.equal(verifySlackSignature(req), false);
});

test('rejects a request with no signature headers', () => {
  process.env.SLACK_SIGNING_SECRET = SECRET;

  assert.equal(verifySlackSignature(buildRequest({ rawBody: 'command=%2Fstats' })), false);
});
