-- ============================================================================
-- Play4Stakes Phase 2 — 0003_auth_trigger.sql   (run after 0002)
-- New auth user => profile + 1000-coin starter wallet, server-side.
-- ============================================================================

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, handle)
    values (new.id, 'p_' || left(new.id::text, 8))
    on conflict (id) do nothing;
  insert into public.wallets(user_id, balance)
    values (new.id, 1000)
    on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
