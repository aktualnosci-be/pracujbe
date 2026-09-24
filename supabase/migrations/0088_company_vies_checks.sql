-- =============================================================================
-- 0088_company_vies_checks.sql
-- Wynik weryfikacji belgijskiego numeru VAT w VIES jako informacja dla admina (#92).
--
-- 1. `company_vies_checks` — ostatni ROZSTRZYGAJĄCY wynik dla firmy (jeden wiersz na firmę):
--    numer (10 cyfr, poprawna suma kontrolna mod 97), wynik `valid` / `invalid`, nazwa
--    z rejestru (tylko dla `valid`), data zapytania VIES, czas sprawdzenia i admin.
--    Niedostępność usługi / limit zapytań NIE jest zapisywany (brak negatywnego cache
--    awarii) — CHECK dopuszcza wyłącznie `valid` i `invalid`.
--    RLS włączone i wymuszone, bez polityk; klient (anon/authenticated) nie ma grantów.
--    Odczyt: panel admina service-rolem po potwierdzeniu roli admina (jak reszta szczegółu).
-- 2. `admin_record_vies_check(...)` — zapis przez admina (SECURITY DEFINER, `is_admin()`).
--    Stan nierozstrzygający (`unavailable`, `rate_limited`, …) → VALIDATION_FAILED:
--    RESULT_NOT_PERSISTABLE. Zapis NIE zmienia statusu firmy (bez automatycznego
--    odrzucania) — decyzja pozostaje przy adminie (`admin_set_company_status`).
--    Każdy zapis → `audit_logs` (`company.vies_checked`, bez nazwy i numeru — tylko wynik).
--
-- Rollback: drop function admin_record_vies_check(uuid, text, text, text, date);
-- drop table company_vies_checks.
-- =============================================================================

create table if not exists public.company_vies_checks (
  company_id   uuid primary key references public.companies(id) on delete cascade,
  vat_number   text not null,
  result       text not null,
  vies_name    text,
  request_date date,
  checked_at   timestamptz not null default now(),
  checked_by   uuid references public.profiles(id) on delete set null,
  constraint company_vies_checks_result check (result in ('valid', 'invalid')),
  constraint company_vies_checks_vat check (
    vat_number ~ '^[01][0-9]{9}$'
    and 97 - (left(vat_number, 8)::bigint % 97) = right(vat_number, 2)::int
  ),
  constraint company_vies_checks_name check (
    vies_name is null or (result = 'valid' and char_length(vies_name) <= 300)
  )
);

alter table public.company_vies_checks enable row level security;
alter table public.company_vies_checks force row level security;
revoke all on public.company_vies_checks from public, anon, authenticated;

create or replace function public.admin_record_vies_check(
  p_company_id uuid,
  p_vat_number text,
  p_result text,
  p_vies_name text default null,
  p_request_date date default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := nullif(btrim(coalesce(p_vies_name, '')), '');
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  -- Tylko wynik rozstrzygający; awaria/limit VIES nigdy nie staje się „nieważny”.
  if p_result is null or p_result not in ('valid', 'invalid') then
    raise exception 'VALIDATION_FAILED: RESULT_NOT_PERSISTABLE' using errcode = '22023';
  end if;
  if p_vat_number is null or p_vat_number !~ '^[01][0-9]{9}$'
     or 97 - (left(p_vat_number, 8)::bigint % 97) <> right(p_vat_number, 2)::int then
    raise exception 'VALIDATION_FAILED: VAT_FORMAT' using errcode = '22023';
  end if;
  if p_result = 'invalid' then v_name := null; end if;
  v_name := left(v_name, 300);

  perform 1 from public.companies where id = p_company_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.company_vies_checks as c
    (company_id, vat_number, result, vies_name, request_date, checked_at, checked_by)
  values (p_company_id, p_vat_number, p_result, v_name, p_request_date, now(), auth.uid())
  on conflict (company_id) do update
    set vat_number = excluded.vat_number,
        result = excluded.result,
        vies_name = excluded.vies_name,
        request_date = excluded.request_date,
        checked_at = excluded.checked_at,
        checked_by = excluded.checked_by;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
  values (auth.uid(), 'company.vies_checked', 'company', p_company_id,
          jsonb_build_object('result', p_result));
end $$;

revoke all on function public.admin_record_vies_check(uuid, text, text, text, date)
  from public, anon;
grant execute on function public.admin_record_vies_check(uuid, text, text, text, date)
  to authenticated;
