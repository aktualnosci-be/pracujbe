-- =============================================================================
-- 0130 — worker poczty: odnowienie dzierżawy w oknie wysyłki (#621, dokończenie #615/0129).
--
-- Problem: 0129 dodało CAS na `lock_token` (claim/send_check/mark-sent/mark-failed/defer), ale
-- `email_delivery_send_check` kończyło transakcję PRZED wywołaniem dostawcy (`transport.send`
-- w `src/lib/email/outbox.ts`) bez odnowienia dzierżawy (`locked_at`). Dzierżawa nadal biegła od
-- CZASU CLAIMU całej paczki — przy wielu wierszach w paczce (przetwarzanych po kolei) albo
-- wolnym poprzednim wierszu okno do wygaśnięcia dzierżawy TEGO wiersza mogło być już prawie
-- zużyte w chwili wywołania `send_check`/`transport.send`. Worker A mógł dostać `null` (wolno
-- wysyłać) tuż przed wygaśnięciem dzierżawy, zacząć wołać dostawcę, a w międzyczasie
-- `claim_email_batch` uznać dzierżawę za wygasłą i oddać wiersz workerowi B — obaj wysyłają.
-- CAS na `mark-sent` (0129) wykrywał to dopiero PO wysyłce (i tylko chronił zapis stanu, nie
-- cofał już wysłanej wiadomości A) — dokładnie luka opisana w #621.
--
-- Naprawa: `email_delivery_send_check` — gdy token się zgadza i wiersz NIE jest wygaszany
-- (żaden powód suppresji), odnawia dzierżawę: `locked_at = now()` w TEJ SAMEJ transakcji, CAS
-- po `lock_token` (token się nie zmienia — to nadal ten sam worker/dzierżawa, tylko świeże
-- okno). Worker wywołuje `transport.send` z PEŁNYM, świeżym oknem dzierżawy (`p_lease_seconds`
-- z ostatniego claimu, domyślnie 300 s) liczonym od chwili TUŻ PRZED wywołaniem dostawcy —
-- zamyka lukę TOCTOU między kontrolą a wysyłką (kierunek z #621: „odświeżać dzierżawę przez
-- całe żądanie”). Awaria procesu/timeout dłuższy niż odnowione okno nadal prowadzi do
-- bezpiecznego ponowienia: `claim_email_batch` odda wiersz kolejnemu workerowi dopiero po
-- upływie ŚWIEŻEGO okna, a `mark-sent`/`mark-failed` workera A z NIEAKTUALNYM tokenem (bo
-- wiersz przejął B) i tak nic nie nadpiszą (CAS z 0129, bez zmian).
-- Zawieszony dostawca (#628) — po stronie workera: termin wysyłki krótszy niż dzierżawa,
-- ponowienie niejednoznacznego wyniku dopiero po pełnej dzierżawie, ten sam klucz
-- idempotencji (`src/lib/email/outbox.ts`, `SEND_DEADLINE_MS`).
--
-- Rollback: przywrócić `email_delivery_send_check` z 0129 (bez odnowienia `locked_at`).
-- =============================================================================

create or replace function public.email_delivery_send_check(p_delivery_id uuid, p_lock_token uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.email_deliveries%rowtype;
  v_reason text;
begin
  select * into v_row from public.email_deliveries d where d.id = p_delivery_id for update;
  if v_row.id is null or v_row.status <> 'queued' then return 'not_queued'; end if;
  if v_row.lock_token is distinct from p_lock_token then return 'lease_lost'; end if;

  v_reason := public.email_delivery_suppression_reason(
    v_row.profile_id, v_row.template, v_row.to_email::text, v_row.campaign_id,
    v_row.entity_type, v_row.entity_id);
  if v_reason is not null then
    update public.email_deliveries
       set status = 'failed', suppressed_at = now(), error_message = v_reason,
           locked_at = null, lock_token = null, updated_at = now()
     where id = v_row.id and lock_token = p_lock_token;
  else
    -- #621: odnowienie dzierżawy TUŻ PRZED wywołaniem dostawcy — pełne, świeże okno
    -- (`locked_at = now()`) na czas żądania HTTP, niezależnie od tego, ile z pierwotnej
    -- dzierżawy claimu już upłynęło. Token bez zmian (ten sam właściciel).
    update public.email_deliveries
       set locked_at = now(), updated_at = now()
     where id = v_row.id and lock_token = p_lock_token;
  end if;
  return v_reason;
end $$;
revoke all on function public.email_delivery_send_check(uuid, uuid) from public, anon, authenticated;
grant execute on function public.email_delivery_send_check(uuid, uuid) to service_role;
