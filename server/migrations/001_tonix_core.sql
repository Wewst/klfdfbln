CREATE TABLE IF NOT EXISTS users (
  telegram_id text PRIMARY KEY,
  username text,
  first_name text NOT NULL DEFAULT 'Пользователь',
  avatar text,
  balance_micro bigint NOT NULL DEFAULT 0 CHECK (balance_micro >= 0),
  reserved_micro bigint NOT NULL DEFAULT 0 CHECK (reserved_micro >= 0 AND reserved_micro <= balance_micro),
  transactions_count bigint NOT NULL DEFAULT 0,
  usdt_turnover_micro bigint NOT NULL DEFAULT 0,
  rub_turnover_kopeks bigint NOT NULL DEFAULT 0,
  recipient_phone text,
  recipient_bank text,
  recipient_full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(telegram_id),
  crypto_check text NOT NULL,
  amount_micro bigint,
  status text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  confirmed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exchange_requests (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(telegram_id),
  amount_micro bigint NOT NULL CHECK (amount_micro > 0),
  rate_kopeks bigint NOT NULL CHECK (rate_kopeks > 0),
  amount_rub_kopeks bigint NOT NULL CHECK (amount_rub_kopeks > 0),
  paid_rub_kopeks bigint NOT NULL DEFAULT 0,
  recipient_phone text NOT NULL,
  recipient_bank text NOT NULL,
  recipient_full_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('WAITING_ADMIN','PROCESSING','PARTIALLY_PAID','MANAGER_CONTACT','COMPLETED','CANCELLED','REJECTED')),
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exchange_requests_user_status_idx ON exchange_requests(user_id,status);

CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES exchange_requests(id),
  payout_number integer NOT NULL CHECK (payout_number > 0),
  amount_rub_kopeks bigint NOT NULL CHECK (amount_rub_kopeks > 0),
  admin_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('SENT','DISPUTED','PAID')),
  user_confirmed_at timestamptz,
  screenshot_file_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,payout_number)
);
CREATE INDEX IF NOT EXISTS payouts_request_idx ON payouts(request_id,payout_number);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(telegram_id),
  request_id uuid UNIQUE,
  type text NOT NULL,
  amount_micro bigint NOT NULL,
  rate_kopeks bigint NOT NULL DEFAULT 0,
  amount_rub_kopeks bigint NOT NULL DEFAULT 0,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_user_created_idx ON transactions(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS support_threads (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(telegram_id),
  admin_id text,
  status text NOT NULL CHECK (status IN ('OPEN','WAITING_ADMIN','WAITING_USER','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS support_one_open_thread_per_user ON support_threads(user_id) WHERE status <> 'CLOSED';

CREATE TABLE IF NOT EXISTS support_messages (
  id bigserial PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES support_threads(id),
  sender_id text NOT NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('USER','ADMIN')),
  message_type text NOT NULL CHECK (message_type IN ('TEXT','PHOTO','DOCUMENT','VIDEO','VOICE')),
  text_body text,
  telegram_file_id text,
  telegram_chat_id text NOT NULL,
  telegram_message_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(telegram_chat_id,telegram_message_id)
);

CREATE TABLE IF NOT EXISTS admin_pending_actions (
  admin_id text PRIMARY KEY,
  action text NOT NULL,
  entity_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  admin_id text NOT NULL,
  action text NOT NULL,
  entity_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
