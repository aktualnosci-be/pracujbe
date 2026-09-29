-- =============================================================================
-- Rollback 0192 (kolejka automatycznego sprawdzenia VIES, #706/#879) — usuwa kolejkę,
-- triggery i funkcje z 0192 oraz przywraca `record_company_vies_check_auto` z 0164
-- (bez nadpisywania wyniku dla innego numeru). Zadania w kolejce giną (to tylko termin
-- ponowienia — wyniki w `company_vies_checks` zostają).
-- =============================================================================

drop trigger if exists trg_companies_vies_auto_enqueue on public.companies;
drop trigger if exists trg_company_vies_checks_dequeue on public.company_vies_checks;
drop function if exists public.trg_company_vies_auto_enqueue();
drop function if exists public.trg_company_vies_check_dequeue();
drop function if exists public.claim_company_vies_auto_checks(integer, uuid, integer);
drop function if exists public.finish_company_vies_auto_check(uuid, text, text);
drop table if exists public.company_vies_auto_queue;
drop function if exists public.company_vies_auto_max_attempts();

create or replace function public.record_company_vies_check_auto(
  p_company_id uuid,
  p_vat_number text,
  p_result text,
  p_vies_name text default null,
  p_request_date date default null
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := nullif(btrim(coalesce(p_vies_name, '')), '');
  v_source text;
  v_rows integer;
begin
  if p_result is null or p_result not in ('valid', 'invalid') then
    raise exception 'VALIDATION_FAILED: RESULT_NOT_PERSISTABLE' using errcode = '22023';
  end if;
  if p_vat_number is null or p_vat_number !~ '^[01][0-9]{9}$'
     or 97 - (left(p_vat_number, 8)::bigint % 97) <> right(p_vat_number, 2)::int then
    raise exception 'VALIDATION_FAILED: VAT_FORMAT' using errcode = '22023';
  end if;
  if p_result = 'invalid' then v_name := null; end if;
  v_name := left(v_name, 300);

  -- Bieżący numer firmy (VAT, a gdy brak — KBO), znormalizowany jak `parseBelgianVat`.
  select regexp_replace(upper(coalesce(nullif(btrim(vat_number), ''), nullif(btrim(registration_number), ''))),
                        '[[:space:].\-/]', '', 'g')
    into v_source
    from public.companies
   where id = p_company_id and deleted_at is null
   for share;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  if v_source like 'BE%' then v_source := substr(v_source, 3); end if;
  if v_source ~ '^[0-9]{9}$' then v_source := '0' || v_source; end if;
  if v_source is distinct from p_vat_number then
    return false;
  end if;

  insert into public.company_vies_checks
    (company_id, vat_number, result, vies_name, request_date, checked_at, checked_by)
  values (p_company_id, p_vat_number, p_result, v_name, p_request_date, now(), null)
  on conflict (company_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
  values (null, 'company.vies_checked', 'company', p_company_id,
          jsonb_build_object('result', p_result, 'source', 'auto'));
  return true;
end $$;

revoke all on function public.record_company_vies_check_auto(uuid, text, text, text, date)
  from public, anon, authenticated;
grant execute on function public.record_company_vies_check_auto(uuid, text, text, text, date)
  to service_role;

drop function if exists public.company_vies_number(text, text);
