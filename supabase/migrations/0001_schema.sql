-- ============================================================================
-- Play4Stakes Phase 2 — 0001_schema.sql   (CORRECTED)
-- Paste into Supabase → SQL Editor → New query → Run. Run BEFORE the others.
-- Safe to re-run: idempotent, and it drops the old auth FK if a prior run left it.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_bytes / gen_random_uuid

-- ─── Identity ────────────────────────────────────────────────────────────────
-- NOTE: profiles.id is a plain uuid (NOT a FK to auth.users). Real players get a
-- profile via the on-signup trigger (0003); system accounts (fee wallets) are
-- seeded below. An auth FK here would reject the system accounts.
create table if not exists profiles (
  id          uuid primary key,
  handle      text unique,
  created_at  timestamptz not null default now()
);
-- If a previous run created profiles WITH the auth FK, remove it:
alter table profiles drop constraint if exists profiles_id_fkey;

-- ─── Money: cached balance + append-only ledger (ledger is the audit truth) ──
create table if not exists wallets (
  user_id     uuid primary key references profiles(id) on delete cascade,
  balance     bigint not null default 0 check (balance >= 0),  -- no overdraft, enforced by DB
  updated_at  timestamptz not null default now()
);

create table if not exists wallet_ledger (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references profiles(id),
  delta          bigint not null,            -- negative = debit
  reason         text   not null,            -- CHALLENGE_FUND | WINNINGS | REFUND | DEV_FEE | PROTOCOL_FEE
  challenge_code text,
  created_at     timestamptz not null default now()
);
create index if not exists ledger_user_idx on wallet_ledger(user_id, created_at desc);
create index if not exists ledger_code_idx on wallet_ledger(challenge_code);

-- System fee wallets (fixed uuids you control). Profiles first, then wallets.
insert into profiles(id, handle) values
  ('00000000-0000-0000-0000-0000000000de','__developer'),
  ('00000000-0000-0000-0000-0000000000b0','__protocol')
on conflict (id) do nothing;
insert into wallets(user_id, balance) values
  ('00000000-0000-0000-0000-0000000000de', 0),
  ('00000000-0000-0000-0000-0000000000b0', 0)
on conflict (user_id) do nothing;

-- ─── Challenges ──────────────────────────────────────────────────────────────
do $$ begin
  create type game_type as enum ('SCOUT','DOWN','UP','CONNECT4');
exception when duplicate_object then null; end $$;

do $$ begin
  create type challenge_status as enum (
    'AWAITING_OPPONENT','FULLY_FUNDED','JOIN_WINDOW_STARTED','MATCH_ACTIVE',
    'RESULT_VERIFIED','SETTLED','EXPIRED','CREATOR_REFUNDED','ONE_PLAYER_ABSENT',
    'FORFEIT','PRESENT_PLAYER_PAID','BOTH_REFUNDED');
exception when duplicate_object then null; end $$;

create table if not exists challenges (
  code                   text primary key,
  game_type              game_type not null,
  seed                   text not null,
  stake                  bigint not null check (stake > 0),
  status                 challenge_status not null default 'AWAITING_OPPONENT',
  match_format           text not null default 'SINGLE',
  fee_dev_pct            int not null default 5,
  fee_protocol_pct       int not null default 5,
  creator_id             uuid references profiles(id),
  opponent_id            uuid references profiles(id),
  target_opponent_id     uuid references profiles(id),
  escrowed_creator       bigint,
  escrowed_opponent      bigint,
  creator_joined         bool default false,
  opponent_joined        bool default false,
  mode                   text,
  phase                  text,
  ready_creator          bool,
  ready_opponent         bool,
  ready_deadline_at      timestamptz,
  turn_deadline_at       timestamptz,
  turn_number            int,
  current_turn_id        uuid,
  created_at             timestamptz not null default now(),
  expires_at             timestamptz not null,
  join_window_started_at timestamptz,
  join_deadline_at       timestamptz,
  match_deadline_at      timestamptz,
  winner_id              uuid,
  result_type            text,
  forfeit_id             uuid,
  settled                bool not null default false,
  settlement_tx_id       text,
  settlement_snapshot    jsonb
);
create index if not exists ch_creator_idx  on challenges(creator_id);
create index if not exists ch_opponent_idx on challenges(opponent_id);
create index if not exists ch_open_idx      on challenges(status) where settled = false;

-- ─── Connect4: cached board for fast reads + move log for replay/audit ───────
create table if not exists connect4_matches (
  challenge_code text primary key references challenges(code) on delete cascade,
  board_state    smallint[] not null,
  phase          text not null,
  started_at     timestamptz,
  ended_at       timestamptz
);
create table if not exists connect4_moves (
  challenge_code text not null references challenges(code) on delete cascade,
  move_index     int  not null,
  actor_id       uuid not null,
  col            int  not null,
  created_at     timestamptz not null default now(),
  primary key (challenge_code, move_index)
);

-- ─── Async results (one row per player per challenge) ────────────────────────
create table if not exists async_results (
  challenge_code     text not null references challenges(code) on delete cascade,
  player_id          uuid not null references profiles(id),
  moves              jsonb not null,
  final_ms           numeric not null,
  finished_at        timestamptz not null,
  server_received_at timestamptz not null default now(),
  primary key (challenge_code, player_id)
);
