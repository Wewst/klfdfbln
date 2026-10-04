import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateRubKopeks, DEFAULT_USDT_RATE, parseRateKopeks, parseRubKopeks, parseUsdtMicro } from '../src/financial.js';
const serverSource = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('backend defaults to a single 96 RUB/USDT rate', () => {
  assert.equal(DEFAULT_USDT_RATE, '96');
  assert.equal(parseRateKopeks(), 9600);
  assert.equal(parseRateKopeks('96'), 9600);
});

test('USDT input is parsed as integer micro-units', () => {
  assert.equal(parseUsdtMicro('1.000001'), 1_000_001);
  assert.equal(parseUsdtMicro('0'), null);
  assert.equal(parseUsdtMicro('1.0000001'), null);
});

test('RUB payouts are parsed exactly into integer kopeks', () => {
  assert.equal(parseRubKopeks('0.29'), 29);
  assert.equal(parseRubKopeks('12,3'), 1230);
  assert.equal(parseRubKopeks('0'), null);
  assert.equal(parseRubKopeks('1.001'), null);
});

test('96 RUB rate calculates expected whole-ruble payouts', () => {
  const rate = parseRateKopeks('96');
  for (const [amount, expected] of [['1', 9600], ['10', 96000], ['50', 480000], ['100', 960000]]) {
    assert.equal(calculateRubKopeks(parseUsdtMicro(amount), rate) / 100, expected / 100);
  }
});

test('an order snapshot retains the rate and RUB amount it was created with', () => {
  const snapshot = Object.freeze({ amountMicro: parseUsdtMicro('10'), rateKopeks: parseRateKopeks('96'), amountRubKopeks: calculateRubKopeks(parseUsdtMicro('10'), parseRateKopeks('96')) });
  assert.equal(snapshot.rateKopeks, 9600);
  assert.equal(snapshot.amountRubKopeks, 96000);
  assert.equal(calculateRubKopeks(parseUsdtMicro('10'), parseRateKopeks('97')), 97000);
  assert.equal(snapshot.rateKopeks, 9600);
  assert.equal(snapshot.amountRubKopeks, 96000);
});

test('backend uses the previous in-memory storage for new request types and stores rate snapshots', () => {
  assert.match(serverSource, /const users=new Map\(\),deposits=new Map\(\),exchanges=new Map\(\),payouts=new Map\(\)/);
  assert.match(serverSource, /rateKopeks:RATE_KOPEKS,amountRubKopeks/);
  assert.match(serverSource, /function completeExchange/);
  assert.doesNotMatch(serverSource, /DATABASE_URL|postgresql|from 'pg'/i);
});
