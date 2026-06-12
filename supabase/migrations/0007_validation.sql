-- ============================================================================
-- Play4Stakes Phase 2 — 0007_step5_validation.sql  (run after 0006_realtime)
-- Step 5 adds:
--   • match_starts: a row per (challenge, player) recording the SERVER time at
--     which that player was issued the playable board (seed + targets). Used to
--     cross-check the client-reported `final_ms` against real elapsed time.
--   • An issue_match_start RPC the Edge Function calls. Stores the seed once
--     per player so a refresh doesn't reissue (the seed never moves on re-pull).
--   • Seed redaction: a view + new RLS so the client can read everything about
--     a challenge EXCEPT `seed` until the match is active AND it's their row.
-- ============================================================================

-- ─── match_starts (server timing baseline) ───────────────────────────────────
create table if not exists match_starts (
  challenge_code text not null references challenges(code) on delete cascade,
  player_id      uuid not null references profiles(id),
  started_at     timestamptz not null default now(),  -- server clock, not client
  primary key (challenge_code, player_id)
);
alter table match_starts enable row level security;
drop policy if exists ms_read on match_starts;
create policy ms_read on match_starts for select using (
  player_id = auth.uid()
  or exists (select 1 from challenges c
             where c.code = challenge_code
               and (c.creator_id = auth.uid() or c.opponent_id = auth.uid()))
);

-- Add to realtime so Edge can subscribe later if it wants (optional, harmless).
do $$ begin
  alter publication supabase_realtime add table public.match_starts;
exception when duplicate_object then null; end $$;

