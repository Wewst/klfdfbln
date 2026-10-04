import 'dotenv/config';
import express from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { calculateRubKopeks, DEFAULT_USDT_RATE, parseRateKopeks, parseUsdtMicro, USDT_MICRO } from './financial.js';

const env = process.env;
const app = express();
const PORT = Number(env.PORT || 3000);
const users = new Map();
const deposits = new Map();
const exchanges = new Map();
const pendingAdminAmounts = new Map();
const supports = new Map();
const transactions = new Map();
const ADMIN_IDS = (env.ADMIN_TELEGRAM_IDS || env.ADMIN_TELEGRAM_ID || '')
  .split(',').map(value => value.trim()).filter(Boolean);
const allowedOrigins = new Set([
  'https://hjibibu-bxqc.vercel.app',
  ...(env.WEBAPP_ORIGINS || env.WEBAPP_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean),
]);
const RATE_KOPEKS = parseRateKopeks(env.USDT_RATE || DEFAULT_USDT_RATE);
const rate = RATE_KOPEKS / 100;
const MICRO = USDT_MICRO;

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Telegram-Init-Data,X-Telegram-Bot-Api-Secret-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function verifyInitData(raw) {
  if (!raw || !env.TELEGRAM_BOT_TOKEN) throw Object.assign(new Error('Telegram authentication is not configured'), { status: 401 });
  const params = new URLSearchParams(raw);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw Object.assign(new Error('Telegram init data is invalid'), { status: 401 });
  params.delete('hash');
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();
  const expectedHash = createHmac('sha256', secret).update(checkString).digest('hex');
  const actual = Buffer.from(receivedHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Object.assign(new Error('Telegram authentication failed'), { status: 401 });
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 86400) throw Object.assign(new Error('Telegram session expired'), { status: 401 });
  try {
    const user = JSON.parse(params.get('user') || '{}');
    if (!user.id) throw new Error();
    return user;
  } catch {
    throw Object.assign(new Error('Telegram user is missing'), { status: 401 });
  }
}

function getUser(id) {
  const key = String(id);
  if (!users.has(key)) users.set(key, { telegramId: key, username: null, firstName: 'Пользователь', avatar: null, balanceMicro: 0, reservedMicro: 0, statistics: { transactionsCount: 0, usdtTurnoverMicro: 0, rubTurnoverKopeks: 0 }, createdAt: new Date().toISOString() });
  return users.get(key);
}

