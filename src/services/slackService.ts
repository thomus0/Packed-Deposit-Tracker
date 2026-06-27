import { WebClient } from '@slack/web-api';

let client: WebClient | null = null;

function getClient(): WebClient | null {
  if (!process.env.SLACK_BOT_TOKEN) return null;
  if (!client) client = new WebClient(process.env.SLACK_BOT_TOKEN);
  return client;
}

function fmt(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
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

export async function sendStatsMessage(channelId: string, days: number, stats: {
  newUsers: number;
  firstTimePayingUsers: number;
  totalDeposits: number;
  depositCount: number;
  avgDeposit: number;
  cashflow: number;
  totalWithdrawals: number;
}): Promise<void> {
  const slack = getClient();
  if (!slack) return;

  const period = days === 1 ? 'last 24 hours' : `last ${days * 24} hours`;

  try {
    await slack.chat.postMessage({
      channel: channelId,
      mrkdwn: true,
      text: [
        `🏆 *Packed Stats* (${period}):`,
        `👥 New Users: *${stats.newUsers}*`,
        `🤩 First Time Paying Users: *${stats.firstTimePayingUsers}*`,
        `🏦 Total Deposits: *${fmt(stats.totalDeposits)}*`,
        `🏧 Number of Deposits: *${stats.depositCount}*`,
        `🧮 Avg Deposit: *${fmt(stats.avgDeposit)}*`,
        `🤑 Cashflow: *${fmt(stats.cashflow)}*`,
        `✌🏻 Total Withdrawals: *${fmt(stats.totalWithdrawals)}*`,
      ].join('\n'),
    });
  } catch (err) {
    console.error('[Slack] sendStatsMessage failed:', err);
  }
}
