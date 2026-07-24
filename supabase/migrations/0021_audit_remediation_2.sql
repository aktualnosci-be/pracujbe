-- =============================================================================
-- 0021_audit_remediation_2.sql
-- Remediacja audytu (część DB-couplowana):
--   P2#6 — atomowy claim outboxa (SKIP LOCKED + dzierżawa locked_at) — brak podwójnej
--          wysyłki przy równoległych workerach.
--   P2#10 — get_conversation_summaries(): ostatnia wiadomość + licznik nieprzeczytanych
--          per konwersacja PO STRONIE SQL (koniec pobierania WSZYSTKICH wiadomości do UI).
--   P3#12 — indeksy trigramowe pod filtr keyword (jobs.title / job_translations.title).
-- Wiring aplikacyjny (outbox.ts, data/messages.ts) w osobnym commicie.
-- =============================================================================

-- --- P3#12: indeksy trigramowe (ILIKE '%kw%' korzysta z GIN gin_trgm_ops) ------
create index if not exists idx_jobs_title_trgm
  on public.jobs using gin (title gin_trgm_ops);
create index if not exists idx_job_translations_title_trgm
  on public.job_translations using gin (title gin_trgm_ops);

-- --- P2#6: atomowy claim paczki e-maili do wysłania ---------------------------
-- Dzierżawa przez locked_at (bez nowego statusu w enumie). Dwa równoległe workery
-- NIE złapią tego samego wiersza (FOR UPDATE SKIP LOCKED). Ponowny claim możliwy po
-- wygaśnięciu dzierżawy (stale locked_at), gdy worker padł nie zwolniwszy wiersza.
create or replace function public.claim_email_batch(
  p_limit integer default 20,
  p_lease_seconds integer default 300
) returns setof public.email_deliveries language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.email_deliveries d
    set locked_at = now(), updated_at = now()
    where d.id in (
      select e.id from public.email_deliveries e
      where e.status = 'queued'
        and e.next_attempt_at <= now()
        and (e.locked_at is null or e.locked_at < now() - make_interval(secs => p_lease_seconds))
      order by e.queued_at asc
      for update skip locked
      limit greatest(p_limit, 0)
    )
    returning d.*;
end $$;
revoke all on function public.claim_email_batch(integer, integer) from public;
-- Tylko zaufany serwer (service_role omija RLS). Brak grantu dla anon/authenticated.

-- --- P2#10: podsumowania konwersacji (ostatnia wiadomość + nieprzeczytane) -----
create or replace function public.get_conversation_summaries()
returns table (
  conversation_id uuid,
  subject text,
  job_id uuid,
  offer_id uuid,
  application_id uuid,
  counterparty_name text,
  last_body text,
  last_at timestamptz,
  last_sender uuid,
  unread_count bigint
) language sql stable security definer set search_path = public as $$
  with my as (
    select cm.conversation_id, cm.last_read_at
    from public.conversation_members cm
    where cm.profile_id = auth.uid()
  )
  select
    c.id, c.subject, c.job_id, c.offer_id, c.application_id,
    cp.name,
    lm.body, lm.created_at, lm.sender_id,
    coalesce((
      select count(*) from public.messages m2
      where m2.conversation_id = c.id and m2.deleted_at is null
        and m2.sender_id <> auth.uid()
        and (my.last_read_at is null or m2.created_at > my.last_read_at)
    ), 0)
  from my
  join public.conversations c on c.id = my.conversation_id and c.deleted_at is null
  left join lateral (
    select m.body, m.created_at, m.sender_id
    from public.messages m
    where m.conversation_id = c.id and m.deleted_at is null
    order by m.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as name
    from public.conversation_members cm2
    join public.profiles p on p.id = cm2.profile_id
    where cm2.conversation_id = c.id and cm2.profile_id <> auth.uid()
    order by cm2.created_at asc
    limit 1
  ) cp on true
  order by c.last_message_at desc nulls last;
$$;
revoke all on function public.get_conversation_summaries() from public;
grant execute on function public.get_conversation_summaries() to authenticated;
