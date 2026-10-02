CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY, telegram_id BIGINT UNIQUE NOT NULL, username TEXT, first_name TEXT NOT NULL,
 avatar TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallets (
 user_id BIGINT PRIMARY KEY REFERENCES users(id), balance_micro BIGINT NOT NULL DEFAULT 0 CHECK(balance_micro >= 0),
 reserved_micro BIGINT NOT NULL DEFAULT 0 CHECK(reserved_micro >= 0 AND reserved_micro <= balance_micro), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS statistics (
 user_id BIGINT PRIMARY KEY REFERENCES users(id), transactions_count BIGINT NOT NULL DEFAULT 0,
 usdt_turnover_micro BIGINT NOT NULL DEFAULT 0, rub_turnover_kopeks BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS deposit_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id BIGINT NOT NULL REFERENCES users(id),
 crypto_bot_check TEXT NOT NULL, amount_micro BIGINT, status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_at TIMESTAMPTZ, reviewed_by BIGINT
);
CREATE TABLE IF NOT EXISTS exchange_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id BIGINT NOT NULL REFERENCES users(id),
 amount_micro BIGINT NOT NULL CHECK(amount_micro > 0), rate_kopeks BIGINT NOT NULL CHECK(rate_kopeks > 0),
 amount_rub_kopeks BIGINT NOT NULL CHECK(amount_rub_kopeks > 0), card_last4 CHAR(4) NOT NULL,
 status TEXT NOT NULL DEFAULT 'WAITING_PAYMENT' CHECK(status IN ('CREATED','WAITING_PAYMENT','PAYMENT_NOT_FOUND','WAITING_MANAGER_REVIEW','COMPLETED','CANCELLED','FAILED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), screenshot_file_id TEXT
);
CREATE INDEX IF NOT EXISTS exchange_user_created_idx ON exchange_requests(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS transactions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id BIGINT NOT NULL REFERENCES users(id),
 request_id UUID NOT NULL UNIQUE, type TEXT NOT NULL, amount_micro BIGINT NOT NULL,
 rate_kopeks BIGINT NOT NULL, amount_rub_kopeks BIGINT NOT NULL, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_threads (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id BIGINT NOT NULL REFERENCES users(id), exchange_request_id UUID REFERENCES exchange_requests(id),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')), manager_telegram_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_messages (
 id BIGSERIAL PRIMARY KEY, thread_id UUID NOT NULL REFERENCES support_threads(id), sender_telegram_id BIGINT NOT NULL,
 body TEXT, telegram_file_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
 id BIGSERIAL PRIMARY KEY, actor_id BIGINT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
 entity_id TEXT NOT NULL, old_value JSONB, new_value JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_pending_actions (
 admin_telegram_id BIGINT NOT NULL, action TEXT NOT NULL, entity_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(admin_telegram_id, action)
);
