-- =============================================================================
-- 0129 — worker poczty: CAS na dzierżawie wiersza kolejki (#615, utwardzenie).
--
-- Problem: `email_delivery_send_check(id)` i późniejsze aktualizacje workera
-- (mark-sent / mark-failed / defer, `src/lib/email/outbox.ts`) filtrowały tylko po
-- `id`, bez sprawdzenia, czy WOŁAJĄCY worker nadal posiada aktualną dzierżawę
-- (`locked_at`). Po wygaśnięciu dzierżawy (worker wolny/zawieszony) inny worker mógł
-- przejąć wiersz przez `claim_email_batch`, a poprzedni — nadal wierząc, że go
-- posiada — kontynuować: pobrać budżet, wysłać i nadpisać stan wiersza już
-- należącego do nowego workera (podwójna wysyłka, wyścig aktualizacji statusu).
--
-- Naprawa: `email_deliveries.lock_token` — losowy token nadawany PRZY KAŻDYM
-- (ponownym) claimie. Worker dostaje go w wierszu z `claim_email_batch` i musi go
-- podać w `email_delivery_send_check` oraz w każdej późniejszej aktualizacji tego
-- wiersza (mark-sent/mark-failed/defer w outbox.ts, warunek `AND lock_token = $n`).
-- Token się zmienia przy każdym (re)claimie — worker z NIEAKTUALNYM tokenem (bo jego
-- dzierżawa wygasła i wiersz przejął ktoś inny) dostaje `lease_lost` i NIC nie
-- zapisuje (nie wygasza wiersza — należy już do innego workera).
--
-- Rollback: przywrócić `claim_email_batch`/`email_delivery_send_check` z 0124
-- (bez parametru tokenu); `alter table email_deliveries drop column lock_token`.
-- =============================================================================

alter table public.email_deliveries
  add column if not exists lock_token uuid;

-- --- claim_email_batch — jak 0124, ale nadaje NOWY lock_token przy każdym claimie ---------
create or replace function public.claim_email_batch(
  p_limit integer default 20,
  p_lease_seconds integer default 300
) returns setof public.email_deliveries language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with picked as (
    select e.id,
           public.email_delivery_suppression_reason(
             e.profile_id, e.template, e.to_email::text, e.campaign_id,
             e.entity_type, e.entity_id) as reason
      from public.email_deliveries e
     where e.status = 'queued'
       and e.next_attempt_at <= now()
       and (e.locked_at is null or e.locked_at < now() - make_interval(secs => p_lease_seconds))
     order by e.queued_at asc
     for update skip locked
     limit greatest(p_limit, 0)
  ), suppressed as (
    update public.email_deliveries d
       set status = 'failed', suppressed_at = now(), error_message = p.reason,
           locked_at = null, lock_token = null, updated_at = now()
      from picked p
     where d.id = p.id and p.reason is not null
    returning d.id
  )
  update public.email_deliveries d
     set locked_at = now(), lock_token = gen_random_uuid(), updated_at = now()
    from picked p
   where d.id = p.id and p.reason is null
  returning d.*;
end $$;
revoke all on function public.claim_email_batch(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_email_batch(integer, integer) to service_role;

-- --- email_delivery_send_check — wymaga aktualnego tokenu dzierżawy -----------------------
-- Zwraca: null (wysyłaj), 'lease_lost' (token nie pasuje — wiersz ma już innego właściciela,
-- NIE dotykamy go), 'not_queued' (wiersz nie istnieje / nie jest już w kolejce), albo
-- przyczynę wygaszenia (jak w 0124) — w tym ostatnim przypadku wiersz jest wygaszany
-- (status='failed'), bo wywołujący nadal posiada aktualną dzierżawę.
-- Sygnatura się zmienia (nowy parametr) — `create or replace` NIE zastąpiłby starej wersji
-- (inny zestaw argumentów = inne przeciążenie), więc najpierw jawnie usuwamy starą.
drop function if exists public.email_delivery_send_check(uuid);

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
  end if;
  return v_reason;
end $$;
revoke all on function public.email_delivery_send_check(uuid, uuid) from public, anon, authenticated;
grant execute on function public.email_delivery_send_check(uuid, uuid) to service_role;
