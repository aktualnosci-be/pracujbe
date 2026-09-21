-- Prywatna kolejka poświadczeń auth; zapis używa transakcji aktywnej w SDK.
-- Rollback kodu pozostawia kolejkę i klucze idempotencji. Nie usuwa historii.
do $$
begin
  if current_user <> 'postgres' then raise exception 'Wymagany migrator postgres.'; end if;
  if not exists (select 1 from pg_roles where rolname = 'pracujbe_auth_mail') then
    create role pracujbe_auth_mail nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if exists (select 1 from pg_roles where rolname = 'pracujbe_auth_mail'
    and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolinherit or rolbypassrls))
    or exists (select 1 from pg_auth_members where member = 'pracujbe_auth_mail'::regrole) then
    raise exception 'Rola kolejki auth wymaga kontroli operatora.';
  end if;
end $$;
grant usage on schema auth to pracujbe_auth_mail;

create table auth.email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('verification', 'password_reset')),
  recipient_email text not null,
  first_name text not null,
  recipient_role text not null check (recipient_role in ('candidate', 'employer', 'admin')),
  locale text not null check (locale in ('pl', 'nl', 'fr', 'en')),
  token text,
  expires_at timestamptz not null,
  idempotency_key text not null unique check (idempotency_key ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued' check (status in ('queued', 'leased', 'sent', 'failed', 'expired')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_expires_at timestamptz,
  provider_message_id text,
  error_code text check (error_code in ('delivery_failed', 'render_failed', 'provider_unavailable')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check ((status in ('queued', 'leased') and token is not null and length(token) between 1 and 4096)
    or (status in ('sent', 'failed', 'expired') and token is null)),
  check ((status = 'leased' and lease_id is not null and lease_expires_at is not null)
    or (status <> 'leased' and lease_id is null and lease_expires_at is null))
);
create index email_outbox_pending_idx on auth.email_outbox(next_attempt_at, created_at)
  where status in ('queued', 'leased');
alter table auth.email_outbox enable row level security;
revoke all on auth.email_outbox from public, anon, authenticated, pracujbe_app,
  pracujbe_auth, pracujbe_auth_mail, service_role;

-- Widok komendy jest ZAWSZE pusty i nie odczytuje tabeli. SELECT jest potrzebny
-- wyłącznie do INSERT RETURNING w adapterze Kysely; nie umożliwia odczytu tokenów.
create view auth.email_enqueue as select null::uuid as id, null::uuid as user_id,
  null::text as kind, null::text as token, null::timestamptz as expires_at where false;
revoke all on auth.email_enqueue from public, anon, authenticated, pracujbe_app,
  pracujbe_auth, pracujbe_auth_mail, service_role;
grant select, insert on auth.email_enqueue to pracujbe_auth;

create function auth.enqueue_email_command() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  recipient record;
  receipt_id uuid;
  token_key text;
begin
  if new.user_id is null or new.kind is null or new.kind not in ('verification', 'password_reset')
    or new.token is null or length(new.token) not between 1 and 4096
    or new.expires_at is null or new.expires_at <= clock_timestamp()
    or new.expires_at > clock_timestamp() + interval '1 day' then
    raise exception 'AUTH_EMAIL_INVALID' using errcode = '23514';
  end if;
  select u.email, coalesce(p.first_name, '') as first_name, p.role::text as role,
    public.resolve_recipient_locale(p.id) as locale into recipient
    from auth.users u join public.profiles p on p.id = u.id
    where u.id = new.user_id and p.is_active and p.deleted_at is null;
  if not found then raise exception 'AUTH_EMAIL_RECIPIENT_UNAVAILABLE' using errcode = '23514'; end if;
  if new.kind = 'password_reset' and not exists (
    select 1 from auth.verifications v where v.identifier = 'reset-password:' || new.token
      and v.value = new.user_id::text and v.expires_at = new.expires_at
  ) then raise exception 'AUTH_EMAIL_INVALID' using errcode = '23514'; end if;
  token_key := encode(public.digest(new.kind || ':' || new.user_id::text || ':' || new.token, 'sha256'), 'hex');
  insert into auth.email_outbox(user_id, kind, recipient_email, first_name, recipient_role, locale,
    token, expires_at, idempotency_key)
    values (new.user_id, new.kind, recipient.email, recipient.first_name,
      case when recipient.role in ('employer', 'admin') then recipient.role else 'candidate' end,
      recipient.locale, new.token, new.expires_at, token_key)
    on conflict (idempotency_key) do update set id = auth.email_outbox.id
    returning id into receipt_id;
  new.id := receipt_id;
  new.token := null;
  return new;
end $$;
revoke all on function auth.enqueue_email_command() from public, anon, authenticated,
  pracujbe_app, pracujbe_auth, pracujbe_auth_mail, service_role;
create trigger enqueue_email_command instead of insert on auth.email_enqueue
  for each row execute function auth.enqueue_email_command();

create function auth.expire_emails() returns integer
language plpgsql security definer set search_path = pg_catalog as $$
declare changed integer;
begin
  update auth.email_outbox set status = 'expired', token = null, lease_id = null, lease_expires_at = null
    where status in ('queued', 'leased') and expires_at <= clock_timestamp();
  get diagnostics changed = row_count;
  return changed;
end $$;

create function auth.claim_emails(p_limit integer default 20, p_lease_seconds integer default 300)
returns setof auth.email_outbox
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_limit is null or p_lease_seconds is null
    or p_limit not between 1 and 100 or p_lease_seconds not between 1 and 600 then
    raise exception 'AUTH_EMAIL_INVALID' using errcode = '23514';
  end if;
  perform auth.expire_emails();
  -- Utracona ostatnia dzierżawa nie pozostawia tokenu bez końca.
  update auth.email_outbox set status = 'failed', token = null, lease_id = null,
    lease_expires_at = null, error_code = 'delivery_failed'
    where status = 'leased' and lease_expires_at <= clock_timestamp() and attempts >= 5;
  return query update auth.email_outbox e set status = 'leased', attempts = e.attempts + 1,
    lease_id = gen_random_uuid(), lease_expires_at = least(e.expires_at,
      clock_timestamp() + make_interval(secs => p_lease_seconds))
    where e.id in (select q.id from auth.email_outbox q
      where q.status in ('queued', 'leased') and q.attempts < 5 and q.expires_at > clock_timestamp()
        and q.next_attempt_at <= clock_timestamp()
        and (q.lease_expires_at is null or q.lease_expires_at <= clock_timestamp())
      order by q.created_at, q.id for update skip locked limit p_limit)
    returning e.*;
end $$;

create function auth.complete_email(p_id uuid, p_lease_id uuid, p_provider_message_id text)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
declare changed integer;
begin
  if p_provider_message_id is null or length(p_provider_message_id) not between 1 and 255 then
    raise exception 'AUTH_EMAIL_INVALID' using errcode = '23514';
  end if;
  update auth.email_outbox set status = 'sent', sent_at = clock_timestamp(), token = null,
    lease_id = null, lease_expires_at = null, provider_message_id = p_provider_message_id, error_code = null
    where id = p_id and status = 'leased' and lease_id = p_lease_id
      and lease_expires_at > clock_timestamp() and expires_at > clock_timestamp();
  get diagnostics changed = row_count;
  return changed = 1;
end $$;

create function auth.fail_email(p_id uuid, p_lease_id uuid, p_error_code text)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
declare delivery auth.email_outbox; retry_at timestamptz; terminal boolean;
begin
  if p_error_code is null or p_error_code not in ('delivery_failed', 'render_failed', 'provider_unavailable') then
    raise exception 'AUTH_EMAIL_INVALID' using errcode = '23514';
  end if;
  select * into delivery from auth.email_outbox where id = p_id and status = 'leased'
    and lease_id = p_lease_id and lease_expires_at > clock_timestamp()
    and expires_at > clock_timestamp() for update;
  if not found then return false; end if;
  retry_at := clock_timestamp() + make_interval(secs => (power(2, delivery.attempts) * 30)::integer);
  terminal := delivery.attempts >= 5 or retry_at >= delivery.expires_at;
  update auth.email_outbox set status = case when terminal then 'failed' else 'queued' end,
    token = case when terminal then null else token end, error_code = p_error_code,
    next_attempt_at = retry_at, lease_id = null, lease_expires_at = null where id = p_id;
  return true;
end $$;

revoke all on function auth.expire_emails(), auth.claim_emails(integer, integer),
  auth.complete_email(uuid, uuid, text), auth.fail_email(uuid, uuid, text)
  from public, anon, authenticated, pracujbe_app, pracujbe_auth, service_role;
grant execute on function auth.expire_emails(), auth.claim_emails(integer, integer),
  auth.complete_email(uuid, uuid, text), auth.fail_email(uuid, uuid, text) to pracujbe_auth_mail;
