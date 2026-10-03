-- #486: an expired confirmation link has no further use, even while the
-- confirmed request remains for the separately approved retention policy.
-- NULL is allowed by the existing format checks and unique constraint.
alter table public.guest_application_requests
  alter column confirm_token_hash drop not null,
  alter column confirm_nonce drop not null;

create index guest_application_requests_confirm_cleanup_idx
  on public.guest_application_requests(confirm_expires_at, id)
  where status = 'confirmed' and confirm_token_hash is not null;

create or replace function public.purge_guest_application_requests()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ids uuid[]; v_count integer;
begin
  select coalesce(array_agg(id), '{}') into v_ids
    from (select id from public.guest_application_requests
           where (status = 'pending' and confirm_expires_at < now() - interval '5 days')
              or (status = 'duplicate' and coalesce(confirmed_at, created_at) < now() - interval '7 days')
           order by created_at
           limit 5000
           for update skip locked) s;
  delete from public.email_deliveries
   where entity_type = 'guest_application_request' and entity_id = any(v_ids);
  delete from public.guest_application_requests where id = any(v_ids);
  get diagnostics v_count = row_count;

  -- The confirmation link expires after 48 hours. Keep the nonce and hash
  -- only while the link can still be used; this does not change the separate
  -- 30-day claim window or the retention of the request/notice evidence.
  update public.guest_application_requests
     set confirm_token_hash = null, confirm_nonce = null
   where id in (
     select id from public.guest_application_requests
      where status = 'confirmed' and confirm_token_hash is not null
        and confirm_expires_at <= now()
      order by confirm_expires_at, id
      limit 5000
      for update skip locked
   );

  update public.guest_application_requests
     set claim_token_hash = null, claim_nonce = null
   where claim_token_hash is not null and claim_expires_at <= now();
  return v_count;
end $$;

revoke all on function public.purge_guest_application_requests() from public, anon, authenticated;
grant execute on function public.purge_guest_application_requests() to service_role;
