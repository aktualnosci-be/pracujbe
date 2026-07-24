-- =============================================================================
-- 0054_document_acceptances.sql
-- Remediacja audytu 2026-07-24 (AUDIT_REPORT) — P1-16: akceptacja regulaminu i polityki
-- prywatności przy rejestracji nie miała trwałego, niezmiennego receiptu.
--
-- Problem: formularz rejestracji ma checkbox „akceptuję regulamin/politykę" (walidowany), ale
-- fakt akceptacji nie był nigdzie utrwalany — brak dowodu rozliczalności (RODO 7 / e-privacy).
--
-- Naprawa: osobna tabela niezmiennych receiptów akceptacji DOKUMENTÓW (terms/privacy), oddzielna
-- od `consents` (które modeluje kategorie cookies: necessary/preferences/analytics/marketing).
-- Zapis wyłącznie przez SECURITY DEFINER RPC wołane z zaufanej Server Action (admin client) po
-- utworzeniu konta — auth.uid() jest jeszcze null (konto czeka na potwierdzenie e-mail), więc
-- receipt jest kluczowany po zwróconym profile_id. Receipt snapshotuje AKTUALNĄ wersję dokumentu
-- (gdy opublikowana) + locale + IP + UA + znacznik czasu.
--
-- UWAGA: wiążącą TREŚĆ prawną dostarcza właściciel/prawnik (strony pozostają placeholder+noindex).
-- To wyłącznie warstwa techniczna receiptu — działa też gdy consent_versions nie ma jeszcze
-- wpisu (version_id/version = null, ale fakt+czas+IP/UA akceptacji jest utrwalony).
-- =============================================================================

create table if not exists public.document_acceptances (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  document           text not null check (document in ('terms', 'privacy')),
  consent_version_id uuid references public.consent_versions(id) on delete set null,
  document_version   text,
  locale             text check (locale in ('pl', 'nl', 'fr', 'en')),
  ip_address         inet,
  user_agent         text,
  accepted_at        timestamptz not null default now()
);

create index if not exists document_acceptances_profile_idx
  on public.document_acceptances (profile_id);

alter table public.document_acceptances enable row level security;
-- RPC-only zapis (niezmienny receipt); użytkownik widzi wyłącznie własne akceptacje.
revoke insert, update, delete on public.document_acceptances from anon, authenticated;
drop policy if exists document_acceptances_select_own on public.document_acceptances;
create policy document_acceptances_select_own on public.document_acceptances
  for select using (profile_id = auth.uid());

-- --- record_document_acceptance: niezmienny receipt akceptacji (service_role) ----------------
create or replace function public.record_document_acceptance(
  p_profile_id uuid,
  p_documents  text[],
  p_locale     text default null,
  p_ip         text default null,
  p_user_agent text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_ip inet; v_loc text; doc text; v_version_id uuid; v_version text;
  v_allowed text[] := array['terms', 'privacy'];
begin
  if p_profile_id is null then raise exception 'VALIDATION_FAILED' using errcode = '42501'; end if;

  v_loc := case when p_locale in ('pl', 'nl', 'fr', 'en') then p_locale else null end;
  begin
    v_ip := nullif(btrim(coalesce(p_ip, '')), '')::inet;
  exception when others then v_ip := null; end;

  foreach doc in array coalesce(p_documents, '{}'::text[]) loop
    if doc = any(v_allowed) then
      -- Aktualna wersja dokumentu (preferuj locale odbiorcy), gdy opublikowana.
      select id, version into v_version_id, v_version from public.consent_versions
        where document = doc and is_current = true
        order by (locale = v_loc) desc nulls last, published_at desc nulls last, created_at desc
        limit 1;
      insert into public.document_acceptances
        (profile_id, document, consent_version_id, document_version, locale, ip_address, user_agent)
      values
        (p_profile_id, doc, v_version_id, v_version, v_loc, v_ip,
         nullif(left(coalesce(p_user_agent, ''), 512), ''));
      v_version_id := null; v_version := null;
    end if;
  end loop;
end $$;
revoke all on function public.record_document_acceptance(uuid, text[], text, text, text) from public;
grant execute on function public.record_document_acceptance(uuid, text[], text, text, text) to service_role;
