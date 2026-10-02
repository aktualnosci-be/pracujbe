-- =============================================================================
-- 0218 (numer tymczasowy — ostateczny nada integrator) — eksport danych kandydata (#1091).
--
-- `export_my_data` pomijał dwie grupy danych osoby z kontem kandydata:
--   - `contentReports` — zgłoszenia treści złożone przez tę osobę (`reports.reporter_id`):
--     numer sprawy, rodzaj, typ celu, kategoria/powód, opis, adres treści, imię i e-mail
--     podane w formularzu, stan i daty. BEZ `target_id`, `target_snapshot` (zgłoszona treść,
--     dane osób trzecich), `conversation_id` i skrótu kodu dostępu. Ten sam kształt co
--     `contentReports` w eksporcie pracodawcy;
--   - `retentionWarnings` — ostrzeżenia przed usunięciem z powodu braku aktywności wysłane do
--     tej osoby (`retention_warnings`): kategoria, aktywność, której dotyczą, data ostrzeżenia
--     i termin usunięcia.
-- Historia widoczności profilu dla firm — poza zakresem (funkcja wyłączona w trybie
-- ogłoszeniowym, #1128).
--
-- Jak w 0126/0196: dotychczasowa funkcja staje się wewnętrzną częścią (bez EXECUTE dla ról
-- klienta), nowa dopisuje klucze. Uprawnienia, limit 10 eksportów na dobę, ślad wniosku
-- i audyt bez zmian (robi je funkcja wewnętrzna).
--
-- Rollback: supabase/rollback/0218_candidate_export_reports_warnings.down.sql.
-- =============================================================================

do $mig$
begin
  if to_regprocedure('public.export_my_data()') is null
     or to_regprocedure('public.export_my_data_pre_reports()') is not null then
    return;
  end if;
  alter function public.export_my_data() rename to export_my_data_pre_reports;
  revoke all on function public.export_my_data_pre_reports() from public, anon, authenticated;
end
$mig$;

create or replace function public.export_my_data()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_out jsonb;
begin
  v_out := public.export_my_data_pre_reports();
  return v_out || jsonb_build_object(
    'contentReports',
    (select coalesce(jsonb_agg(jsonb_build_object(
              'caseNumber', rp.case_number, 'kind', rp.kind, 'targetType', rp.target_type,
              'category', rp.category, 'reason', rp.reason, 'details', rp.details,
              'contentUrl', rp.content_url, 'reporterName', rp.reporter_name,
              'reporterEmail', rp.reporter_email, 'status', rp.status,
              'createdAt', rp.created_at, 'resolvedAt', rp.resolved_at)
              order by rp.created_at, rp.id), '[]'::jsonb)
       from public.reports rp where rp.reporter_id = auth.uid()),
    'retentionWarnings',
    (select coalesce(jsonb_agg(jsonb_build_object(
              'policyKey', w.policy_key, 'activityAt', w.activity_at,
              'warnedAt', w.warned_at, 'dueAt', w.due_at)
              order by w.warned_at, w.policy_key, w.activity_at), '[]'::jsonb)
       from public.retention_warnings w where w.profile_id = auth.uid()));
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
