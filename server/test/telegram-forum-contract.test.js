import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

test('Forum CRM uses configured existing chat and creates a single topic per user', () => {
  assert.match(source, /SUPPORT_FORUM_CHAT_ID=String\(env\.SUPPORT_FORUM_CHAT_ID/);
  assert.match(source, /telegram\('createForumTopic'/);
  assert.match(source, /find\(x=>x\.userId===String\(userId\)\)/);
  assert.match(source, /if\(thread\.forumTopicId\)\{/);
  assert.match(source, /message_thread_id:thread\.forumTopicId/);
  assert.match(source, /-1004475649169/);
});

test('Forum messages are relayed both ways only for configured topics and authorized admins', () => {
  assert.match(source, /copyMessage/);
  assert.match(source, /String\(message\.chat\?\.id\)!==SUPPORT_FORUM_CHAT_ID\|\|!message\.message_thread_id/);
  assert.match(source, /if\(!isAdmin\(message\.from\?\.id\)\)/);
  assert.match(source, /message_thread_id:thread\.forumTopicId/);
});

test('Webhook, diagnostics, media, assignment, and message idempotency are wired', () => {
  assert.match(source, /processedUpdates\.has/);
  assert.match(source, /supportInfo\(/);
  assert.match(source, /getChatMember/);
  assert.match(source, /getWebhookInfo/);
  assert.match(source, /telegram-group-update/);
  assert.match(source, /disable Privacy Mode in @BotFather/);
  assert.match(source, /createForumTopic failed/);
  assert.match(source, /'DOCUMENT'/);
  assert.match(source, /'PHOTO'/);
  assert.match(source, /support:assign/);
  assert.match(source, /assignedAdminId/);
});

test('Forum admin replies outside a topic are never relayed to users', () => {
  assert.match(source, /if\(!m\.message_thread_id\).*?Ignoring admin forum message outside a topic/);
  assert.match(source, /String\(message\.chat\?\.id\)!==SUPPORT_FORUM_CHAT_ID/);
});
