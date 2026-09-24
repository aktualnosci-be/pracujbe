-- =============================================================================
-- 0103 — kontrola treści pytań screeningowych przed publikacją (#497).
--
-- Po #101 (0093) baza sprawdzała strukturę pytań, ale nie ich treść. Ta migracja dodaje
-- deterministyczną kontrolę (wzorce PL/NL/FR/EN, bez modelu językowego) i kolejkę przeglądu
-- przez człowieka. Trafienie wzorca NIE jest oceną prawną — kieruje pytanie do admina;
-- brak trafienia nie dowodzi zgodności pytania z prawem.
--
-- 1. `screening_fold(text)` — składanie znaków (diakrytyki PL/FR na ASCII, œ/æ/ß, małe
--    litery, wszystko poza [a-z0-9] → spacja, spacje graniczne). `screening_risk_patterns()`
--    — wzorce ARE przypisane do kategorii (wiek, płeć, ciąża/plany rodzinne, stan cywilny,
--    religia, pochodzenie, zdrowie, orientacja, związki zawodowe, poglądy polityczne,
--    karalność). Lustro w `src/lib/screening/risk.ts`; test `screening-risk.test.ts`
--    porównuje wzorce i znaki 1:1. `screening_question_risk(prompt, options)` sprawdza treść
--    i KAŻDĄ opcję we WSZYSTKICH językach.
-- 2. `job_screening_questions` — kolumny `risk_categories` i `content_fingerprint` (md5 typu,
--    treści i opcji) liczone triggerem przy każdym zapisie; klient ich nie ustawia.
-- 3. `screening_question_reviews` — przegląd pytania oznaczonego przez detektor, jeden wiersz
--    na (oferta, odcisk treści): pending → approved/rejected. Wiersz powstaje przy ZAPISIE
--    kroku kreatora (trigger na pytaniach), więc zgłoszenie nie ginie razem z odrzuconą
--    publikacją; ponowny zapis tej samej treści niczego nie zmienia. Treść usunięta z oferty
--    zostaje jako historia (kolejka pokazuje tylko treść obecną w ofercie).
--    Zmiana treści lub tłumaczenia = nowy odcisk = nowy przegląd (decyzja nie przechodzi na
--    inną treść). Odczyt: członek firmy oferty (RLS) i admin (service role). Bez DML dla
--    klientów; audyt `screening_question.review_requested`.
-- 4. Strażnik `enforce_screening_review` (BEFORE UPDATE OF status na jobs): oferta nie staje
--    się aktywna (publikacja, wznowienie, ponowne otwarcie — każda ścieżka, także definer),
--    dopóki każde oznaczone pytanie nie ma decyzji `approved` dla bieżącej treści.
--    Błędy: `SCREENING_QUESTION_REJECTED: <pozycja>` / `SCREENING_REVIEW_REQUIRED: <pozycja>`.
--    Po akceptacji publikuje wyłącznie firma (brak automatycznej publikacji).
-- 5. `admin_decide_screening_review(id, decyzja, uzasadnienie)` — tylko admin, tylko
--    pending i tylko treść nadal obecna w ofercie (inaczej STALE_STATE), odrzucenie wymaga uzasadnienia (≤ 1000 znaków), audyt
--    `screening_question.reviewed`, powiadomienie in-app dla osoby, która zapisała pytanie.
-- 6. Pytania zapisane przed tą migracją: odciski i kategorie liczone od razu, oznaczone
--    trafiają do kolejki. Oferty już aktywne pozostają aktywne (zbieranie odpowiedzi po
--    publikacji = osobny krok #497), ale wznowienie/ponowne otwarcie wymaga decyzji.
--
-- Rollback: drop trigger trg_enforce_screening_review on jobs, trg_screening_question_risk
-- i trg_screening_question_review_request on job_screening_questions; drop function
-- admin_decide_screening_review(uuid, text, text), enforce_screening_review(),
-- request_screening_question_review(), set_screening_question_risk(),
-- screening_question_risk(jsonb, jsonb), screening_risk_patterns(), screening_fold(text);
-- drop table screening_question_reviews; alter table job_screening_questions drop column
-- risk_categories, drop column content_fingerprint. Migracja nie zmienia treści pytań ani
-- odpowiedzi.
-- =============================================================================

-- --- 1. Detektor ---------------------------------------------------------------------------
create or replace function public.screening_fold(p_text text)
returns text language sql immutable parallel safe set search_path = public, pg_temp as $$
  select ' ' || btrim(regexp_replace(
    lower(replace(replace(replace(replace(replace(
      translate(coalesce(p_text, ''),
        'ąćęłńóśźżàâäáãåçéèêëíìîïñòôöõúùûüýÿĄĆĘŁŃÓŚŹŻÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÒÔÖÕÚÙÛÜÝŸøØ',
        'acelnoszzaaaaaaceeeeiiiinoooouuuuyyACELNOSZZAAAAAACEEEEIIIINOOOOUUUUYYoO'),
      'œ', 'oe'), 'Œ', 'OE'), 'æ', 'ae'), 'Æ', 'AE'), 'ß', 'ss')),
    '[^a-z0-9]+', ' ', 'g')) || ' ';
$$;
revoke all on function public.screening_fold(text) from public, anon, authenticated;

create or replace function public.screening_risk_patterns()
returns table (category text, pattern text)
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select v.category, v.pattern from (values
    -- risk-patterns:begin
    ('age', ' wiek(u|iem)? '),
    ('age', ' ile masz lat '),
    ('age', ' ile (pan|pani) ma lat '),
    ('age', ' (data|daty|date|dacie|rok|roku) urodzenia '),
    ('age', ' urodzil(a|es|as|em|am)? '),
    ('age', ' how old '),
    ('age', ' age '),
    ('age', ' (date|year) of birth '),
    ('age', ' birth ?date '),
    ('age', ' birthday '),
    ('age', ' dob '),
    ('age', ' were you born '),
    ('age', ' leeftijd '),
    ('age', ' geboorte(datum|jaar) '),
    ('age', ' hoe oud '),
    ('age', ' wanneer (ben je|bent u) geboren '),
    ('age', ' (quel|votre|ton) age '),
    ('age', ' (date|annee) de naissance '),
    ('age', ' etes vous ne(e)? '),
    ('sex', ' plec '),
    ('sex', ' plci '),
    ('sex', ' (jestes|czy jest pan|czy jest pani) (kobieta|mezczyzna) '),
    ('sex', ' kobieta czy mezczyzna '),
    ('sex', ' mezczyzna czy kobieta '),
    ('sex', ' gender '),
    ('sex', ' sex '),
    ('sex', ' (male|man) or (female|woman) '),
    ('sex', ' (female|woman) or (male|man) '),
    ('sex', ' are you (a )?(man|woman|male|female) '),
    ('sex', ' geslacht '),
    ('sex', ' man of vrouw '),
    ('sex', ' vrouw of man '),
    ('sex', ' (ben je|bent u) een (man|vrouw) '),
    ('sex', ' sexe '),
    ('sex', ' homme ou (une )?femme '),
    ('sex', ' femme ou (un )?homme '),
    ('sex', ' etes vous (un homme|une femme) '),
    ('family', ' ciaz'),
    ('family', ' macierzy[a-z]* '),
    ('family', ' (urlop[a-z]*|urlopie) (rodzicielsk|ojcowsk|wychowawcz)'),
    ('family', ' (masz|macie|posiadasz|pan ma|pani ma) dzieci '),
    ('family', ' ile (masz )?dzieci '),
    ('family', ' (planujesz|planuje pan|planuje pani|planujecie) [a-z ]*(dzieci|dziecko|rodzine|ciaze) '),
    ('family', ' plany rodzinne '),
    ('family', ' powiekszeni[a-z]* rodziny '),
    ('family', ' pregnan'),
    ('family', ' (maternity|paternity) '),
    ('family', ' (have|any) (children|kids) '),
    ('family', ' plan(ning)? to have (children|kids|a baby) '),
    ('family', ' (start|starting) a family '),
    ('family', ' family plans '),
    ('family', ' zwanger'),
    ('family', ' kinderwens '),
    ('family', ' (heb je|hebt u|heeft u|heb jij) kinderen '),
    ('family', ' kinderen (krijgen|plannen) '),
    ('family', ' (moederschap|bevallingsverlof|zwangerschapsverlof|ouderschapsverlof)[a-z]* '),
    ('family', ' gezinsuitbreiding '),
    ('family', ' enceinte '),
    ('family', ' grossesse '),
    ('family', ' (avez vous|as tu) des enfants '),
    ('family', ' enfants a charge '),
    ('family', ' (desir|projet|projets) d enfant'),
    ('family', ' (conge de )?maternite '),
    ('marital', ' stan cywilny '),
    ('marital', ' stanu cywilnego '),
    ('marital', ' (zonaty|zonata|zamezna|zamezny|rozwiedzion[a-z]*|wdow[a-z]*) '),
    ('marital', ' malzon[a-z]* '),
    ('marital', ' marital '),
    ('marital', ' (married|divorced|widowed|widow|widower|spouse|husband|wife) '),
    ('marital', ' burgerlijke staat '),
    ('marital', ' (getrouwd|gehuwd|gescheiden|weduwe|weduwnaar|echtgenoot|echtgenote) '),
    ('marital', ' etat civil '),
    ('marital', ' situation (familiale|matrimoniale) '),
    ('marital', ' (marie|mariee|celibataire|divorce|divorcee|veuf|veuve|conjoint|conjointe|epoux|epouse) '),
    ('religion', ' religi'),
    ('religion', ' wyznani[a-z]* '),
    ('religion', ' wierzac[a-z]* '),
    ('religion', ' (kosciol|kosciola|kosciele|meczet[a-z]*|synagog[a-z]*) '),
    ('religion', ' (katoli|muzulma|chrzesci|zydow|prawoslaw|ewangeli)[a-z]* '),
    ('religion', ' (islam|ramadan|hidzab) '),
    ('religion', ' modli[a-z]* '),
    ('religion', ' (church|mosque|synagogue|faith|muslim|christian|jewish|hindu|buddhist|sabbath|ramadan|hijab|headscarf) '),
    ('religion', ' pray[a-z]* '),
    ('religion', ' (geloof|godsdienst[a-z]*|kerk|moskee|moslim|christen|christelijk|joods|hoofddoek|ramadan) '),
    ('religion', ' (bidden|bid je|bidt u) '),
    ('religion', ' (croyant|croyante|croyance[s]?|foi|eglise|mosquee|synagogue|musulman|musulmane|chretien|chretienne|juif|juive|ramadan|pratiquant|pratiquante) '),
    ('religion', ' (priere|prier|priez) '),
    ('origin', ' (narodowos|obywatelst|pochodzeni|etniczn|rasow)[a-z]* '),
    ('origin', ' (rasa|rasy|rase) '),
    ('origin', ' kolor[a-z]* skory '),
    ('origin', ' skad pochodzisz '),
    ('origin', ' (kraj[a-z]*|miejsce|miejsca) urodzenia '),
    ('origin', ' (nationality|citizenship|ethnic|ethnicity|race|racial|origin) '),
    ('origin', ' skin colou?r '),
    ('origin', ' where are you (originally )?from '),
    ('origin', ' (country|place) of (origin|birth) '),
    ('origin', ' (nationaliteit|afkomst|herkomst|etnisch[a-z]*|huidskleur|ras|geboorteland|geboorteplaats|staatsburgerschap) '),
    ('origin', ' waar (kom je|komt u) vandaan '),
    ('origin', ' (nationalite|origine|origines|ethnie|ethnique|race|citoyennete) '),
    ('origin', ' couleur de peau '),
    ('origin', ' (pays|lieu) de naissance '),
    ('origin', ' d ou (venez vous|viens tu) '),
    ('health', ' zdrowi[a-z]* '),
    ('health', ' chorob[a-z]* '),
    ('health', ' (chory|chora|chorujesz|choruje) '),
    ('health', ' (niepelnospraw|niesprawn|inwalid)[a-z]* '),
    ('health', ' (lek|leki|lekow|lekarstw[a-z]*) '),
    ('health', ' zwolnieni[a-z]* lekarsk'),
    ('health', ' (alergi|uzaleznien|depresj|psychiatr|nowotw|cukrzyc|epileps)[a-z]* '),
    ('health', ' hiv '),
    ('health', ' health(?! (and )?safety)(?! ?care) '),
    ('health', ' (disabled|disability|disabilities|illness|illnesses|ill|sick|sickness|handicap|handicapped|chronic|medication|medications|diagnosis|diagnosed|allergy|allergies|depression) '),
    ('health', ' medical (condition|history|problem)'),
    ('health', ' mental (health|illness) '),
    ('health', ' (gezondheid|ziekte|ziekten|ziek|ziekteverlof|handicap|beperking|medicijnen|medicatie|chronisch|chronische|arbeidsongeschikt|invalide|allergie|depressie) '),
    ('health', ' sante(?! et securite) '),
    ('health', ' (maladie|maladies|malade|handicap|handicape|handicapee|invalidite|medicament|medicaments|chronique|allergie|allergies|depression) '),
    ('health', ' (arret|conge) maladie '),
    ('health', ' traitement medical '),
    ('orientation', ' orientacj[a-z]* seksualn'),
    ('orientation', ' (homoseksual|biseksual|lesbij|transplc|lgbt)[a-z]* '),
    ('orientation', ' (gej|geje|gejem) '),
    ('orientation', ' sexual (orientation|preference)'),
    ('orientation', ' (sexuality|gay|lesbian|bisexual|transgender|homosexual|lgbt|lgbtq) '),
    ('orientation', ' (seksuele )?geaardheid '),
    ('orientation', ' (homo|homoseksueel|lesbisch|biseksueel|transgender|holebi) '),
    ('orientation', ' orientation sexuelle '),
    ('orientation', ' (homosexuel|homosexuelle|lesbienne|gay|bisexuel|bisexuelle|transgenre|lgbt) '),
    ('union', ' zwiaz[a-z]* zawodow'),
    ('union', ' zwiazkow(iec|cem|ca|a|y|ej|ym) '),
    ('union', ' (trade|labou?r) union'),
    ('union', ' union member'),
    ('union', ' unioni[sz]ed '),
    ('union', ' (vakbond|vakbonden|vakbondslid|vakbondslidmaatschap) '),
    ('union', ' (acv|abvv|aclvb|fgtb|csc|cgslb) '),
    ('union', ' (syndicat|syndicats|syndique|syndiquee|syndical|syndicale|syndicaliste) '),
    ('political', ' polityczn'),
    ('political', ' political '),
    ('political', ' (vote|voted|voting) for '),
    ('political', ' politieke (voorkeur|overtuiging|partij|mening)'),
    ('political', ' (opinion|opinions|conviction|convictions|parti|preference) politique'),
    ('criminal', ' (karan|niekaran|karalnos|niekaralnos|skazan)[a-z]* '),
    ('criminal', ' (wyrok|wyroki|wyrokiem|wiezieni[a-z]*|kartotek[a-z]*) '),
    ('criminal', ' rejestr[a-z]* karn'),
    ('criminal', ' (criminal|convicted|conviction|convictions|felony|prison|jail) '),
    ('criminal', ' police (record|check)'),
    ('criminal', ' (strafblad|strafregister|veroordeeld|veroordeling|gevangenis) '),
    ('criminal', ' (goed gedrag|goed gedrag en zeden) '),
    ('criminal', ' casier judiciaire '),
    ('criminal', ' (condamne|condamnee|condamnation|condamnations|prison) '),
    ('criminal', ' bonne vie et moeurs '),
    ('criminal', ' bonnes vie et moeurs ')
    -- risk-patterns:end
  ) as v(category, pattern);
$$;
revoke all on function public.screening_risk_patterns() from public, anon, authenticated;

-- Kategorie ryzyka pytania: treść i etykiety opcji we wszystkich językach mapy.
create or replace function public.screening_question_risk(p_prompt jsonb, p_options jsonb)
returns text[] language sql immutable parallel safe set search_path = public, pg_temp as $$
  with texts as (
    select public.screening_fold(t.value) as txt
      from jsonb_each_text(case when jsonb_typeof(p_prompt) = 'object' then p_prompt else '{}'::jsonb end) t
    union all
    select public.screening_fold(l.value)
      from jsonb_array_elements(case when jsonb_typeof(p_options) = 'array' then p_options else '[]'::jsonb end) o,
           jsonb_each_text(case when jsonb_typeof(o.value->'label') = 'object' then o.value->'label' else '{}'::jsonb end) l
  )
  select coalesce(array_agg(distinct p.category order by p.category), '{}'::text[])
    from public.screening_risk_patterns() p
    where exists (select 1 from texts where texts.txt ~ p.pattern);
$$;
revoke all on function public.screening_question_risk(jsonb, jsonb) from public, anon, authenticated;

-- --- 2. Kategorie i odcisk treści pytania --------------------------------------------------
alter table public.job_screening_questions
  add column if not exists risk_categories     text[] not null default '{}'::text[],
  add column if not exists content_fingerprint text;

create or replace function public.set_screening_question_risk()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.risk_categories := public.screening_question_risk(new.prompt, new.options);
  new.content_fingerprint := md5(jsonb_build_object(
    'type', new.type, 'prompt', new.prompt, 'options', new.options)::text);
  return new;
end $$;
revoke all on function public.set_screening_question_risk() from public, anon, authenticated;
drop trigger if exists trg_screening_question_risk on public.job_screening_questions;
create trigger trg_screening_question_risk
  before insert or update on public.job_screening_questions
  for each row execute function public.set_screening_question_risk();

-- --- 3. Kolejka przeglądu ------------------------------------------------------------------
create table if not exists public.screening_question_reviews (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs(id) on delete cascade,
  content_fingerprint text not null,
  risk_categories     text[] not null,
  question_type       text not null,
  prompt              jsonb not null,
  options             jsonb not null default '[]'::jsonb,
  status              text not null default 'pending',
  requested_by        uuid references public.profiles(id) on delete set null,
  requested_at        timestamptz not null default now(),
  decided_by          uuid references public.profiles(id) on delete set null,
  decided_at          timestamptz,
  decision_reason     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (job_id, content_fingerprint),
  constraint screening_question_reviews_status
    check (status in ('pending', 'approved', 'rejected')),
  constraint screening_question_reviews_categories check (
    cardinality(risk_categories) > 0
    and risk_categories <@ array['age', 'sex', 'family', 'marital', 'religion', 'origin', 'health',
                                 'orientation', 'union', 'political', 'criminal']::text[]),
  constraint screening_question_reviews_type
    check (question_type in ('yes_no', 'single_choice', 'date', 'short_text')),
  constraint screening_question_reviews_decision check (
    (status in ('approved', 'rejected')) = (decided_at is not null)
    and (status <> 'rejected' or char_length(btrim(coalesce(decision_reason, ''))) between 1 and 1000)
    and (decision_reason is null or char_length(decision_reason) <= 1000))
);
create index if not exists idx_screening_question_reviews_queue
  on public.screening_question_reviews (status, requested_at desc, id desc);
drop trigger if exists trg_set_updated_at on public.screening_question_reviews;
create trigger trg_set_updated_at before update on public.screening_question_reviews
  for each row execute function public.set_updated_at();

alter table public.screening_question_reviews enable row level security;
alter table public.screening_question_reviews force row level security;
revoke all on public.screening_question_reviews from public, anon, authenticated;
grant select on public.screening_question_reviews to authenticated;
drop policy if exists screening_question_reviews_select on public.screening_question_reviews;
create policy screening_question_reviews_select on public.screening_question_reviews
  for select to authenticated
  using (public.is_job_company_member(job_id));

-- Zgłoszenie do przeglądu przy zapisie pytania (każda ścieżka zapisu, także replace-all 0093).
-- Ta sama treść zapisana ponownie (autozapis kroku) nie tworzy nowego zgłoszenia i nie zmienia
-- decyzji; treść usunięta z oferty zostawia wiersz jako historię — kolejka admina pokazuje
-- tylko przeglądy treści obecnej w ofercie, a decyzja o nieobecnej treści = STALE_STATE.
create or replace function public.request_screening_question_review()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if cardinality(new.risk_categories) > 0 then
    insert into public.screening_question_reviews
        (job_id, content_fingerprint, risk_categories, question_type, prompt, options, requested_by)
      values (new.job_id, new.content_fingerprint, new.risk_categories, new.type, new.prompt,
              new.options, auth.uid())
      on conflict (job_id, content_fingerprint) do nothing
      returning id into v_id;
    if v_id is not null then
      perform public.write_audit('screening_question.review_requested', 'screening_question_review',
        v_id, null,
        jsonb_build_object('status', 'pending', 'job_id', new.job_id,
                           'categories', to_jsonb(new.risk_categories)));
    end if;
  end if;
  return null;
end $$;
revoke all on function public.request_screening_question_review() from public, anon, authenticated;
drop trigger if exists trg_screening_question_review_request on public.job_screening_questions;
create trigger trg_screening_question_review_request
  after insert or update on public.job_screening_questions
  for each row execute function public.request_screening_question_review();

-- --- 4. Strażnik aktywacji oferty ----------------------------------------------------------
create or replace function public.enforce_screening_review()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_position smallint; v_status text;
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    select q.position, coalesce(r.status, 'pending')
      into v_position, v_status
      from public.job_screening_questions q
      left join public.screening_question_reviews r
        on r.job_id = q.job_id and r.content_fingerprint = q.content_fingerprint
     where q.job_id = new.id
       and cardinality(q.risk_categories) > 0
       and coalesce(r.status, 'pending') <> 'approved'
     order by (r.status = 'rejected') desc nulls last, q.position
     limit 1;
    if v_position is not null then
      if v_status = 'rejected' then
        raise exception 'SCREENING_QUESTION_REJECTED: %', v_position using errcode = '42501';
      end if;
      raise exception 'SCREENING_REVIEW_REQUIRED: %', v_position using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_screening_review() from public, anon, authenticated;
drop trigger if exists trg_enforce_screening_review on public.jobs;
create trigger trg_enforce_screening_review
  before update of status on public.jobs
  for each row execute function public.enforce_screening_review();

-- --- 5. Decyzja admina ---------------------------------------------------------------------
create or replace function public.admin_decide_screening_review(
  p_review_id uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_row public.screening_question_reviews;
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

  select * into v_row from public.screening_question_reviews where id = p_review_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- Inny admin zdecydował albo firma zmieniła treść pytania w międzyczasie.
  if v_row.status <> 'pending' then
    raise exception 'STALE_STATE: przegląd nie oczekuje na decyzję' using errcode = '42501';
  end if;
  if not exists (select 1 from public.job_screening_questions q
                   join public.jobs j on j.id = q.job_id and j.deleted_at is null
                  where q.job_id = v_row.job_id and q.content_fingerprint = v_row.content_fingerprint) then
    raise exception 'STALE_STATE: treści pytania nie ma już w ofercie' using errcode = '42501';
  end if;

  update public.screening_question_reviews
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason
   where id = p_review_id;

  perform public.write_audit('screening_question.reviewed', 'screening_question_review', p_review_id,
    jsonb_build_object('status', v_row.status),
    jsonb_strip_nulls(jsonb_build_object(
      'status', p_decision, 'reason', v_reason, 'job_id', v_row.job_id,
      'categories', to_jsonb(v_row.risk_categories))));

  select company_id into v_company from public.jobs where id = v_row.job_id;
  if v_row.requested_by is not null and v_company is not null
     and public.company_recipient_ok(v_company, v_row.requested_by) then
    insert into public.notifications (profile_id, type, title, entity_type, entity_id, data)
      values (v_row.requested_by, 'system'::public.notification_type, 'screening_review_decided',
              'job', v_row.job_id,
              jsonb_build_object('kind', 'screening_review', 'status', p_decision));
  end if;
end $$;
revoke all on function public.admin_decide_screening_review(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_screening_review(uuid, text, text) to authenticated;

-- --- 6. Pytania zapisane przed migracją ----------------------------------------------------
-- Strażnik 0093 blokuje UPDATE pytań ofert innych niż szkic — na czas przeliczenia wyłączony.
alter table public.job_screening_questions disable trigger trg_guard_screening_questions_draft;
update public.job_screening_questions set type = type where content_fingerprint is null;
alter table public.job_screening_questions enable trigger trg_guard_screening_questions_draft;
