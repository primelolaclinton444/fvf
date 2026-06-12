-- ============================================================================
-- Play4Stakes Phase 2 — 0004_functions.sql   (run after 0003)
-- Money + state authority. All SECURITY DEFINER, all row-locked.
-- Public-facing RPCs: create_challenge, accept_challenge, enter_match,
--   connect4_ready, adjudicate  (granted to 'authenticated').
-- Internal (service-role / cron / nested only): wallet_apply, settle_challenge,
--   resolve_async, record_async_result, record_connect4_move, adjudicate_all.
-- ============================================================================

-- ─── wallet primitive ────────────────────────────────────────────────────────
create or replace function wallet_apply(p_user uuid, p_delta bigint, p_reason text, p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update wallets set balance = balance + p_delta, updated_at = now() where user_id = p_user;
  if not found then raise exception 'WALLET_NOT_FOUND'; end if;  -- check(balance>=0) blocks overdraft
  insert into wallet_ledger(user_id, delta, reason, challenge_code)
    values (p_user, p_delta, p_reason, p_code);
end $$;

-- ─── create ──────────────────────────────────────────────────────────────────
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
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_stake <= 0  then raise exception 'INVALID_STAKE'; end if;

  perform wallet_apply(v_uid, -p_stake, 'CHALLENGE_FUND', v_code);  -- locks stake; throws if short

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

-- ─── accept (async -> MATCH_ACTIVE now; connect4 -> join window) ─────────────
create or replace function accept_challenge(p_code text)
returns challenges language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_now timestamptz := now(); v_ch challenges;
begin
  select * into v_ch from challenges where code = upper(p_code) for update;  -- kills double-accept
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
      creator_joined=true, opponent_joined=true, match_deadline_at=v_now + interval '30 min'
     where code=v_ch.code returning * into v_ch;
  end if;
  return v_ch;
end $$;

-- ─── enter match (connect4 explicit entry) ───────────────────────────────────
create or replace function enter_match(p_code text)
returns challenges language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ch challenges; v_cj bool; v_oj bool;
begin
  select * into v_ch from challenges where code = upper(p_code) for update;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_ch.status not in ('FULLY_FUNDED','JOIN_WINDOW_STARTED','MATCH_ACTIVE')
    then raise exception 'CHALLENGE_NOT_JOINABLE'; end if;
  if v_ch.join_deadline_at is not null and now() > v_ch.join_deadline_at
    then raise exception 'JOIN_WINDOW_EXPIRED'; end if;

  v_cj := coalesce(v_ch.creator_joined,false)  or v_uid = v_ch.creator_id;
  v_oj := coalesce(v_ch.opponent_joined,false) or v_uid = v_ch.opponent_id;

  update challenges set
    creator_joined = v_cj,
    opponent_joined = v_oj,
    status = case when v_cj and v_oj then 'MATCH_ACTIVE'
                  when status = 'FULLY_FUNDED' then 'JOIN_WINDOW_STARTED'
                  else status end
   where code = upper(p_code) returning * into v_ch;
  return v_ch;
end $$;

-- ─── connect4 ready ──────────────────────────────────────────────────────────
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

-- ─── settlement (race-proof, idempotent) ─────────────────────────────────────
create or replace function settle_challenge(p_code text, p_winner uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ch challenges; v_pot bigint; v_dev bigint:=0; v_proto bigint:=0; v_win bigint:=0;
begin
  select * into v_ch from challenges where code=p_code for update;   -- 2nd caller blocks here…
  if v_ch.settled then return; end if;                               -- …then returns. No double pay.

  v_pot := coalesce(v_ch.escrowed_creator,0) + coalesce(v_ch.escrowed_opponent,0);

  if p_reason in ('WIN','FORFEIT') then
    v_dev   := (v_pot * v_ch.fee_dev_pct)/100;
    v_proto := (v_pot * v_ch.fee_protocol_pct)/100;
    v_win   := v_pot - v_dev - v_proto;
    perform wallet_apply(p_winner, v_win, 'WINNINGS', p_code);
    if v_dev   > 0 then perform wallet_apply('00000000-0000-0000-0000-0000000000de', v_dev,   'DEV_FEE', p_code); end if;
    if v_proto > 0 then perform wallet_apply('00000000-0000-0000-0000-0000000000b0', v_proto, 'PROTOCOL_FEE', p_code); end if;
  else  -- DRAW | NO_SHOW_REFUND | REFUND : return each escrow, no fees
    if v_ch.creator_id  is not null then perform wallet_apply(v_ch.creator_id,  coalesce(v_ch.escrowed_creator,0),  'REFUND', p_code); end if;
    if v_ch.opponent_id is not null then perform wallet_apply(v_ch.opponent_id, coalesce(v_ch.escrowed_opponent,0), 'REFUND', p_code); end if;
  end if;

  update challenges set
    settled=true, status='SETTLED', winner_id=p_winner, result_type=p_reason,
    settlement_tx_id='settle_'||p_code||'_'||(extract(epoch from now())*1000)::bigint,
    settlement_snapshot=jsonb_build_object(
      'pot',v_pot,'winnerAmount',v_win,'developerAmount',v_dev,'protocolAmount',v_proto,
      'winnerUid',p_winner,'reason',p_reason,'finalizedAt',extract(epoch from now())*1000)
   where code=p_code;
end $$;

-- ─── async resolve (pick faster valid time) ──────────────────────────────────
create or replace function resolve_async(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ch challenges; v_a numeric; v_b numeric;
begin
  select * into v_ch from challenges where code=p_code for update;
  if v_ch.settled then return; end if;
  select final_ms into v_a from async_results where challenge_code=p_code and player_id=v_ch.creator_id;
  select final_ms into v_b from async_results where challenge_code=p_code and player_id=v_ch.opponent_id;

  if v_a is null and v_b is null then perform settle_challenge(p_code, null::uuid, 'NO_SHOW_REFUND'); return; end if;
  if v_a is null then perform settle_challenge(p_code, v_ch.opponent_id, 'FORFEIT'); return; end if;
  if v_b is null then perform settle_challenge(p_code, v_ch.creator_id,  'FORFEIT'); return; end if;

  if    v_a < v_b then perform settle_challenge(p_code, v_ch.creator_id,  'WIN');
  elsif v_b < v_a then perform settle_challenge(p_code, v_ch.opponent_id, 'WIN');
  else  perform settle_challenge(p_code, null::uuid, 'DRAW');
  end if;
end $$;

-- ─── persist a validated async result (called by Edge fn in Step 5) ──────────
create or replace function record_async_result(p_code text, p_player uuid, p_moves jsonb, p_final_ms numeric)
returns challenges language plpgsql security definer set search_path = public as $$
declare v_ch challenges;
begin
  select * into v_ch from challenges where code=p_code for update;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_ch.status <> 'MATCH_ACTIVE' then raise exception 'MATCH_NOT_ACTIVE'; end if;
  if p_player not in (v_ch.creator_id, v_ch.opponent_id) then raise exception 'NOT_A_PARTICIPANT'; end if;

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

-- ─── persist a validated connect4 move (called by Edge fn in Step 5) ─────────
create or replace function record_connect4_move(
  p_code text, p_actor uuid, p_col int, p_board smallint[], p_winner uuid, p_draw bool)
returns challenges language plpgsql security definer set search_path = public as $$
declare v_ch challenges; v_idx int; v_next uuid;
begin
  select * into v_ch from challenges where code=p_code for update;
  if not found then raise exception 'CHALLENGE_NOT_FOUND'; end if;
  if v_ch.status <> 'MATCH_ACTIVE' or v_ch.phase <> 'IN_PROGRESS' then raise exception 'INVALID_PHASE'; end if;
  if v_ch.current_turn_id <> p_actor then raise exception 'NOT_YOUR_TURN'; end if;
  if v_ch.turn_deadline_at is not null and now() > v_ch.turn_deadline_at then raise exception 'DEADLINE_EXPIRED'; end if;

  select coalesce(max(move_index)+1,0) into v_idx from connect4_moves where challenge_code=p_code;
  insert into connect4_moves(challenge_code, move_index, actor_id, col) values (p_code, v_idx, p_actor, p_col);

  update connect4_matches set
    board_state = p_board,
    phase = case when p_winner is not null or p_draw then 'COMPLETE' else phase end,
    ended_at = case when p_winner is not null or p_draw then now() else ended_at end
   where challenge_code=p_code;

  if p_winner is not null then
    update challenges set phase='COMPLETE', result_type='WIN', winner_id=p_winner where code=p_code;
    perform settle_challenge(p_code, p_winner, 'WIN');
  elsif p_draw then
    update challenges set phase='COMPLETE', result_type='DRAW' where code=p_code;
    perform settle_challenge(p_code, null::uuid, 'DRAW');
  else
    v_next := case when p_actor=v_ch.creator_id then v_ch.opponent_id else v_ch.creator_id end;
    update challenges set current_turn_id=v_next, turn_number=coalesce(turn_number,1)+1,
       turn_deadline_at=now() + interval '30 sec' where code=p_code;
  end if;

  select * into v_ch from challenges where code=p_code;
  return v_ch;
end $$;

-- ─── deadline adjudication (one challenge) ───────────────────────────────────
create or replace function adjudicate(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ch challenges; v_now timestamptz := now(); v_cdone bool; v_odone bool;
begin
  select * into v_ch from challenges where code=p_code for update;
  if not found or v_ch.settled then return; end if;

  -- expired with no opponent -> refund creator
  if v_ch.status='AWAITING_OPPONENT' and v_now > v_ch.expires_at then
    update challenges set status='CREATOR_REFUNDED' where code=p_code;
    perform settle_challenge(p_code, null::uuid, 'REFUND');
    update challenges set status='CREATOR_REFUNDED' where code=p_code;  -- keep terminal label
    return;
  end if;

  -- connect4 join window lapsed without both entering -> refund both
  if v_ch.status in ('FULLY_FUNDED','JOIN_WINDOW_STARTED')
     and v_ch.join_deadline_at is not null and v_now > v_ch.join_deadline_at
     and not (coalesce(v_ch.creator_joined,false) and coalesce(v_ch.opponent_joined,false)) then
    update challenges set status='BOTH_REFUNDED' where code=p_code;
    perform settle_challenge(p_code, null::uuid, 'NO_SHOW_REFUND');
    update challenges set status='BOTH_REFUNDED' where code=p_code;
    return;
  end if;

  -- async match deadline
  if v_ch.status='MATCH_ACTIVE' and v_ch.game_type<>'CONNECT4'
     and v_ch.match_deadline_at is not null and v_now > v_ch.match_deadline_at then
    v_cdone := exists(select 1 from async_results where challenge_code=p_code and player_id=v_ch.creator_id);
    v_odone := exists(select 1 from async_results where challenge_code=p_code and player_id=v_ch.opponent_id);
    if      v_cdone and v_odone then perform resolve_async(p_code);
    elsif   v_cdone             then perform settle_challenge(p_code, v_ch.creator_id,  'FORFEIT');
    elsif   v_odone             then perform settle_challenge(p_code, v_ch.opponent_id, 'FORFEIT');
    else    perform settle_challenge(p_code, null::uuid, 'NO_SHOW_REFUND');
    end if;
    return;
  end if;

  -- connect4 turn timeout -> current player forfeits
  if v_ch.game_type='CONNECT4' and v_ch.phase='IN_PROGRESS'
     and v_ch.turn_deadline_at is not null and v_now > v_ch.turn_deadline_at then
    perform settle_challenge(p_code,
      case when v_ch.current_turn_id=v_ch.creator_id then v_ch.opponent_id else v_ch.creator_id end,
      'FORFEIT');
  end if;
end $$;

-- ─── sweep all lapsed challenges (called by cron in 0005) ────────────────────
create or replace function adjudicate_all()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select code from challenges
    where settled = false
      and (
        (status='AWAITING_OPPONENT' and now()>expires_at) or
        (status in ('FULLY_FUNDED','JOIN_WINDOW_STARTED') and join_deadline_at is not null and now()>join_deadline_at) or
        (status='MATCH_ACTIVE' and game_type<>'CONNECT4' and match_deadline_at is not null and now()>match_deadline_at) or
        (status='MATCH_ACTIVE' and game_type='CONNECT4' and phase='IN_PROGRESS' and turn_deadline_at is not null and now()>turn_deadline_at)
      )
  loop
    perform adjudicate(r.code);
  end loop;
end $$;

-- ─── grants: only the public-facing RPCs are callable by clients ─────────────
revoke execute on function wallet_apply(uuid,bigint,text,text)                      from public;
revoke execute on function settle_challenge(text,uuid,text)                         from public;
revoke execute on function resolve_async(text)                                      from public;
revoke execute on function record_async_result(text,uuid,jsonb,numeric)             from public;
revoke execute on function record_connect4_move(text,uuid,int,smallint[],uuid,bool) from public;
revoke execute on function adjudicate_all()                                         from public;
revoke execute on function handle_new_user()                                        from public;

grant execute on function create_challenge(game_type,bigint,text,uuid) to authenticated;
grant execute on function accept_challenge(text)                       to authenticated;
grant execute on function enter_match(text)                            to authenticated;
grant execute on function connect4_ready(text,bool)                    to authenticated;
grant execute on function adjudicate(text)                             to authenticated;
