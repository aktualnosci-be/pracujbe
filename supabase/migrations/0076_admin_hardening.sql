-- =============================================================================
-- 0076_admin_hardening.sql
-- Panel administratora: domknięcie uprawnień i walidacji zgłoszeń.
--
-- 1. reports — pola tożsamości i moderacji ustala baza:
--    * INSERT od klienta (auth.uid() niepusty): reporter_id = auth.uid(), status = 'open',
--      resolved_by/resolved_at = null, created_at/updated_at = now().
--    * UPDATE od klienta tylko w kontekście admina (RPC admin_resolve_report). Klient i tak
--      nie ma grantu UPDATE/DELETE (0068) — trigger jest obroną w głąb.
--    * Backend (service_role, auth.uid() = null) bez zmian.
--    * Twarde sufity długości reason/details (NOT VALID: egzekwowane dla nowych wierszy,
--      istniejących nie blokuje).
-- 2. Funkcje pomocnicze ról: EXECUTE odebrane PUBLIC/anon, nadane jawnie authenticated
--    (polityki RLS dla authenticated) i service_role. is_job_company_member zostaje dla
--    anon — używają go polityki SELECT relacji ofert dla anon. RPC SECURITY DEFINER wołają
--    helpery z prawami właściciela, więc nie zależą od tych grantów.
--
-- Rollback: drop trigger trg_reports_guard + function reports_guard(); drop constraint
-- reports_reason_length/reports_details_length; grant execute ... to public.
-- =============================================================================

create or replace function public.reports_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.reporter_id := auth.uid();
    new.status := 'open';
    new.resolved_by := null;
    new.resolved_at := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if not public.is_admin() then
    raise exception 'PERMISSION_DENIED: zgłoszenie zmienia tylko administrator'
      using errcode = '42501';
  end if;
  if new.reporter_id is distinct from old.reporter_id
     or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id
     or new.reason is distinct from old.reason
     or new.details is distinct from old.details
     or new.created_at is distinct from old.created_at then
    raise exception 'PERMISSION_DENIED: treść zgłoszenia jest niezmienna'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.reports_guard() from public;

drop trigger if exists trg_reports_guard on public.reports;
create trigger trg_reports_guard
  before insert or update on public.reports
  for each row execute function public.reports_guard();

alter table public.reports
  drop constraint if exists reports_reason_length,
  drop constraint if exists reports_details_length;
alter table public.reports
  add constraint reports_reason_length check (char_length(reason) between 1 and 200) not valid,
  add constraint reports_details_length check (details is null or char_length(details) <= 5000) not valid;

-- Funkcje pomocnicze ról: bez PUBLIC/anon.
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.is_admin()',
    'public.is_company_member(uuid)',
    'public.is_company_admin(uuid)',
    'public.is_company_owner(uuid)',
    'public.can_manage_jobs(uuid)',
    'public.is_job_manager(uuid)',
    'public.is_conversation_member(uuid)',
    'public.can_access_application(uuid)',
    'public.can_access_offer(uuid)',
    'public.company_can_view_candidate(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end $$;
