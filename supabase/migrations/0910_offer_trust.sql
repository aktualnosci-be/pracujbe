-- =============================================================================
-- 0910_offer_trust.sql — zaufanie ofert: sygnały oszustwa w treści oferty przed publikacją
-- oraz oznaczenie agencji pracy tymczasowej (numer tymczasowy; ostateczny nada integrator).
--
-- A. Sygnały oszustwa (wzór: kontrola pytań screeningowych #497, 0103/0154)
--
-- 1. `job_fraud_patterns()` — deterministyczne wzorce PL/NL/FR/EN (bez modelu językowego)
--    w czterech kategoriach: `candidate_fee` (opłata od kandydata za pracę, szkolenie,
--    dokumenty, zakwaterowanie z góry), `off_platform_contact` (przeniesienie kontaktu do
--    komunikatora), `crypto_tasks` (kryptowaluty, „zadania online”), `payment_request`
--    (przelew, dane karty, przekaz pieniężny). Tekst składa `screening_fold` (0103). Lustro
--    w `src/lib/job-trust/fraud-risk.ts`; test `job-fraud-risk.test.ts` porównuje wzorce 1:1.
--    Trafienie NIE jest oceną: kieruje treść do przeglądu przez człowieka.
-- 2. `job_trust_content(job)` — kanoniczna migawka treści oferty (tytuł, godziny, zmiany,
--    wszystkie tłumaczenia z opisem/listami/opisem firmy, wszystkie wymagania). Odcisk treści =
--    md5 migawki. `job_fraud_risk(jsonb)` = kategorie reguł dla migawki.
-- 3. `job_content_reviews` — przegląd treści oferty, jeden wiersz na (oferta, odcisk):
--    pending → approved/rejected. Źródła sygnału: reguły (`rule_categories`) i — za flagą
--    w aplikacji — model AI (`ai_categories`, `ai_reason`, `ai_confidence`; zapis
--    `record_job_content_ai_signal`, tylko service_role). Wiersz powstaje przy ZAPISIE treści:
--    odroczone triggery (constraint trigger, koniec transakcji) na jobs/job_translations/
--    job_requirements liczą migawkę po całym kroku kreatora (`save_job_draft`) albo rewizji
--    (`update_published_job`). Zgłoszenie nie ginie razem z odrzuconą publikacją.
--    Odczyt: członek firmy oferty (RLS) i admin (service role). Bez DML dla klientów.
-- 4. Aktywna oferta, której nowa treść ma sygnał bez akceptacji, jest WSTRZYMYWANA (paused)
--    w tym samym odroczonym triggerze — ukryta publicznie do decyzji admina (audyt
--    `job.paused_for_content_review`). Zgłoszenia kandydatów zostają.
-- 5. Strażnik `enforce_job_content_review` (BEFORE UPDATE OF status na jobs): oferta nie staje
--    się aktywna (publikacja, wznowienie, ponowne otwarcie, każda ścieżka), dopóki treść
--    z sygnałem (reguła albo zapisany sygnał AI) nie ma decyzji `approved` dla bieżącego
--    odcisku. Błędy: `JOB_CONTENT_REJECTED` / `JOB_CONTENT_REVIEW_REQUIRED`.
-- 6. `admin_decide_job_content_review(id, decyzja, uzasadnienie)` — tylko admin, tylko pending
--    i tylko treść bieżąca (inaczej STALE_STATE), odrzucenie wymaga uzasadnienia (≤ 1000),
--    audyt `job_content.reviewed`, powiadomienie in-app zgłaszającego (`system`,
--    `data.kind='job_content_review'`). Akceptacja niczego nie publikuje ani nie wznawia.
-- 7. `job_trust_state(job)` — stan dla kreatora (członek firmy/admin): odcisk, kategorie
--    reguł, status przeglądu, uzasadnienie. Migawkę treści dla analizy AI czyta ta sama funkcja.
-- 8. Backfill: istniejące oferty z sygnałem reguł trafiają do kolejki (bez wstrzymania
--    aktywnych); wznowienie/ponowne otwarcie wymaga decyzji.
--
-- B. Agencje pracy tymczasowej (decyzja właściciela 28.09.2026: agencje dopuszczone z oznaczeniem)
--
-- 9. `companies.is_agency`, `agency_recognition_number` (numer uznania regionalnego, tekst
--    ≤ 64), wynik ręcznego sprawdzenia przez admina `agency_check_status` (unchecked /
--    confirmed / not_confirmed) + kto/kiedy/notatka. Strażnik `guard_company_agency`: klient
--    nie zmienia tych kolumn bezpośrednio; pisze `set_company_agency` (owner/admin firmy —
--    zmiana deklaracji zeruje sprawdzenie) i `admin_record_agency_check` (admin, CAS po numerze).
-- 10. Publicznie tylko flaga „agencja” (`get_public_jobs_agency`, lista id ofert publicznych)
--    i filtr „bezpośrednio od pracodawcy” — `p_direct_only` w `get_public_jobs`, `_count`,
--    `get_public_job_filter_facets` (+ facet `additional/direct`) i w kopii filtrów
--    `saved_search_jobs_after` (test synchronizacji 0158). Zapisane wyszukiwania filtra nie
--    przechowują (etap 2) — `saved_search_keyset_page` bez zmian podaje domyślne NULL.
--    Treść funkcji list = stan z 0153/0158 + jeden warunek; granty jak dotąd.
--
-- A9. Budżet AI (#36): nowa funkcja `job_fraud_check` w CHECK-u `ai_usage_ledger` i w allow-liście
--    `ai_budget_reserve` (treść funkcji = 0120 poza listą; lista = AI_FEATURE_IDS).
--
-- Dowód: supabase/tests/rls.sql sekcja FT910 (kontrole ujemne).
--
-- Rollback (ręczny, nowa migracja): odtworzyć get_public_jobs/_count/facety z 0153 i
-- saved_search_jobs_after z 0158 (drop nowych sygnatur); drop triggerów
-- trg_job_trust_sync_jobs/_translations/_requirements, trg_enforce_job_content_review,
-- trg_guard_company_agency i ich funkcji; drop function admin_decide_job_content_review,
-- record_job_content_ai_signal, job_trust_state, job_trust_sync, job_fraud_risk,
-- job_trust_content, job_fraud_patterns, set_company_agency, admin_record_agency_check,
-- get_public_jobs_agency; drop table job_content_reviews; alter table companies drop column
-- is_agency, agency_recognition_number, agency_check_status, agency_checked_at,
-- agency_checked_by, agency_check_note.
-- =============================================================================

-- --- A1. Wzorce ------------------------------------------------------------------------------
create or replace function public.job_fraud_patterns()
returns table (category text, pattern text)
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select v.category, v.pattern from (values
    -- fraud-patterns:begin
    ('candidate_fee', ' oplat[a-z]* za (rekrutacj|prace|szkoleni|kurs|dokument|wiz|rejestracj|zatrudnieni|posrednictw|aplikacj)'),
    ('candidate_fee', ' (oplat[a-z]*|koszt[a-z]*) (rekrutacyjn|rejestracyjn|wpisow|administracyjn|manipulacyjn)'),
    ('candidate_fee', ' wpisowe '),
    ('candidate_fee', ' (wplac|wplat|zaplac|uiszcz)[a-z]* [a-z0-9 ]{0,30}(zaliczk|kaucj|oplat|wpisow)'),
    ('candidate_fee', ' kaucj[a-z]* (za|na) (mieszkani|zakwaterowani|pokoj|lozko|prac|miejsce)'),
    ('candidate_fee', ' (platne|platna|platny|oplata|wplata|zaplata) z gory '),
    ('candidate_fee', ' (recruitment|registration|placement|processing|application|administration|admin|training|visa|agency|booking|reservation) fees? '),
    ('candidate_fee', ' (pay|paying|payment of) (a |an |the )?(small )?(fee|deposit|registration) '),
    ('candidate_fee', ' upfront (payment|fee|deposit|cost) '),
    ('candidate_fee', ' (deposit|advance payment) (for|to secure) (the |your )?(accommodation|housing|room|job|position|place|visa) '),
    ('candidate_fee', ' pay (in advance|upfront|before (you )?start)'),
    ('candidate_fee', ' (inschrijvings|bemiddelings|registratie|opleidings|dossier|administratie|aanvraag)(kosten|geld) '),
    ('candidate_fee', ' waarborg (voor|van) (de |het |je |jouw )?(kamer|woning|huisvesting|verblijf|job|plaats|werk) '),
    ('candidate_fee', ' (vooraf|op voorhand|vooruit) (te )?betal'),
    ('candidate_fee', ' voorschot (betalen|storten|overmaken) '),
    ('candidate_fee', ' frais (d inscription|de dossier|de recrutement|de formation|de placement|d agence|de traitement|administratifs) '),
    ('candidate_fee', ' (caution|depot de garantie) (pour|de|du) (le |la |l |votre )?(logement|chambre|hebergement|poste|emploi|travail) '),
    ('candidate_fee', ' (payer|paiement|verser|regler) (d avance|a l avance|en avance|au prealable|avant de commencer) '),
    ('candidate_fee', ' (verser|payer) (un |une )?(acompte|avance|caution) '),
    ('off_platform_contact', ' whats ?app '),
    ('off_platform_contact', ' telegram '),
    ('off_platform_contact', ' viber '),
    ('off_platform_contact', ' wechat '),
    ('off_platform_contact', ' signal (app|messenger) '),
    ('off_platform_contact', ' wa me '),
    ('off_platform_contact', ' t me '),
    ('crypto_tasks', ' (kryptowalut[a-z]*|krypto|crypto|cryptos|cryptocurrenc[a-z]*|cryptomonnaies?|cryptomunt(en)?|cryptovaluta|bitcoins?|btc|usdt|tether|ethereum|binance) '),
    ('crypto_tasks', ' zadani[a-z]* (online|w internecie|przez internet) '),
    ('crypto_tasks', ' (online|internet) (tasks?|opdrachten|taken) '),
    ('crypto_tasks', ' (taches|missions) en ligne '),
    ('crypto_tasks', ' (like|likes|liking|liken|polubieni[a-z]*|lajkowani[a-z]*) (filmow|filmikow|videos?|posts?|produkt[a-z]*|products?) '),
    ('crypto_tasks', ' (optymalizacj[a-z]*|optimi[sz]ation|optimalisatie) (produkt[a-z]*|products?|app|apps|aplikacj[a-z]*|applications?) '),
    ('payment_request', ' western union '),
    ('payment_request', ' moneygram '),
    ('payment_request', ' paysafe ?card '),
    ('payment_request', ' (gift|prepaid|steam|itunes|google play) cards? '),
    ('payment_request', ' kart[a-z]* (podarunkow|przedplacon)'),
    ('payment_request', ' cartes? (cadeau|prepayee)'),
    ('payment_request', ' (cadeaukaart|prepaidkaart)'),
    ('payment_request', ' (numer|numeru|dane|danych) (twojej |swojej )?karty '),
    ('payment_request', ' (card|credit card|debit card|bank card) (number|details|data) '),
    ('payment_request', ' (cvv|cvc|cvv2) '),
    ('payment_request', ' (kaartnummer|kaartgegevens|bankkaartgegevens) '),
    ('payment_request', ' (numero|coordonnees|donnees) (de )?(votre )?carte (bancaire|de credit)'),
    ('payment_request', ' (przelej|przelac|wyslij|wyslac|wykonaj|wykonac|zrob|zrobic) [a-z0-9 ]{0,20}(przelew|pieniadz|kwot|blik)'),
    ('payment_request', ' (kod|kodu|kodem) blik '),
    ('payment_request', ' (send|wire|transfer) (us |me )?(the |a |your )?(money|payment|funds|amount|fee) '),
    ('payment_request', ' (geld|bedrag) (overmaken|overschrijven|storten|sturen) '),
    ('payment_request', ' (envoyer|effectuer|faire) (un |le )?(virement|paiement|transfert) '),
    ('payment_request', ' mandat cash '),
    ('payment_request', ' (dane logowania|login|haslo|password|wachtwoord|mot de passe) [a-z0-9 ]{0,20}(bank|banque)')
    -- fraud-patterns:end
  ) as v(category, pattern);
$$;
revoke all on function public.job_fraud_patterns() from public, anon, authenticated;

-- --- A2. Migawka treści i kategorie ----------------------------------------------------------
create or replace function public.job_trust_content(p_job_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'title', coalesce(j.title, ''),
    'working_hours', coalesce(j.working_hours, ''),
    'shifts', coalesce(j.shifts, ''),
    'translations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'locale', t.locale, 'title', coalesce(t.title, ''),
               'description', coalesce(t.description, ''),
               'responsibilities', to_jsonb(coalesce(t.responsibilities, '{}'::text[])),
               'conditions', to_jsonb(coalesce(t.conditions, '{}'::text[])),
               'benefits', to_jsonb(coalesce(t.benefits, '{}'::text[])),
               'working_hours', coalesce(t.working_hours, ''),
               'shifts', coalesce(t.shifts, ''),
               'company_description', coalesce(t.company_description, ''))
             order by t.locale)
        from public.job_translations t where t.job_id = j.id), '[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object('locale', r.locale, 'kind', r.kind::text, 'content', r.content)
             order by r.locale, r.kind::text, r.position, r.content)
        from public.job_requirements r where r.job_id = j.id), '[]'::jsonb))
  from public.jobs j where j.id = p_job_id;
