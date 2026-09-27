-- =============================================================================
-- 0450_retention_warning_due_sync.sql — numer tymczasowy (integrator nada ostateczny).
--
-- #862: `admin_set_retention_policy` zmieniała wyłącznie `retention_policies.period`, nie
-- dotykając już zapisanych `retention_warnings.due_at`. Wydłużenie okresu retencji PO
-- wysłaniu ostrzeżenia (inactive_candidate_cv / inactive_candidate_account) nie odraczało
-- więc terminu usunięcia — `run_retention_purge` nadal kasował plik/konto wg starego,
-- krótszego `due_at`, mimo że aktualna, zatwierdzona polityka daje na to więcej czasu.
--
-- Naprawa: przy każdej zmianie okresu (`p_days` niepusty) `due_at` istniejących ostrzeżeń
-- danej kategorii rośnie do co najmniej `activity_at + nowy_okres` — NIGDY nie jest
-- obniżany. Skrócenie okresu więc nie przyspiesza usunięcia ponad to, co już obiecano
-- w wysłanym ostrzeżeniu (e-mail z konkretną datą), a wydłużenie realnie odracza usunięcie.
-- Wyłączenie kategorii (`p_days is null`) nie zmienia `due_at` — i tak nie ma znaczenia,
-- `run_retention_purge` pomija usuwanie, gdy okres jest `null`.
-- =============================================================================

create or replace function public.admin_set_retention_policy(p_key text, p_days integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before interval;
  v_rescheduled integer := 0;
begin
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select period into v_before from public.retention_policies where key = p_key for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then
    raise exception 'VALIDATION_FAILED' using errcode = '22023';
  end if;
  -- Rejestr usunięć musi przeżyć najstarszą kopię (BACKUP_RETENTION ≤ 365 kopii dziennych).
  if p_key = 'erasure_tombstone' and p_days is not null and p_days < 400 then
    raise exception 'VALIDATION_FAILED: rejestr usunięć krótszy niż retencja kopii' using errcode = '22023';
  end if;
  update public.retention_policies
     set period = case when p_days is null then null else make_interval(days => p_days) end,
         updated_at = now(), updated_by = auth.uid()
   where key = p_key;

  -- #862: podnieś due_at już wysłanych ostrzeżeń tej kategorii do co najmniej
  -- activity_at + nowy_okres. `greatest()` nigdy nie obniża — skrócenie zostaje bez zmian.
  if p_days is not null then
    update public.retention_warnings w
       set due_at = greatest(w.due_at, w.activity_at + make_interval(days => p_days))
     where w.policy_key = p_key;
    get diagnostics v_rescheduled = row_count;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, before_data, after_data)
  values (auth.uid(), 'retention.policy_changed', 'retention_policy',
          jsonb_build_object('key', p_key, 'days', extract(day from v_before)),
          jsonb_build_object('key', p_key, 'days', p_days, 'warningsRescheduled', v_rescheduled));
end $$;
revoke all on function public.admin_set_retention_policy(text, integer) from public, anon;
grant execute on function public.admin_set_retention_policy(text, integer) to authenticated;
