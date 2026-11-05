import { parseYuanString } from '../lib/money';
import type { ParsedCandidate, RawCapture } from './types';

const PAY_HINTS: Array<{ re: RegExp; hint: NonNullable<ParsedCandidate['payChannelHint']> }> = [
  { re: /支付宝|支付宝支付|花呗|余额宝/, hint: 'alipay' },
  { re: /微信|微信支付|财付通/, hint: 'wechat' },
  { re: /云闪付|银联/, hint: 'unionpay' },
];

const EXPENSE_HINT = /支出|消费|支付|扣款|取出|转出|付款|成功付款|已支付/;
const INCOME_HINT = /收入|入账|存入|转入|收款|到账|退款/;

function extractCardLast4(text: string): string | undefined {
  const m =
    text.match(/(?:尾号|卡号|账户)\s*[*Xx]*\s*(\d{4})/) ||
    text.match(/\*{2,}(\d{4})/) ||
    text.match(/（(\d{4})）/);
  return m?.[1];
}

function extractMerchant(text: string, title?: string): string {
  const patterns = [
    /(?:商户|在|向)([\u4e00-\u9fa5A-Za-z0-9（）()·\-_]{2,30})(?:完成|支付|消费|付款)/,
    /成功(?:支付|付款)(?:给|向)?([\u4e00-\u9fa5A-Za-z0-9（）()·\-_]{2,30})/,
    /(?:消费|支付)([\u4e00-\u9fa5A-Za-z0-9（）()·\-_]{2,30})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].replace(/[，。；\s]+$/g, '').slice(0, 40);
  }
  if (title && title.length >= 2 && !/通知|提醒|动账|交易/.test(title)) {
    return title.slice(0, 40);
  }
  return '未知商户';
}

function extractAmount(text: string): number | null {
  const patterns = [
    /(?:人民币|RMB|￥|¥)\s*(-?\d[\d,]*(?:\.\d{1,2})?)/i,
    /(-?\d[\d,]*(?:\.\d{1,2})?)\s*元/,
    /金额\s*[：:.]?\s*(-?\d[\d,]*(?:\.\d{1,2})?)/,
    /(?:支付|付款|消费|支出|收入|入账|到账)\s*(?:人民币|RMB|￥|¥)?\s*(-?\d[\d,]*(?:\.\d{1,2})?)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const cents = parseYuanString(m[1]);
      if (cents != null && cents !== 0) return Math.abs(cents);
    }
  }
  return null;
}

function extractDirection(text: string): ParsedCandidate['direction'] {
  if (INCOME_HINT.test(text) && !EXPENSE_HINT.test(text)) return 'income';
  if (EXPENSE_HINT.test(text)) return 'expense';
  if (INCOME_HINT.test(text)) return 'income';
  return 'expense';
}

function extractPayHint(text: string): ParsedCandidate['payChannelHint'] | undefined {
  for (const item of PAY_HINTS) {
    if (item.re.test(text)) return item.hint;
  }
  return undefined;
}

export function parseCapture(raw: RawCapture): ParsedCandidate | null {
  const blob = `${raw.title ?? ''}\n${raw.body}`;
  const amountCents = extractAmount(blob);
  if (amountCents == null) return null;

  let confidence = 0.55;
  if (/(元|￥|¥|人民币)/.test(blob)) confidence += 0.15;
  if (EXPENSE_HINT.test(blob) || INCOME_HINT.test(blob)) confidence += 0.1;
  if (extractCardLast4(blob)) confidence += 0.05;
  if (raw.channel === 'notify') confidence += 0.05;

  return {
    amountCents,
    direction: extractDirection(blob),
    occurredAt: raw.occurredAt || Date.now(),
    merchant: extractMerchant(raw.body, raw.title),
    cardLast4: extractCardLast4(blob),
    payChannelHint: extractPayHint(blob),
    confidence: Math.min(confidence, 0.98),
  };
}

export function looksLikePaymentChannelSms(body: string): boolean {
  return /支付宝|微信支付|财付通|快捷支付|云闪付|Apple\s*Pay|华为支付/.test(body);
}