$$;
revoke all on function public.job_trust_content(uuid) from public, anon, authenticated;
-- Panel admina (odczyt service-rolem po requireAdmin): czy przegląd dotyczy bieżącej treści.
grant execute on function public.job_trust_content(uuid) to service_role;

create or replace function public.job_fraud_risk(p_content jsonb)
returns text[] language sql immutable parallel safe set search_path = public, pg_temp as $$
  with txt as (
    select coalesce(string_agg(public.screening_fold(v #>> '{}'), ''), '') as t
      from jsonb_path_query(coalesce(p_content, '{}'::jsonb), 'strict $.**') v
     where jsonb_typeof(v) = 'string'
  )
  select coalesce(array_agg(distinct p.category order by p.category), '{}'::text[])
    from public.job_fraud_patterns() p, txt
   where txt.t ~ p.pattern;
$$;
revoke all on function public.job_fraud_risk(jsonb) from public, anon, authenticated;

-- --- A3. Kolejka przeglądu -------------------------------------------------------------------
create table if not exists public.job_content_reviews (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs(id) on delete cascade,
  content_fingerprint text not null,
  rule_categories     text[] not null default '{}'::text[],
  ai_categories       text[] not null default '{}'::text[],
  ai_reason           text,
  ai_confidence       numeric(3,2),
  content             jsonb not null,
  status              text not null default 'pending',
  requested_by        uuid references public.profiles(id) on delete set null,
  requested_at        timestamptz not null default now(),
  decided_by          uuid references public.profiles(id) on delete set null,
  decided_at          timestamptz,
  decision_reason     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (job_id, content_fingerprint),
  constraint job_content_reviews_status check (status in ('pending', 'approved', 'rejected')),
  constraint job_content_reviews_signal check (cardinality(rule_categories) + cardinality(ai_categories) > 0),
  constraint job_content_reviews_categories check (
    rule_categories <@ array['candidate_fee', 'off_platform_contact', 'crypto_tasks', 'payment_request']::text[]
    and ai_categories <@ array['candidate_fee', 'off_platform_contact', 'crypto_tasks', 'payment_request',
                               'personal_data_request', 'unrealistic_offer', 'other']::text[]),
  constraint job_content_reviews_ai check (
    (ai_reason is null or char_length(ai_reason) <= 500)
    and (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1))),
  constraint job_content_reviews_decision check (
    (status in ('approved', 'rejected')) = (decided_at is not null)
    and (status <> 'rejected' or char_length(btrim(coalesce(decision_reason, ''))) between 1 and 1000)
    and (decision_reason is null or char_length(decision_reason) <= 1000))
);
create index if not exists idx_job_content_reviews_queue
  on public.job_content_reviews (status, created_at desc, id desc);
drop trigger if exists trg_set_updated_at on public.job_content_reviews;
create trigger trg_set_updated_at before update on public.job_content_reviews
  for each row execute function public.set_updated_at();

alter table public.job_content_reviews enable row level security;
alter table public.job_content_reviews force row level security;
revoke all on public.job_content_reviews from public, anon, authenticated;
grant select on public.job_content_reviews to authenticated;
drop policy if exists job_content_reviews_select on public.job_content_reviews;
create policy job_content_reviews_select on public.job_content_reviews
  for select to authenticated
  using (public.is_job_company_member(job_id));

-- --- A3/A4. Synchronizacja kolejki po zapisie treści (koniec transakcji) ----------------------
create or replace function public.job_trust_sync(p_job_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text; v_content jsonb; v_fp text; v_cats text[]; v_id uuid; v_review text;
begin
  select j.status::text into v_status from public.jobs j
   where j.id = p_job_id and j.deleted_at is null;
  if v_status is null then return; end if;
  v_content := public.job_trust_content(p_job_id);
  v_fp := md5(v_content::text);
  v_cats := public.job_fraud_risk(v_content);
  if cardinality(v_cats) > 0 then
    insert into public.job_content_reviews (job_id, content_fingerprint, rule_categories, content, requested_by)
      values (p_job_id, v_fp, v_cats, v_content, auth.uid())
      on conflict (job_id, content_fingerprint) do nothing
      returning id into v_id;
    if v_id is not null then
      perform public.write_audit('job_content.review_requested', 'job_content_review', v_id, null,
        jsonb_build_object('status', 'pending', 'job_id', p_job_id, 'source', 'rules',
                           'categories', to_jsonb(v_cats)));
    end if;
  end if;
  select r.status into v_review from public.job_content_reviews r
   where r.job_id = p_job_id and r.content_fingerprint = v_fp;
  -- Aktywna oferta z niezatwierdzonym sygnałem dla BIEŻĄCEJ treści → wstrzymana do decyzji.
  if v_status = 'active' and v_review is not null and v_review <> 'approved' then
    update public.jobs set status = 'paused' where id = p_job_id and status = 'active';
    perform public.write_audit('job.paused_for_content_review', 'job', p_job_id,
      jsonb_build_object('status', 'active'), jsonb_build_object('status', 'paused'));
  end if;
end $$;
revoke all on function public.job_trust_sync(uuid) from public, anon, authenticated;

create or replace function public.job_trust_after_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'jobs' then
    perform public.job_trust_sync(new.id);
  else
    perform public.job_trust_sync(new.job_id);
  end if;
  return null;
end $$;
revoke all on function public.job_trust_after_change() from public, anon, authenticated;

drop trigger if exists trg_job_trust_sync_jobs on public.jobs;
create constraint trigger trg_job_trust_sync_jobs
  after insert or update of title, working_hours, shifts on public.jobs
  deferrable initially deferred
  for each row execute function public.job_trust_after_change();
drop trigger if exists trg_job_trust_sync_translations on public.job_translations;
create constraint trigger trg_job_trust_sync_translations
  after insert or update on public.job_translations
  deferrable initially deferred
  for each row execute function public.job_trust_after_change();
drop trigger if exists trg_job_trust_sync_requirements on public.job_requirements;
create constraint trigger trg_job_trust_sync_requirements
  after insert or update on public.job_requirements
  deferrable initially deferred
  for each row execute function public.job_trust_after_change();

-- --- A5. Strażnik aktywacji ------------------------------------------------------------------
create or replace function public.enforce_job_content_review()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_content jsonb; v_fp text; v_review text;
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    v_content := public.job_trust_content(new.id);
    v_fp := md5(v_content::text);
    select r.status into v_review from public.job_content_reviews r
     where r.job_id = new.id and r.content_fingerprint = v_fp;
    if v_review = 'approved' then return new; end if;
    if v_review = 'rejected' then
      raise exception 'JOB_CONTENT_REJECTED' using errcode = '42501';
    end if;
    if v_review = 'pending' or cardinality(public.job_fraud_risk(v_content)) > 0 then
      raise exception 'JOB_CONTENT_REVIEW_REQUIRED' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_job_content_review() from public, anon, authenticated;
drop trigger if exists trg_enforce_job_content_review on public.jobs;
create trigger trg_enforce_job_content_review
  before update of status on public.jobs
  for each row execute function public.enforce_job_content_review();

-- --- A7. Stan dla kreatora ---------------------------------------------------------------------
create or replace function public.job_trust_state(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_content jsonb; v_fp text; v_row public.job_content_reviews;
begin
  if not (public.is_job_company_member(p_job_id) or public.is_admin()) then return null; end if;
  v_content := public.job_trust_content(p_job_id);
  if v_content is null then return null; end if;
  v_fp := md5(v_content::text);
  select * into v_row from public.job_content_reviews
   where job_id = p_job_id and content_fingerprint = v_fp;
  return jsonb_build_object(
    'fingerprint', v_fp,
    'content', v_content,
    'rule_categories', to_jsonb(public.job_fraud_risk(v_content)),
    'ai_categories', to_jsonb(coalesce(v_row.ai_categories, '{}'::text[])),
    'status', v_row.status,
    'decision_reason', case when v_row.status = 'rejected' then v_row.decision_reason end);
end $$;
revoke all on function public.job_trust_state(uuid) from public, anon;
grant execute on function public.job_trust_state(uuid) to authenticated, service_role;

-- --- Sygnał AI (drugi sygnał obok reguł; wyłącznie serwer) -------------------------------------
-- Zwraca: 'stale' (treść zmieniła się od analizy), 'not_found', albo status przeglądu.
create or replace function public.record_job_content_ai_signal(
  p_job_id uuid, p_fingerprint text, p_categories text[], p_reason text,
  p_confidence numeric, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status text; v_content jsonb; v_fp text; v_id uuid; v_review text;
  v_cats text[] := coalesce(p_categories, '{}'::text[]);
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if cardinality(v_cats) = 0 then raise exception 'VALIDATION_FAILED: brak kategorii' using errcode = '22023'; end if;
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'VALIDATION_FAILED: pewność' using errcode = '22023';
  end if;
  select j.status::text into v_status from public.jobs j
   where j.id = p_job_id and j.deleted_at is null for update;
  if v_status is null then return 'not_found'; end if;
  v_content := public.job_trust_content(p_job_id);
  v_fp := md5(v_content::text);
  if p_fingerprint is distinct from v_fp then return 'stale'; end if;

  insert into public.job_content_reviews
      (job_id, content_fingerprint, rule_categories, ai_categories, ai_reason, ai_confidence, content, requested_by)
    values (p_job_id, v_fp, public.job_fraud_risk(v_content),
            (select coalesce(array_agg(distinct c order by c), '{}'::text[]) from unnest(v_cats) c),
            v_reason, round(p_confidence, 2), v_content, p_actor)
    on conflict (job_id, content_fingerprint) do update
      set ai_categories = excluded.ai_categories, ai_reason = excluded.ai_reason,
          ai_confidence = excluded.ai_confidence
      where public.job_content_reviews.status = 'pending'
    returning id into v_id;
  select r.id, r.status into v_id, v_review from public.job_content_reviews r
   where r.job_id = p_job_id and r.content_fingerprint = v_fp;
  perform public.write_audit('job_content.ai_flagged', 'job_content_review', v_id, null,
    jsonb_build_object('status', v_review, 'job_id', p_job_id, 'source', 'ai',
                       'categories', to_jsonb(v_cats)));
  if v_status = 'active' and v_review <> 'approved' then
    update public.jobs set status = 'paused' where id = p_job_id and status = 'active';
    perform public.write_audit('job.paused_for_content_review', 'job', p_job_id,
      jsonb_build_object('status', 'active'), jsonb_build_object('status', 'paused'));
  end if;
  return v_review;
end $$;
revoke all on function public.record_job_content_ai_signal(uuid, text, text[], text, numeric, uuid)
  from public, anon, authenticated;
grant execute on function public.record_job_content_ai_signal(uuid, text, text[], text, numeric, uuid)
  to service_role;

-- --- A6. Decyzja admina ------------------------------------------------------------------------
create or replace function public.admin_decide_job_content_review(
  p_review_id uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_row public.job_content_reviews;
  v_company uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'VALIDATION_FAILED: nieznana decyzja' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and v_reason is null then
    raise exception 'VALIDATION_FAILED: REASON_REQUIRED' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 1000 then
    raise exception 'VALIDATION_FAILED: REASON_TOO_LONG' using errcode = '22023';
  end if;

  select * into v_row from public.job_content_reviews where id = p_review_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status <> 'pending' then
    raise exception 'STALE_STATE: przegląd nie oczekuje na decyzję' using errcode = '42501';
  end if;
  if not exists (select 1 from public.jobs j where j.id = v_row.job_id and j.deleted_at is null)
     or md5(public.job_trust_content(v_row.job_id)::text) <> v_row.content_fingerprint then
    raise exception 'STALE_STATE: treść oferty zmieniła się' using errcode = '42501';
  end if;

  update public.job_content_reviews
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason
   where id = p_review_id;

  perform public.write_audit('job_content.reviewed', 'job_content_review', p_review_id,
    jsonb_build_object('status', v_row.status),
    jsonb_strip_nulls(jsonb_build_object(
      'status', p_decision, 'reason', v_reason, 'job_id', v_row.job_id,
      'rule_categories', to_jsonb(v_row.rule_categories),
      'ai_categories', to_jsonb(v_row.ai_categories))));

  select company_id into v_company from public.jobs where id = v_row.job_id;
  if v_row.requested_by is not null and v_company is not null
     and public.company_recipient_ok(v_company, v_row.requested_by) then
    insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
      values (v_row.requested_by, 'system'::public.notification_type, 'job_content_review_decided',
              'job', v_row.job_id,
              jsonb_build_object('kind', 'job_content_review', 'status', p_decision));
  end if;
end $$;
revoke all on function public.admin_decide_job_content_review(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_job_content_review(uuid, text, text) to authenticated;

-- --- A8. Backfill (bez wstrzymywania aktywnych ofert) --------------------------------------------
insert into public.job_content_reviews (job_id, content_fingerprint, rule_categories, content)
select j.id, md5(c.content::text), public.job_fraud_risk(c.content), c.content
  from public.jobs j
  cross join lateral (select public.job_trust_content(j.id) as content) c
 where j.deleted_at is null
   and cardinality(public.job_fraud_risk(c.content)) > 0
on conflict (job_id, content_fingerprint) do nothing;

-- --- B9. Agencje pracy tymczasowej -------------------------------------------------------------
alter table public.companies
  add column if not exists is_agency boolean not null default false,
  add column if not exists agency_recognition_number text,
  add column if not exists agency_check_status text not null default 'unchecked',
  add column if not exists agency_checked_at timestamptz,
  add column if not exists agency_checked_by uuid references public.profiles(id) on delete set null,
  add column if not exists agency_check_note text;

alter table public.companies drop constraint if exists companies_agency_number_check;
alter table public.companies add constraint companies_agency_number_check check (
  agency_recognition_number is null
  or (is_agency and char_length(agency_recognition_number) between 1 and 64
      and agency_recognition_number = btrim(agency_recognition_number)));
alter table public.companies drop constraint if exists companies_agency_check_status_check;
alter table public.companies add constraint companies_agency_check_status_check check (
  agency_check_status in ('unchecked', 'confirmed', 'not_confirmed')
  and (agency_check_status = 'unchecked') = (agency_checked_at is null)
  and (agency_check_status = 'unchecked' or is_agency)
  and (agency_check_note is null or char_length(agency_check_note) <= 1000));

create index if not exists idx_companies_agency on public.companies (id) where is_agency;

create or replace function public.guard_company_agency()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.is_agency or new.agency_recognition_number is not null
       or new.agency_check_status <> 'unchecked' or new.agency_checked_at is not null
       or new.agency_checked_by is not null or new.agency_check_note is not null then
      raise exception 'PERMISSION_DENIED: oznaczenie agencji tylko przez set_company_agency'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.is_agency is distinct from old.is_agency
     or new.agency_recognition_number is distinct from old.agency_recognition_number
     or new.agency_check_status is distinct from old.agency_check_status
     or new.agency_checked_at is distinct from old.agency_checked_at
     or new.agency_checked_by is distinct from old.agency_checked_by
     or new.agency_check_note is distinct from old.agency_check_note then
    raise exception 'PERMISSION_DENIED: oznaczenie agencji tylko przez set_company_agency'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_company_agency() from public, anon, authenticated;
drop trigger if exists trg_guard_company_agency on public.companies;
create trigger trg_guard_company_agency
  before insert or update on public.companies
  for each row execute function public.guard_company_agency();

-- Deklaracja firmy (owner/admin). Zmiana deklaracji zeruje wynik sprawdzenia admina.
-- Zwraca 'saved' | 'unchanged'.
create or replace function public.set_company_agency(
  p_company_id uuid, p_is_agency boolean, p_recognition_number text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.companies%rowtype;
  v_agency boolean := coalesce(p_is_agency, false);
  v_number text := case when coalesce(p_is_agency, false)
                        then nullif(btrim(coalesce(p_recognition_number, '')), '') end;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if p_company_id is null then raise exception 'VALIDATION_FAILED' using errcode = '22023'; end if;
  if char_length(coalesce(v_number, '')) > 64 then
    raise exception 'VALIDATION_FAILED: numer uznania za długi' using errcode = '22023';
  end if;
  select * into v_row from public.companies where id = p_company_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_company_admin(p_company_id) then
    raise exception 'PERMISSION_DENIED: oznaczenie agencji — tylko owner/admin firmy' using errcode = '42501';
  end if;
  if v_row.is_agency = v_agency and v_row.agency_recognition_number is not distinct from v_number then
    return 'unchanged';
  end if;
  update public.companies
     set is_agency = v_agency, agency_recognition_number = v_number,
         agency_check_status = 'unchecked', agency_checked_at = null,
         agency_checked_by = null, agency_check_note = null
   where id = p_company_id;
  perform public.write_audit('company.agency_changed', 'company', p_company_id,
    jsonb_build_object('is_agency', v_row.is_agency, 'number', v_row.agency_recognition_number,
                       'check', v_row.agency_check_status),
    jsonb_build_object('is_agency', v_agency, 'number', v_number, 'check', 'unchecked'));
  return 'saved';
end $$;
revoke all on function public.set_company_agency(uuid, boolean, text) from public, anon;
grant execute on function public.set_company_agency(uuid, boolean, text) to authenticated;

-- Wynik ręcznego sprawdzenia numeru w rejestrze regionu (admin). CAS po numerze, który admin
-- widział — zmiana deklaracji w międzyczasie = STALE_STATE.
create or replace function public.admin_record_agency_check(
  p_company_id uuid, p_result text, p_expected_number text, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.companies%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_result is null or p_result not in ('confirmed', 'not_confirmed') then
    raise exception 'VALIDATION_FAILED: nieznany wynik' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 1000 then
    raise exception 'VALIDATION_FAILED: REASON_TOO_LONG' using errcode = '22023';
  end if;
  select * into v_row from public.companies where id = p_company_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_row.is_agency or v_row.agency_recognition_number is null then
    raise exception 'VALIDATION_FAILED: firma nie podała numeru uznania' using errcode = '22023';
  end if;
  if v_row.agency_recognition_number is distinct from btrim(coalesce(p_expected_number, '')) then
    raise exception 'STALE_STATE: numer uznania zmienił się' using errcode = '42501';
  end if;
  update public.companies
     set agency_check_status = p_result, agency_checked_at = now(),
         agency_checked_by = auth.uid(), agency_check_note = v_note
   where id = p_company_id;
  perform public.write_audit('company.agency_checked', 'company', p_company_id,
    jsonb_build_object('check', v_row.agency_check_status),
    jsonb_strip_nulls(jsonb_build_object('check', p_result, 'number', v_row.agency_recognition_number,
                                         'note', v_note)));
end $$;
revoke all on function public.admin_record_agency_check(uuid, text, text, text) from public, anon;
grant execute on function public.admin_record_agency_check(uuid, text, text, text) to authenticated;

-- --- B10. Publicznie: które z podanych ofert publicznych pochodzą od agencji --------------------
create or replace function public.get_public_jobs_agency(p_job_ids uuid[])
returns table (job_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select j.id
    from public.jobs j
    join public.companies c on c.id = j.company_id
   where j.id = any ((coalesce(p_job_ids, '{}'::uuid[]))[1:100])
     and j.status = 'active' and j.deleted_at is null
     and (j.expires_at is null or j.expires_at > now())
     and c.status = 'verified' and c.deleted_at is null
     and c.is_agency;
$$;
revoke all on function public.get_public_jobs_agency(uuid[]) from public;
grant execute on function public.get_public_jobs_agency(uuid[]) to anon, authenticated, service_role;

-- --- B10. Filtr „bezpośrednio od pracodawcy” (stan 0153 + jeden warunek) ------------------------
drop function if exists public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text);
create or replace function public.get_public_jobs(
  p_locale         text        default 'pl',
  p_keyword        text        default null,
  p_city           text        default null,
  p_categories     text[]      default null,
  p_locations      text[]      default null,
  p_contract_types text[]      default null,
  p_salary_min     integer     default null,
  p_salary_max     integer     default null,
  p_accommodation  boolean     default null,
  p_immediate      boolean     default null,
  p_no_language    boolean     default null,
  p_since          timestamptz default null,
  p_sort           text        default 'newest',
  p_limit          integer     default 20,
  p_offset         integer     default 0,
  p_salary_unit    text        default 'month',
  p_direct_only    boolean     default null
)
returns table (
  id uuid, slug text, title text, company_name text, company_verified boolean,
  city text, region text, contract_type text, salary_min integer, salary_max integer,
  currency text, salary_period text, published_at timestamptz, highlights text[], category text,
  accommodation boolean, immediate boolean, no_language_required boolean, company_slug text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    j.id, j.slug,
    coalesce(t.title, j.title) as title,
    c.name as company_name,
    (c.status = 'verified') as company_verified,
    j.city, j.region, j.contract_type::text,
    j.salary_min, j.salary_max, coalesce(j.currency, 'EUR') as currency,
    j.salary_period::text as salary_period,
    j.published_at,
    coalesce(t.highlights, '{}'::text[]) as highlights,
    j.category::text,
    j.accommodation, j.immediate, j.no_language_required,
    c.slug as company_slug
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title, jt.highlights
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = case when public.is_supported_locale(p_locale) then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.status = 'active' and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified' and c.deleted_at is null
    -- #97: zalogowany kandydat nie dostaje ofert firm, które zablokował (gość: bez zmian).
    and not exists (
      select 1 from public.candidate_company_blocks b
      where b.candidate_id = auth.uid() and b.company_id = j.company_id
    )
    and (p_categories is null or array_length(p_categories, 1) is null or j.category::text = any(p_categories))
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations)
         or j.location_id in (select unnest(public.location_filter_ids(p_locations))))
    and (p_contract_types is null or array_length(p_contract_types, 1) is null or j.contract_type::text = any(p_contract_types))
    and (p_city is null or j.id in (select public.search_city_candidates(left(p_city, 100))))
    -- Prefiltr po indeksach (tytuł oferty albo któregokolwiek tłumaczenia); dokładny
    -- warunek na wyświetlanym tytule niżej.
    and (p_keyword is null or j.id in (
      select public.search_title_candidates(left(p_keyword, 100))))
    and (p_keyword is null or public.search_fold(coalesce(t.title, j.title))
      like public.search_like_pattern(left(p_keyword, 100)) escape '\')
    and public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, p_salary_min, p_salary_max, p_salary_unit)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since)
    -- 0910: „bezpośrednio od pracodawcy” = firma nie jest agencją pracy tymczasowej.
    and (coalesce(p_direct_only, false) = false or not c.is_agency)
  order by
    (case when p_sort = 'salary' then public.job_salary_sort_key(
      j.salary_min, j.salary_max, j.salary_period, p_salary_unit) end) desc nulls last,
    j.published_at desc,
    -- #594 (0136): tie-breaker deterministyczny (PK, unikalny).
    j.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000);
$$;
revoke all on function public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean
) from public;
grant execute on function public.get_public_jobs(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, integer, integer, text, boolean
) to anon, authenticated;

drop function if exists public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text);
create or replace function public.get_public_jobs_count(
  p_locale         text      default 'pl',
  p_keyword        text      default null,
  p_city           text      default null,
  p_categories     text[]    default null,
  p_locations      text[]    default null,
  p_contract_types text[]    default null,
  p_salary_min     integer   default null,
  p_salary_max     integer   default null,
  p_accommodation  boolean   default null,
  p_immediate      boolean   default null,
  p_no_language    boolean   default null,
  p_since          timestamptz default null,
  p_salary_unit    text      default 'month',
  p_direct_only    boolean   default null
) returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::bigint
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = case when public.is_supported_locale(p_locale) then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.status = 'active' and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified' and c.deleted_at is null
    and not exists (
      select 1 from public.candidate_company_blocks b
      where b.candidate_id = auth.uid() and b.company_id = j.company_id
    )
    and (p_categories is null or array_length(p_categories, 1) is null or j.category::text = any(p_categories))
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations)
         or j.location_id in (select unnest(public.location_filter_ids(p_locations))))
    and (p_contract_types is null or array_length(p_contract_types, 1) is null or j.contract_type::text = any(p_contract_types))
    and (p_city is null or j.id in (select public.search_city_candidates(left(p_city, 100))))
    and (p_keyword is null or j.id in (
      select public.search_title_candidates(left(p_keyword, 100))))
    and (p_keyword is null or public.search_fold(coalesce(t.title, j.title))
      like public.search_like_pattern(left(p_keyword, 100)) escape '\')
    and public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, p_salary_min, p_salary_max, p_salary_unit)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since)
    and (coalesce(p_direct_only, false) = false or not c.is_agency);
$$;
revoke all on function public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean
) from public;
grant execute on function public.get_public_jobs_count(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, boolean
) to anon, authenticated;