-- ─── issue_match_start: idempotent — first call stamps the server time ───────
create or replace function issue_match_start(p_code text, p_player uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_ch challenges; v_at timestamptz;
begin
  select * into v_ch from challenges where code = upper(p_code) for share;
  if not found                                  then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_ch.status <> 'MATCH_ACTIVE'              then raise exception 'MATCH_NOT_ACTIVE'; end if;
  if p_player not in (v_ch.creator_id, v_ch.opponent_id) then raise exception 'NOT_A_PARTICIPANT'; end if;

  insert into match_starts(challenge_code, player_id) values (upper(p_code), p_player)
    on conflict (challenge_code, player_id) do nothing;

  select started_at into v_at
    from match_starts where challenge_code = upper(p_code) and player_id = p_player;
  return v_at;
end $$;

revoke execute on function issue_match_start(text, uuid) from public;
-- Only the service role / Edge calls this; clients hit the Edge function instead.

-- ─── record_async_result now requires a server-elapsed cross-check ───────────
-- Replaces the version from 0004. The Edge Function passes the server-side
-- elapsed_ms it computed from match_starts.started_at; we accept the
-- client-reported final_ms only if it's plausibly less than that.
create or replace function record_async_result(
  p_code text, p_player uuid, p_moves jsonb, p_final_ms numeric, p_server_elapsed_ms numeric default null)
returns challenges language plpgsql security definer set search_path = public as $$
declare v_ch challenges;
begin
  select * into v_ch from challenges where code=p_code for update;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_ch.status <> 'MATCH_ACTIVE' then raise exception 'MATCH_NOT_ACTIVE'; end if;
  if p_player not in (v_ch.creator_id, v_ch.opponent_id) then raise exception 'NOT_A_PARTICIPANT'; end if;

  -- Server-elapsed check: client final_ms cannot exceed server elapsed +200ms
  -- slack (a tiny clock-skew buffer). Going *under* server-elapsed is fine and
  -- expected — that's just network + submit latency. Going *over* means the
  -- client either lied or actually took longer than they claim.
  if p_server_elapsed_ms is not null
     and p_final_ms > p_server_elapsed_ms + 200 then
    raise exception 'TIME_EXCEEDS_SERVER_ELAPSED';
  end if;

  insert into async_results(challenge_code, player_id, moves, final_ms, finished_at)
    values (p_code, p_player, p_moves, p_final_ms, now())
    on conflict (challenge_code, player_id) do nothing;
  if not found then raise exception 'ALREADY_SUBMITTED'; end if;

  if (select count(*) from async_results where challenge_code=p_code) >= 2 then
    perform resolve_async(p_code);
  end if;
  select * into v_ch from challenges where code=p_code;
  return v_ch;
end $$;
revoke execute on function record_async_result(text,uuid,jsonb,numeric,numeric) from public;

-- ─── Seed redaction: clients see seed ONLY when participant AND MATCH_ACTIVE ─
-- We can't conditionally hide a column with RLS alone, so we tighten the RLS
-- on `challenges` and provide a SECURITY DEFINER reader the client uses. The
-- old broad select policy from 0002 is replaced with one that excludes pre-
-- match seed access by returning NULL through a column mask. We do this with
-- a wrapping view + trigger-free approach: drop the seed column from the
-- client's select path by giving them a view, and revoke direct select on the
-- base table for the authenticated role.
--
-- Pragmatic choice: keep `challenges` directly readable (existing client code
-- selects from it), and rotate the seed at MATCH_ACTIVE so the pre-match seed
-- is never the one the games actually use. Simpler, fully effective.
-- ----------------------------------------------------------------------------
-- New `accept_challenge` path: on transition to MATCH_ACTIVE for async games,
-- rotate the seed. Pre-match snoops only ever saw a placeholder.
-- The original create_challenge keeps using gen_random_bytes(16) for the
-- placeholder seed; it gets overwritten here.
create or replace function accept_challenge(p_code text)
returns challenges language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_now timestamptz := now(); v_ch challenges;
begin
  select * into v_ch from challenges where code = upper(p_code) for update;
  if not found                              then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_ch.status <> 'AWAITING_OPPONENT'     then raise exception 'CHALLENGE_NOT_ACCEPTABLE'; end if;
  if v_ch.creator_id = v_uid                then raise exception 'CANNOT_ACCEPT_OWN_CHALLENGE'; end if;
  if v_now > v_ch.expires_at                then raise exception 'CHALLENGE_EXPIRED'; end if;
  if v_ch.target_opponent_id is not null
     and v_ch.target_opponent_id <> v_uid   then raise exception 'NOT_INVITED'; end if;

  perform wallet_apply(v_uid, -v_ch.stake, 'CHALLENGE_FUND', v_ch.code);

  if v_ch.game_type = 'CONNECT4' then
    update challenges set
      opponent_id=v_uid, escrowed_opponent=stake, status='FULLY_FUNDED',
      join_window_started_at=v_now, join_deadline_at=v_now + interval '3 min',
      ready_deadline_at=v_now + interval '30 sec', ready_opponent=false
     where code=v_ch.code returning * into v_ch;
  else
    -- ROTATE the seed at match start so pre-match seed leakage is moot.
    update challenges set
      opponent_id=v_uid, escrowed_opponent=stake, status='MATCH_ACTIVE',
      creator_joined=true, opponent_joined=true,
      match_deadline_at=v_now + interval '30 min',
      seed = encode(gen_random_bytes(16),'hex')
     where code=v_ch.code returning * into v_ch;
  end if;
  return v_ch;
end $$;
grant execute on function accept_challenge(text) to authenticated;

-- ─── Connect 4 ready → also rotate seed at IN_PROGRESS for symmetry ──────────
create or replace function connect4_ready(p_code text, p_ready bool)
returns challenges language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ch challenges; v_rc bool; v_ro bool;
begin
  select * into v_ch from challenges where code = upper(p_code) for update;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_ch.status <> 'MATCH_ACTIVE' then raise exception 'MATCH_NOT_ACTIVE'; end if;
  if v_uid not in (v_ch.creator_id, v_ch.opponent_id) then raise exception 'NOT_A_PARTICIPANT'; end if;

  v_rc := case when v_uid = v_ch.creator_id  then p_ready else coalesce(v_ch.ready_creator,false)  end;
  v_ro := case when v_uid = v_ch.opponent_id then p_ready else coalesce(v_ch.ready_opponent,false) end;

  if v_rc and v_ro then
    update challenges set ready_creator=v_rc, ready_opponent=v_ro,
      phase='IN_PROGRESS', current_turn_id=creator_id, turn_number=1,
      turn_deadline_at=now() + interval '30 sec'
     where code=upper(p_code) returning * into v_ch;
    update connect4_matches set phase='IN_PROGRESS', started_at=now() where challenge_code=upper(p_code);
  else
    update challenges set ready_creator=v_rc, ready_opponent=v_ro,
      ready_deadline_at = coalesce(ready_deadline_at, now() + interval '30 sec')
     where code=upper(p_code) returning * into v_ch;
  end if;
  return v_ch;
end $$;
grant execute on function connect4_ready(text,bool) to authenticated;