async function authenticate(req, res, next) {
  if (!env.TELEGRAM_BOT_TOKEN) return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN is not configured' });
  try {
    const telegramUser = verifyInitData(req.get('X-Telegram-Init-Data'));
    const user = getUser(telegramUser.id);
    user.username = telegramUser.username || null;
    user.firstName = telegramUser.first_name || 'Пользователь';
    user.avatar = telegramUser.photo_url || null;
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function isAdmin(id) { return ADMIN_IDS.includes(String(id)); }
function toUsdt(micro) { return Number(micro) / MICRO; }
function fromUsdt(value) { return parseUsdtMicro(value); }
function historyFor(userId) {
  return [...(transactions.get(String(userId)) || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function telegram(method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Telegram ${method}: HTTP ${response.status}`);
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram ${method}: ${result.description || 'request failed'}`);
  return result;
}

async function notifyAdmins(method, payload) {
  const results = await Promise.allSettled(ADMIN_IDS.map(chatId => telegram(method, { ...payload, chat_id: chatId })));
  results.forEach((result, index) => {
    if (result.status === 'rejected') console.error(`Admin notice failed (${ADMIN_IDS[index]}): ${result.reason?.message}`);
  });
  return results.some(result => result.status === 'fulfilled');
}

async function configureTelegramWebhook() {
  const baseUrl = (env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !baseUrl) {
    console.warn('Telegram webhook not auto-configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET; Render must provide RENDER_EXTERNAL_URL.');
    return;
  }
  try {
    const result = await telegram('setWebhook', {
      url: `${baseUrl}/api/telegram/webhook`,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    console.log(`Telegram webhook configured: ${result.result}`);
  } catch (error) {
    console.error(`Telegram webhook setup failed: ${error.message}`);
  }
}

app.get('/health', (_req, res) => res.json({ status: 'ok', storage: 'memory' }));
app.get('/ready', (_req, res) => {
  const missing = [];
  if (!env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!env.TELEGRAM_WEBHOOK_SECRET) missing.push('TELEGRAM_WEBHOOK_SECRET');
  if (!ADMIN_IDS.length) missing.push('ADMIN_TELEGRAM_IDS');
  if (missing.length) return res.status(503).json({ status: 'needs-config', missing, storage: 'memory' });
  res.json({ status: 'ready', storage: 'memory', warning: 'Records reset when the service restarts.' });
});

app.get('/api/me', authenticate, (req, res) => {
  const user = req.user;
  res.json({
    user: { telegramId: Number(user.telegramId), username: user.username, firstName: user.firstName, avatar: user.avatar },
    wallet: { balanceUSDT: toUsdt(user.balanceMicro), reservedUSDT: toUsdt(user.reservedMicro), availableUSDT: toUsdt(user.balanceMicro - user.reservedMicro) },
    statistics: { transactionsCount: user.statistics.transactionsCount, usdtTurnover: toUsdt(user.statistics.usdtTurnoverMicro), rubTurnover: user.statistics.rubTurnoverKopeks / 100 },
    rate, history: historyFor(user.telegramId),
  });
});

app.get('/api/history', authenticate, (req, res) => res.json(historyFor(req.user.telegramId)));

app.post('/api/deposits', authenticate, async (req, res, next) => {
  try {
    const check = typeof req.body?.cryptoBotCheck === 'string' ? req.body.cryptoBotCheck.trim() : '';
    if (!check || check.length > 2048) return res.status(400).json({ error: 'Введите корректный чек CryptoBot' });
    const deposit = { id: randomUUID(), userId: req.user.telegramId, check, amountMicro: null, status: 'PENDING', createdAt: new Date().toISOString() };
    deposits.set(deposit.id, deposit);
    const notificationSent = ADMIN_IDS.length ? await notifyAdmins('sendMessage', {
      text: `Новое пополнение #${deposit.id}\nПользователь: ${req.user.firstName} (@${req.user.username || '—'})\nTelegram ID: ${req.user.telegramId}\nЧек: ${check}\nСоздано: ${deposit.createdAt}`,
      reply_markup: { inline_keyboard: [[{ text: 'Подтвердить', callback_data: `dep:approve:${deposit.id}` }, { text: 'Отклонить', callback_data: `dep:reject:${deposit.id}` }]] },
    }) : false;
    res.status(201).json({ id: deposit.id, status: deposit.status, createdAt: deposit.createdAt, notificationSent });
  } catch (error) { next(error); }
});

app.post('/api/exchanges', authenticate, async (req, res, next) => {
  try {
    const amountMicro = fromUsdt(req.body?.amountUSDT);
    const card = String(req.body?.cardNumber || '');
    if (!amountMicro || amountMicro > 1_000_000 * MICRO || !/^\d{12,19}$/.test(card)) return res.status(400).json({ error: 'Проверьте сумму и номер карты' });
    const amount = toUsdt(amountMicro);
    const user = req.user;
    if (user.balanceMicro - user.reservedMicro < amountMicro) return res.status(409).json({ error: 'Недостаточно доступных средств' });
    const openCount = [...exchanges.values()].filter(x => x.userId === user.telegramId && ['WAITING_PAYMENT', 'PAYMENT_NOT_FOUND', 'WAITING_MANAGER_REVIEW'].includes(x.status)).length;
    if (openCount >= 5) return res.status(409).json({ error: 'Слишком много незавершённых заявок' });
    const rateKopeks = RATE_KOPEKS;
    const amountRubKopeks = calculateRubKopeks(amountMicro, rateKopeks);
    if (!Number.isSafeInteger(amountRubKopeks) || amountRubKopeks <= 0) return res.status(400).json({ error: 'Некорректный курс или сумма' });
    const exchange = { id: randomUUID(), userId: user.telegramId, amountMicro, rateKopeks, amountRubKopeks, cardLast4: card.slice(-4), status: 'WAITING_PAYMENT', createdAt: new Date().toISOString() };
    exchanges.set(exchange.id, exchange);
    user.reservedMicro += amountMicro;
    let botMessageSent = false;
    try {
      await telegram('sendMessage', { chat_id: user.telegramId, text: `Заявка на обмен создана\nСумма: ${amount} USDT\nКурс: ${rateKopeks / 100} ₽\nК получению: ${(amountRubKopeks / 100).toLocaleString('ru-RU')} ₽\nКарта: •••• ${exchange.cardLast4}\n\nПосле получения средств подтвердите поступление.`, reply_markup: { inline_keyboard: [[{ text: 'Поступление получено', callback_data: `ex:received:${exchange.id}` }], [{ text: 'Поступление не найдено', callback_data: `ex:missing:${exchange.id}` }], [{ text: 'Связаться с менеджером', callback_data: `ex:support:${exchange.id}` }]] } });
      botMessageSent = true;
    } catch (error) { console.error('Exchange bot message failed:', error.message); }
    res.status(201).json({ id: exchange.id, status: exchange.status, botMessageSent, wallet: { balanceUSDT: toUsdt(user.balanceMicro), reservedUSDT: toUsdt(user.reservedMicro), availableUSDT: toUsdt(user.balanceMicro - user.reservedMicro) } });
  } catch (error) { next(error); }
});

app.post('/api/telegram/webhook', async (req, res, next) => {
  if (env.NODE_ENV === 'production' && !env.TELEGRAM_WEBHOOK_SECRET) return res.status(503).json({ error: 'TELEGRAM_WEBHOOK_SECRET is required' });
  if (env.TELEGRAM_WEBHOOK_SECRET && req.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return res.sendStatus(401);
  try {
    if (req.body?.callback_query) await handleCallback(req.body.callback_query);
    if (req.body?.message) await handleMessage(req.body.message);
    res.sendStatus(200);
  } catch (error) { next(error); }
});

async function handleCallback(query) {
  await telegram('answerCallbackQuery', { callback_query_id: query.id });
  const [scope, action, id] = String(query.data || '').split(':');
  if (scope === 'dep') {
    if (!isAdmin(query.from.id)) return telegram('sendMessage', { chat_id: query.from.id, text: 'Доступ запрещён.' });
    const deposit = deposits.get(id);
    if (!deposit || deposit.status !== 'PENDING') return telegram('sendMessage', { chat_id: query.from.id, text: 'Заявка не найдена или уже обработана.' });
    if (action === 'approve') {
      const prompt = await telegram('sendMessage', {
        chat_id: query.from.id,
        text: `Заявка #${id}\nВведите сумму в USDT (например, 12.345). Можно просто отправить следующим сообщением.`,
        reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Например: 12.345' },
      });
      pendingAdminAmounts.set(String(query.from.id), { depositId: id, promptMessageId: prompt.result.message_id });
      return;
    }
    if (action === 'reject') {
      deposit.status = 'REJECTED';
      await telegram('sendMessage', { chat_id: deposit.userId, text: 'Заявка на пополнение отклонена. Если считаете это ошибкой, обратитесь к менеджеру.' }).catch(error => console.error('Deposit rejection notice failed:', error.message));
      return telegram('sendMessage', { chat_id: query.from.id, text: 'Заявка отклонена.' });
    }
    return;
  }
  if (scope !== 'ex') return;
  const exchange = exchanges.get(id);
  if (!exchange || exchange.userId !== String(query.from.id)) return telegram('sendMessage', { chat_id: query.from.id, text: 'Заявка не найдена.' });
  const user = users.get(exchange.userId);
  if (action === 'received') {
    if (exchange.status !== 'WAITING_PAYMENT') return telegram('sendMessage', { chat_id: query.from.id, text: 'Заявка уже обработана.' });
    if (user.reservedMicro < exchange.amountMicro || user.balanceMicro < exchange.amountMicro) return telegram('sendMessage', { chat_id: query.from.id, text: 'Не удалось найти резерв средств. Обратитесь к менеджеру.' });
    user.balanceMicro -= exchange.amountMicro;
    user.reservedMicro -= exchange.amountMicro;
    user.statistics.transactionsCount += 1;
    user.statistics.usdtTurnoverMicro += exchange.amountMicro;
    user.statistics.rubTurnoverKopeks += exchange.amountRubKopeks;
    exchange.status = 'COMPLETED';
    historyFor(user.telegramId);
    const rows = transactions.get(user.telegramId) || [];
    rows.push({ id: exchange.id, type: 'Обмен', amountUSDT: toUsdt(exchange.amountMicro), rate: exchange.rateKopeks / 100, amountRUB: exchange.amountRubKopeks / 100, status: 'COMPLETED', createdAt: new Date().toISOString() });
    transactions.set(user.telegramId, rows);
    await telegram('sendMessage', { chat_id: query.from.id, text: 'Поступление подтверждено. Сделка завершена.' });
    await notifyAdmins('sendMessage', { text: `Сделка ${exchange.id} завершена: ${toUsdt(exchange.amountMicro)} USDT.` });
    return;
  }
  if (action === 'missing') {
    if (exchange.status !== 'WAITING_PAYMENT') return telegram('sendMessage', { chat_id: query.from.id, text: 'Заявка уже обработана.' });
    exchange.status = 'PAYMENT_NOT_FOUND';
    return telegram('sendMessage', { chat_id: query.from.id, text: 'Пришлите скриншот истории операций из банковского приложения.' });
  }
  if (action === 'support') {
    const support = { id: randomUUID(), userId: user.telegramId, exchangeId: exchange.id, createdAt: new Date().toISOString() };
    supports.set(support.id, support);
    await notifyAdmins('sendMessage', { text: `Новый запрос от пользователя по заявке #${exchange.id}. Support thread: ${support.id}` });
    return telegram('sendMessage', { chat_id: query.from.id, text: 'Запрос передан менеджеру. Ожидайте ответа.' });
  }
}

async function handleMessage(message) {
  const text = message.text || '';
  if (isAdmin(message.from.id) && text.startsWith('/start')) return telegram('sendMessage', { chat_id: message.chat.id, text: 'TONIX Admin готов. Проверьте чек вручную перед подтверждением пополнения.' });
  const pendingKey = String(message.from.id);
  const pending = pendingAdminAmounts.get(pendingKey);
  if (isAdmin(message.from.id) && pending) {
    const id = pending.depositId;
    const deposit = deposits.get(id);
    const amountMicro = fromUsdt(text);
    if (!amountMicro) return telegram('sendMessage', { chat_id: message.chat.id, text: 'Введите положительную сумму USDT цифрами, например 12.345. Можно указать до 6 знаков после запятой.' });
    if (!deposit || deposit.status !== 'PENDING') { pendingAdminAmounts.delete(pendingKey); return telegram('sendMessage', { chat_id: message.chat.id, text: 'Заявка уже обработана или не найдена.' }); }
    const user = users.get(deposit.userId);
    deposit.amountMicro = amountMicro;
    deposit.status = 'APPROVED';
    user.balanceMicro += amountMicro;
    const rows = transactions.get(user.telegramId) || [];
    rows.push({ id: deposit.id, type: 'Пополнение', amountUSDT: toUsdt(amountMicro), rate: 0, amountRUB: 0, status: 'APPROVED', createdAt: new Date().toISOString() });
    transactions.set(user.telegramId, rows);
    pendingAdminAmounts.delete(pendingKey);
    await telegram('sendMessage', { chat_id: user.telegramId, text: `Пополнение подтверждено. Зачислено ${toUsdt(amountMicro)} USDT. Баланс: ${toUsdt(user.balanceMicro)} USDT.` }).catch(error => console.error('Deposit confirmation notice failed:', error.message));
    return telegram('sendMessage', { chat_id: message.chat.id, text: `Заявка #${id} подтверждена.` });
  }
  if (message.photo) {
    const user = users.get(String(message.from.id));
    if (!user) return telegram('sendMessage', { chat_id: message.chat.id, text: 'Откройте TONIX и создайте заявку перед отправкой скриншота.' });
    const exchange = [...exchanges.values()].find(item => item.userId === user.telegramId && item.status === 'PAYMENT_NOT_FOUND');
    if (!exchange) return telegram('sendMessage', { chat_id: message.chat.id, text: 'Нет заявки, ожидающей скриншот.' });
    exchange.status = 'WAITING_MANAGER_REVIEW';
    exchange.screenshotFileId = message.photo.at(-1).file_id;
    await notifyAdmins('sendPhoto', { photo: exchange.screenshotFileId, caption: `Поступление не найдено · заявка ${exchange.id}\nПользователь: ${user.telegramId}\nСумма: ${toUsdt(exchange.amountMicro)} USDT\nКарта: •••• ${exchange.cardLast4}` });
    return telegram('sendMessage', { chat_id: message.chat.id, text: 'Скриншот передан администраторам.' });
  }
}

app.use((error, req, res, _next) => {
  const requestId = randomUUID();
  console.error(JSON.stringify({ requestId, path: req.path, method: req.method, message: error.message, stack: env.NODE_ENV === 'production' ? undefined : error.stack }));
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Внутренняя ошибка сервера', requestId });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TONIX API listening on ${PORT}; in-memory storage enabled`);
  void configureTelegramWebhook();
});