drop function if exists public.get_public_job_filter_facets(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text);
create or replace function public.get_public_job_filter_facets(
  p_locale text default 'pl', p_keyword text default null, p_city text default null,
  p_categories text[] default null, p_locations text[] default null,
  p_contract_types text[] default null, p_salary_min integer default null,
  p_salary_max integer default null, p_accommodation boolean default null,
  p_immediate boolean default null, p_no_language boolean default null,
  p_since timestamptz default null, p_salary_unit text default 'month',
  p_direct_only boolean default null
) returns table (dimension text, key text, total bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with input as (
    select
      case when public.is_supported_locale(p_locale) then p_locale else 'pl' end locale,
      nullif(left(p_keyword,100),'') keyword, nullif(left(p_city,100),'') city,
      (select array_agg(distinct left(v,100)) from unnest(p_categories[1:100]) v where v <> '') categories,
      (select array_agg(distinct left(v,100)) from unnest(p_locations[1:100]) v where v <> '') locations,
      public.location_filter_ids(p_locations[1:100]) location_ids,
      (select array_agg(distinct left(v,100)) from unnest(p_contract_types[1:100]) v where v <> '') contracts
  ), base as materialized (
    select j.id, j.category::text category, j.city, j.location_id,
      coalesce(l.name, j.city) city_label, j.contract_type::text contract_type,
      j.accommodation, j.immediate, j.no_language_required, c.is_agency
    from public.jobs j
    join public.companies c on c.id=j.company_id
    left join public.locations l on l.id=j.location_id and l.is_active
    cross join input i
    left join lateral (
      select jt.title from public.job_translations jt where jt.job_id=j.id
      order by (jt.locale=i.locale) desc, (jt.locale=j.default_locale) desc,
        (jt.locale='en') desc limit 1
    ) t on true
    where j.status='active' and j.deleted_at is null
      and (j.expires_at is null or j.expires_at>now())
      and c.status='verified' and c.deleted_at is null
      and not exists (
      select 1 from public.candidate_company_blocks b
      where b.candidate_id = auth.uid() and b.company_id = j.company_id
    )
      and (nullif(left(p_keyword,100),'') is null or j.id in (
        select public.search_title_candidates(left(p_keyword,100))))
      and (i.keyword is null or public.search_fold(coalesce(t.title,j.title))
        like public.search_like_pattern(i.keyword) escape '\')
      and (nullif(left(p_city,100),'') is null or j.id in (
        select public.search_city_candidates(left(p_city,100))))
      and public.job_salary_in_range(
        j.salary_min,j.salary_max,j.salary_period,p_salary_min,p_salary_max,p_salary_unit)
      and (p_since is null or j.published_at>=p_since)
  ), selected as (select * from input)
  select 'total','all',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) and
    (coalesce(p_direct_only,false)=false or not b.is_agency)
  union all
  select 'category',b.category,count(*) from base b cross join selected s where
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) and
    (coalesce(p_direct_only,false)=false or not b.is_agency) group by b.category
  union all
  select 'location',b.city_label,count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) and
    (coalesce(p_direct_only,false)=false or not b.is_agency) group by b.city_label
  union all
  select 'contract',b.contract_type,count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) and
    (coalesce(p_direct_only,false)=false or not b.is_agency) group by b.contract_type
  union all
  select 'accommodation',case when b.accommodation then 'provided' else 'unavailable' end,count(*)
    from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) and
    (coalesce(p_direct_only,false)=false or not b.is_agency)
    group by b.accommodation
  union all
  select 'additional','immediate',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and b.immediate and
    (coalesce(p_no_language,false)=false or b.no_language_required) and
    (coalesce(p_direct_only,false)=false or not b.is_agency)
  union all
  select 'additional','no_language',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and b.no_language_required and
    (coalesce(p_direct_only,false)=false or not b.is_agency)
  union all
  select 'additional','direct',count(*) from base b cross join selected s where
    (s.categories is null or b.category=any(s.categories)) and
    (s.locations is null or b.city=any(s.locations) or b.location_id=any(s.location_ids)) and
    (s.contracts is null or b.contract_type=any(s.contracts)) and
    (p_accommodation is null or b.accommodation=p_accommodation) and
    (coalesce(p_immediate,false)=false or b.immediate) and
    (coalesce(p_no_language,false)=false or b.no_language_required) and not b.is_agency;
