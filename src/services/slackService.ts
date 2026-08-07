import { WebClient } from '@slack/web-api';
import type { Stats } from './statsService';

let client: WebClient | null = null;

function getClient(): WebClient | null {
  if (!process.env.SLACK_BOT_TOKEN) return null;
  if (!client) client = new WebClient(process.env.SLACK_BOT_TOKEN);
  return client;
}

function fmt(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

export async function notifyNewUserDeposit(params: {
  amount: number;
  username: string;
}): Promise<void> {
  const slack = getClient();
  const channel = process.env.SLACK_DEPOSIT_CHANNEL_ID;
  if (!slack || !channel) return;

  try {
    await slack.chat.postMessage({
      channel,
      mrkdwn: true,
      text: [
        `🤑 *NEW USER* 🤑`,
        `💸 ${fmt(params.amount)} deposit`,
        `🙋‍♂️ @${params.username}`,
      ].join('\n'),
    });
  } catch (err) {
    console.error('[Slack] notifyNewUserDeposit failed:', err);
  }
}

export async function notifyReturningUserDeposit(params: {
  amount: number;
  username: string;
  depositCount: number;
  totalDeposited: number;
}): Promise<void> {
  const slack = getClient();
  const channel = process.env.SLACK_DEPOSIT_CHANNEL_ID;
  if (!slack || !channel) return;

  try {
    await slack.chat.postMessage({
      channel,
      mrkdwn: true,
      text: [
        `💸 ${fmt(params.amount)} deposit`,
        `🙋‍♂️ @${params.username}`,
        `#️⃣ ${params.depositCount} deposit(s)`,
        `🏦 ${fmt(params.totalDeposited)} total`,
      ].join('\n'),
    });
  } catch (err) {
    console.error('[Slack] notifyReturningUserDeposit failed:', err);
  }
}

export async function notifyWithdrawal(params: {
  amount: number;
  username: string;
  totalDeposits: number;
  totalWithdrawals: number;
}): Promise<void> {
  const slack = getClient();
  const channel = process.env.SLACK_DEPOSIT_CHANNEL_ID;
  if (!slack || !channel) return;

  try {
    await slack.chat.postMessage({
      channel,
      mrkdwn: true,
      text: [
        `📉 ${fmt(params.amount)} withdrawal`,
        `🙋‍♂️ @${params.username}`,
        `🏦 ${fmt(params.totalDeposits)} total deposits`,
        `📛 ${fmt(params.totalWithdrawals)} total withdrawals`,
      ].join('\n'),
    });
  } catch (err) {
    console.error('[Slack] notifyWithdrawal failed:', err);
  }
}

export function formatStatsMessage(days: number, stats: Stats): string {
  const period = days === 1 ? 'last 24 hours' : `last ${days} days`;

  return [
    `\uD83C\uDFC6 *Packed Stats* \u2014 ${period}`,
    ``,
    `\uD83C\uDFE6 Total Deposits: *${fmt(stats.totalDeposits)}*`,
    `\u270C\uD83C\uDFFB Total Withdrawals: *${fmt(stats.totalWithdrawals)}*`,
    `\uD83E\uDD11 Cashflow: *${fmt(stats.cashflow)}*`,
    ``,
    `*\uD83C\uDFE7 Deposits*`,
    `#\uFE0F\u20E3 Count: *${count(stats.depositCount)}*`,
    `\uD83E\uDDEE Average: *${fmt(stats.avgDeposit)}*`,
    `\uD83D\uDCCA Median: *${fmt(stats.medianDeposit)}*`,
    `\uD83D\uDD1D Largest: *${fmt(stats.largestDeposit)}*`,
    ``,
    `*\uD83D\uDCC9 Withdrawals*`,
    `#\uFE0F\u20E3 Count: *${count(stats.withdrawalCount)}*`,
    `\uD83E\uDDEE Average: *${fmt(stats.avgWithdrawal)}*`,
    ``,
    `*\uD83D\uDC65 People*`,
    `\uD83D\uDE4B Unique Depositors: *${count(stats.uniqueDepositors)}*`,
    `\uD83E\uDD29 First-Time Payers: *${count(stats.firstTimePayingUsers)}*`,
    `\uD83D\uDD01 Repeat Rate: *${Math.round(stats.repeatRate * 100)}%*`,
  ].join('\n');
}

export async function sendStatsMessage(
  channelId: string,
  days: number,
  stats: Stats
): Promise<void> {
  const slack = getClient();
  if (!slack) return;

  try {
    await slack.chat.postMessage({
      channel: channelId,
      mrkdwn: true,
      text: formatStatsMessage(days, stats),
    });
  } catch (err) {
    console.error('[Slack] sendStatsMessage failed:', err);
  }
}
