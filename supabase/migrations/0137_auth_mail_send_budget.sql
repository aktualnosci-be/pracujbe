-- =============================================================================
-- 0137_auth_mail_send_budget.sql
-- Budżet wysyłki puli `auth` w workerze Better Auth (CLAUDE.md, Etap 3 „Otwarte”).
--
-- Worker `auth.email_outbox` (0061, rola `pracujbe_auth_mail`) wysyłał potwierdzenia adresu
-- i resety hasła bez budżetu okna dostawcy (`take_email_send_budget`, 0087) — budżet pobierał
-- tylko dawny hook GoTrue (#27, usunięty). Pula `auth` ma sufit równy limitowi dostawcy, a
-- pozostałe pule zatrzymują się wcześniej (rezerwy), więc brak poboru przez auth zaniżał
-- licznik okna i pozwalał powiadomieniom przekroczyć limit dostawcy razem z listami konta.
--
--   1. `auth.take_send_budget(template)` — wąska nakładka dla roli workera: tylko szablony
--      kolejki auth (`accountConfirmation`, `passwordReset`), wynik = `take_email_send_budget`.
--      Rola `pracujbe_auth_mail` nie dostaje EXECUTE na funkcji w public (zużyłaby budżet
--      dowolnej puli).
--   2. `auth.defer_email(id, lease, retry_at)` — odmowa budżetu = odłożenie zlecenia bez
--      zużycia próby: status `queued`, `attempts` cofnięte o próbę pobraną przy claimie,
--      `next_attempt_at` = początek następnego okna (1 s … 1 h), token zostaje. Tylko ważna
--      dzierżawa (lease_id) i niewygasłe zlecenie.
--
-- Funkcje tworzone warunkowo — tylko w bazie z kolejką auth (database/auth/0061).
-- Rollback: drop `auth.take_send_budget(text)` i `auth.defer_email(uuid, uuid, timestamptz)`;
-- worker bez nich wysyła jak przed zmianą (błąd poboru budżetu = fail-open).
-- =============================================================================

do $mig$
begin
  if to_regclass('auth.email_outbox') is null then
    return;
  end if;

  execute $ddl$
create or replace function auth.take_send_budget(p_template text)
returns table (granted boolean, retry_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $fn$
begin
  if p_template is null or p_template not in ('accountConfirmation', 'passwordReset') then
    raise exception 'AUTH_EMAIL_INVALID' using errcode = '23514';
  end if;
  return query select b.granted, b.retry_at from public.take_email_send_budget(p_template) b;
end $fn$
  $ddl$;

  execute $ddl$
create or replace function auth.defer_email(p_id uuid, p_lease_id uuid, p_retry_at timestamptz)
returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp as $fn$
declare changed integer;
begin
  update auth.email_outbox
     set status = 'queued',
         -- claim_emails pobrał próbę; odmowa budżetu nie jest porażką wysyłki.
         attempts = greatest(attempts - 1, 0),
         next_attempt_at = least(
           greatest(coalesce(p_retry_at, clock_timestamp()), clock_timestamp() + interval '1 second'),
           clock_timestamp() + interval '1 hour'),
         lease_id = null,
         lease_expires_at = null
   where id = p_id and status = 'leased' and lease_id = p_lease_id
     and lease_expires_at > clock_timestamp() and expires_at > clock_timestamp();
  get diagnostics changed = row_count;
  return changed = 1;
end $fn$
  $ddl$;

  execute 'revoke all on function auth.take_send_budget(text), '
    || 'auth.defer_email(uuid, uuid, timestamptz) '
    || 'from public, anon, authenticated, pracujbe_app, pracujbe_auth, service_role';
  execute 'grant execute on function auth.take_send_budget(text), '
    || 'auth.defer_email(uuid, uuid, timestamptz) to pracujbe_auth_mail';
end
$mig$;
