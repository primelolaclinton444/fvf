-- ============================================================================
-- Play4Stakes Phase 2 — 0002_rls.sql   (run after 0001)
-- Reads are policy-gated. Writes are DENIED here — every mutation goes through a
-- SECURITY DEFINER function in 0004, which enforces its own checks.
-- ============================================================================

alter table profiles         enable row level security;
alter table wallets          enable row level security;
alter table wallet_ledger    enable row level security;
alter table challenges       enable row level security;
alter table connect4_matches enable row level security;
alter table connect4_moves   enable row level security;
alter table async_results    enable row level security;

-- profiles: everyone reads handles; you update only your own
drop policy if exists profiles_read   on profiles;
drop policy if exists profiles_update on profiles;
create policy profiles_read   on profiles for select using (true);
create policy profiles_update on profiles for update using (id = auth.uid());

-- wallet + ledger: read your own only; no client writes
drop policy if exists wallet_read on wallets;
drop policy if exists ledger_read on wallet_ledger;
create policy wallet_read on wallets       for select using (user_id = auth.uid());
create policy ledger_read on wallet_ledger for select using (user_id = auth.uid());

-- challenges: participants always; an open/invited challenge is readable by code
drop policy if exists ch_read on challenges;
create policy ch_read on challenges for select using (
  creator_id = auth.uid()
  or opponent_id = auth.uid()
  or (status = 'AWAITING_OPPONENT'
      and (target_opponent_id is null or target_opponent_id = auth.uid()))
);

-- connect4 + async: readable iff you can read the parent challenge
drop policy if exists c4m_read  on connect4_matches;
drop policy if exists c4mv_read on connect4_moves;
drop policy if exists ar_read   on async_results;

create policy c4m_read on connect4_matches for select using (exists (
  select 1 from challenges c where c.code = challenge_code
    and (c.creator_id = auth.uid() or c.opponent_id = auth.uid())));

create policy c4mv_read on connect4_moves for select using (exists (
  select 1 from challenges c where c.code = challenge_code
    and (c.creator_id = auth.uid() or c.opponent_id = auth.uid())));

create policy ar_read on async_results for select using (
  player_id = auth.uid()
  or exists (select 1 from challenges c where c.code = challenge_code
       and (c.creator_id = auth.uid() or c.opponent_id = auth.uid())));

-- NOTE: no insert/update/delete policies exist => those are denied for the
-- 'authenticated' role. All writes flow through the functions in 0004.