$$;
revoke all on function public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean) from public;
grant execute on function public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,boolean) to anon, authenticated;

-- Kopia filtrów dla alertów (test synchronizacji 0158). Zapisane wyszukiwania nie przechowują
-- jeszcze filtra (etap 2) — saved_search_keyset_page nie podaje p_direct_only (NULL).
drop function if exists public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer);
create or replace function public.saved_search_jobs_after(
  p_locale              text,
  p_keyword             text,
  p_city                text,
  p_categories          text[],
  p_locations           text[],
  p_contract_types      text[],
  p_salary_min          integer,
  p_salary_max          integer,
  p_accommodation       boolean,
  p_immediate           boolean,
  p_no_language         boolean,
  p_since               timestamptz,
  p_salary_unit         text,
  p_after_published_at  timestamptz,
  p_after_id            uuid,
  p_limit               integer,
  p_direct_only         boolean default null
)
returns table (id uuid, published_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select j.id, j.published_at
  -- BEGIN get_public_jobs filters (kopia 1:1 z najnowszej definicji get_public_jobs)
  from public.jobs j
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title, jt.highlights
    from public.job_translations jt
    where jt.job_id = j.id
    order by (jt.locale = case when public.is_supported_locale(p_locale) then p_locale else 'pl' end) desc,
             (jt.locale = j.default_locale) desc, (jt.locale = 'en') desc
    limit 1
  ) t on true
  where j.status = 'active' and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified' and c.deleted_at is null
    and not exists (
      select 1 from public.candidate_company_blocks b
      where b.candidate_id = auth.uid() and b.company_id = j.company_id
    )
    and (p_categories is null or array_length(p_categories, 1) is null or j.category::text = any(p_categories))
    and (p_locations is null or array_length(p_locations, 1) is null or j.city = any(p_locations)
         or j.location_id in (select unnest(public.location_filter_ids(p_locations))))
    and (p_contract_types is null or array_length(p_contract_types, 1) is null or j.contract_type::text = any(p_contract_types))
    and (p_city is null or j.id in (select public.search_city_candidates(left(p_city, 100))))
    and (p_keyword is null or j.id in (
      select public.search_title_candidates(left(p_keyword, 100))))
    and (p_keyword is null or public.search_fold(coalesce(t.title, j.title))
      like public.search_like_pattern(left(p_keyword, 100)) escape '\')
    and public.job_salary_in_range(
      j.salary_min, j.salary_max, j.salary_period, p_salary_min, p_salary_max, p_salary_unit)
    and (p_accommodation is null or j.accommodation = p_accommodation)
    and (coalesce(p_immediate, false) = false or j.immediate = true)
    and (coalesce(p_no_language, false) = false or j.no_language_required = true)
    and (p_since is null or j.published_at >= p_since)
    and (coalesce(p_direct_only, false) = false or not c.is_agency)
  -- END get_public_jobs filters
    and j.published_at is not null
    and (p_after_published_at is null
         or (j.published_at, j.id) < (p_after_published_at, p_after_id))
  order by j.published_at desc, j.id desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;
revoke all on function public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean
) from public, anon, authenticated;
grant execute on function public.saved_search_jobs_after(
  text, text, text, text[], text[], text[], integer, integer,
  boolean, boolean, boolean, timestamptz, text, timestamptz, uuid, integer, boolean
) to service_role;

