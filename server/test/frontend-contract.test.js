import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const htmlPath = fileURLToPath(new URL('../../fronted/index.html', import.meta.url));
const html = await readFile(htmlPath, 'utf8');

test('frontend uses the API rate as its only USDT/RUB source', () => {
  assert.match(html, /state\.rate=Number\(data\.rate\)/);
  assert.match(html, /const rubText=value=>/);
  assert.match(html, /BigInt\(m\[1\]\)\*1000000n/);
  assert.doesNotMatch(html, /USDT_RATE\s*:\s*(?:96|98)|CONFIG\.USDT_RATE/);
});

test('Wallet and Profile show RUB equivalents from live balance and API rate', () => {
  assert.match(html, /wallet-rub[^`]*rubText\(state\.balance\)/);
  assert.match(html, /profile-balance[^`]*rubText\(state\.balance\)/);
});
