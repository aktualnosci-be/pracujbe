-- =============================================================================
-- 0139 — Stronicowanie eksportu decyzji DSA (#606)
-- =============================================================================
-- Problem: `dsa_statements_export(p_from, p_to)` zwracała WSZYSTKIE decyzje z okresu (do 1830
-- dni) w jednym wywołaniu — trasa `/api/admin/dsa-report` materializowała cały wynik w pamięci
-- procesu Next.js zanim zbudowała CSV/JSON.
--
-- Naprawa: kursor po (`decided_at`, `reference`) + `p_limit` (domyślnie 2000, twardy sufit
-- 5000). Stary dwuargumentowy podpis jest USUWANY (nie nadpisywany), żeby wywołania z dwoma
-- argumentami jednoznacznie trafiały w nową funkcję zamiast tworzyć przeciążenie.
-- Zachowanie bez kursora (pierwsza strona) i z limitem poniżej rozmiaru wyniku jest identyczne
-- jak wcześniej — istniejące wywołania testowe (`rls.sql`, dwa argumenty) nie wymagają zmian.
--
-- Rollback: `drop function public.dsa_statements_export(timestamptz, timestamptz, integer,
-- timestamptz, text);` i przywrócić poprzednią (dwuargumentową) definicję z migracji 0109.
-- =============================================================================

drop function if exists public.dsa_statements_export(timestamptz, timestamptz);

create or replace function public.dsa_statements_export(
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 2000,
  p_cursor_decided_at timestamptz default null,
  p_cursor_reference text default null
)
returns table (
  decision_reference text, decided_at timestamptz, decision text, content_type text,
  notice_category text, notice_received_at timestamptz, ground_type text, ground_reference text,
  automated_detection boolean, automated_decision boolean, from_appeal boolean,
  appeal_status text, restored boolean
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_limit integer;
begin
  if p_from is null or p_to is null or p_from >= p_to or p_to - p_from > interval '1830 days' then
    raise exception 'VALIDATION_FAILED: okres raportu' using errcode = '22023';
  end if;
  -- Bezpiecznik rozmiaru strony: brak/ujemna/zero → domyślne 2000, powyżej 5000 → obcięte.
  v_limit := coalesce(p_limit, 2000);
  if v_limit < 1 then v_limit := 2000; end if;
  if v_limit > 5000 then v_limit := 5000; end if;

  return query
    select d.reference, d.decided_at, d.decision,
           case d.decision when 'job_removed' then 'job' when 'company_suspended' then 'company'
                else r.target_type::text end,
           r.category, r.created_at, d.ground_type, d.ground_reference,
           d.automated_detection, d.automated_decision, d.appeal_id is not null,
           a.status, exists (select 1 from public.moderation_restorations mr where mr.decision_id = d.id)
      from public.moderation_decisions d
      join public.reports r on r.id = d.report_id
      left join public.moderation_appeals a on a.decision_id = d.id and a.appealed_restoration_id is null
     where d.decided_at >= p_from and d.decided_at < p_to
       and (p_cursor_decided_at is null
            or (d.decided_at, d.reference) > (p_cursor_decided_at, coalesce(p_cursor_reference, '')))
     order by d.decided_at, d.reference
     limit v_limit;
end $$;
revoke all on function public.dsa_statements_export(timestamptz, timestamptz, integer, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.dsa_statements_export(timestamptz, timestamptz, integer, timestamptz, text)
  to service_role;
