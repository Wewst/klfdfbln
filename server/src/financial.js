export const DEFAULT_USDT_RATE = '96';
export const USDT_MICRO = 1_000_000;

export function parseRateKopeks(value = DEFAULT_USDT_RATE) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('USDT_RATE must be a positive amount with at most 2 decimals');
  const [rubles, fraction = ''] = text.split('.');
  const kopeks = Number(rubles) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(kopeks) || kopeks <= 0) throw new Error('USDT_RATE must be a positive safe amount');
  return kopeks;
}

export function parseUsdtMicro(value) {
  const text = String(value ?? '').trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) return null;
  const micro = BigInt(match[1]) * BigInt(USDT_MICRO) + BigInt((match[2] || '').padEnd(6, '0') || '0');
  return micro > 0n && micro <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micro) : null;
}

export function calculateRubKopeks(amountMicro, rateKopeks) {
  const total = (BigInt(amountMicro) * BigInt(rateKopeks) + 500_000n) / 1_000_000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('RUB amount is too large');
  return Number(total);
}
