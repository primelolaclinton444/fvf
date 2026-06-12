-- ============================================================================
-- Play4Stakes Phase 2 — 0008_step6_hardening.sql  (run after 0007)
-- Step 6 adds rate limits to the two most abuse-prone RPCs:
--   • create_challenge: max 10 in 5 minutes per user (funded-spam)
--   • accept_challenge: max 30 in 5 minutes per user (open-challenge griefing)
-- Counts are taken from `wallet_ledger` (CHALLENGE_FUND rows) so the rate
-- limit is itself an audited number, not a separate counter that could drift.
-- ============================================================================

create or replace function create_challenge(
  p_game game_type, p_stake bigint, p_format text default 'SINGLE', p_target uuid default null)
returns challenges language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_now  timestamptz := now();
  v_c4   bool := p_game = 'CONNECT4';
  v_code text := upper(substr(md5(gen_random_uuid()::text),1,8));
  v_seed text := encode(gen_random_bytes(16),'hex');
  v_ch   challenges;
  v_recent int;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_stake <= 0  then raise exception 'INVALID_STAKE'; end if;

  -- Rate limit: count CHALLENGE_FUND debits this user has had in last 5 min.
  -- Includes both creates and accepts (we count any stake locking by the user)
  -- since they all consume the same resource (other people's attention/time).
  select count(*) into v_recent
    from wallet_ledger
   where user_id = v_uid
     and reason = 'CHALLENGE_FUND'
     and created_at > v_now - interval '5 minutes';
  if v_recent >= 10 then raise exception 'RATE_LIMIT_CREATE'; end if;

  perform wallet_apply(v_uid, -p_stake, 'CHALLENGE_FUND', v_code);

  insert into challenges(
    code, game_type, seed, stake, status, match_format,
    creator_id, target_opponent_id, escrowed_creator,
    created_at, expires_at, mode, phase, ready_creator, ready_opponent, turn_number)
  values (
    v_code, p_game, v_seed, p_stake, 'AWAITING_OPPONENT', p_format,
    v_uid, p_target, p_stake,
    v_now, v_now + (case when v_c4 then interval '5 min' else interval '30 min' end),
    case when v_c4 then 'SYNC' else 'ASYNC' end,
    case when v_c4 then 'WAITING_READY' end,
    case when v_c4 then false end,
    case when v_c4 then false end,
    case when v_c4 then 0 end)
  returning * into v_ch;

  if v_c4 then
    insert into connect4_matches(challenge_code, board_state, phase)
      values (v_code, array_fill(0, array[42])::smallint[], 'WAITING_READY');
  end if;
  return v_ch;
end $$;
grant execute on function create_challenge(game_type,bigint,text,uuid) to authenticated;

-- Accept rate limit is separate (higher ceiling — accepting open challenges
-- is the desired behaviour, only abusive at scale).
create or replace function accept_challenge(p_code text)
returns challenges language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_now timestamptz := now(); v_ch challenges; v_recent int;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select count(*) into v_recent
    from wallet_ledger
   where user_id = v_uid
     and reason = 'CHALLENGE_FUND'
     and created_at > v_now - interval '5 minutes';
  if v_recent >= 30 then raise exception 'RATE_LIMIT_ACCEPT'; end if;

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