-- --- A9. Budżet AI: nowa funkcja `job_fraud_check` (analiza treści oferty, drugi sygnał) ------
-- Lista funkcji = AI_FEATURE_IDS (src/lib/ai/inventory.ts; test ai-budget). Treść ai_budget_reserve
-- = stan z 0120 poza listą funkcji.
alter table public.ai_usage_ledger drop constraint if exists ai_usage_ledger_feature;
alter table public.ai_usage_ledger add constraint ai_usage_ledger_feature
  check (feature in ('job_listing_import', 'content_translation', 'job_offer_assist', 'cv_profile_import', 'job_fraud_check'));

create or replace function public.ai_budget_reserve(
  p_feature text,
  p_model text,
  p_estimate_micro_usd bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := public.ai_budget_day();
  v_month date := date_trunc('month', v_day)::date;
  v_day_limit bigint;
  v_month_limit bigint;
  v_id uuid;
begin
  if p_feature is null or p_feature not in ('job_listing_import', 'content_translation', 'job_offer_assist', 'cv_profile_import', 'job_fraud_check') then
    raise exception 'VALIDATION_FAILED: feature' using errcode = '22023';
  end if;
  if p_model is null or p_model !~ '^[a-z0-9][a-z0-9.-]{2,63}$' then
    raise exception 'VALIDATION_FAILED: model' using errcode = '22023';
  end if;
  -- Szacunek musi być dodatni: rezerwacja zerowa nie chroniłaby budżetu.
  if p_estimate_micro_usd is null or p_estimate_micro_usd <= 0 or p_estimate_micro_usd > 100000000 then
    raise exception 'VALIDATION_FAILED: estimate' using errcode = '22023';
  end if;

  -- Jedna rezerwacja naraz: równoległe wywołania nie przekroczą limitu wspólnie.
  perform pg_advisory_xact_lock(hashtext('pracujbe.ai_budget'));

  select limit_micro_usd into v_day_limit from public.ai_budget_limits where period = 'day';
  select limit_micro_usd into v_month_limit from public.ai_budget_limits where period = 'month';
  if v_day_limit is null or v_month_limit is null then
    raise exception 'AI_BUDGET_UNCONFIGURED' using errcode = 'P0001';
  end if;

  if public.ai_budget_spent(v_day, v_day) + p_estimate_micro_usd > v_day_limit
     or public.ai_budget_spent(v_month, v_day) + p_estimate_micro_usd > v_month_limit then
    raise exception 'AI_BUDGET_EXCEEDED' using errcode = 'P0001';
  end if;

  insert into public.ai_usage_ledger (feature, model, reserved_micro_usd, usage_day)
  values (p_feature, p_model, p_estimate_micro_usd, v_day)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.ai_budget_reserve(text, text, bigint) from public, anon, authenticated;
grant execute on function public.ai_budget_reserve(text, text, bigint) to service_role;
