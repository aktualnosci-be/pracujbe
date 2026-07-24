-- =============================================================================
-- supabase/tests/rls.sql — adwersaryjne asercje RLS/triggerów (uruchamiane przez
-- scripts/test-rls.sh na świeżej bazie z nałożonym shimem + wszystkimi migracjami).
--
-- Konwencja: KAŻDA nieudana asercja RAISE'uje wyjątek. Skrypt uruchamiany jest z
-- psql -v ON_ERROR_STOP=1, więc pierwszy błąd kończy proces kodem != 0 (fail CI).
--
-- „Logowanie" użytkownika: set role authenticated; set app.current_uid = '<uuid>'.
-- Operacje pisane idą przez RPC (SECURITY DEFINER) — jak w aplikacji. Weryfikacja
-- danych oraz próby bezpośredniego dostępu (RLS) wykonywane pod właściwą rolą.
--
-- Uwaga techniczna: psql NIE interpoluje zmiennych :'x' wewnątrz bloków $$...$$,
-- dlatego: (a) wartości statyczne wpisujemy literałami, (b) wartości „złapane" przez
-- \gset przenosimy do GUC (set_config) i czytamy przez current_setting w treści SQL,
-- (c) asercje wołamy jako polecenia TOP-LEVEL (pg_temp.assert / pg_temp.expect_error),
--     gdzie interpolacja :'x' działa normalnie.
-- =============================================================================
\set ON_ERROR_STOP on

-- --- Pomocnicze (SECURITY INVOKER => dynamiczny SQL działa z prawami bieżącej roli) ---
create function pg_temp.assert(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'ASSERT FAILED: %', p_name; end if;
end $$;

create function pg_temp.expect_error(p_sql text, p_pattern text, p_name text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like '%' || p_pattern || '%' then return; end if;
    raise exception '% : nieoczekiwany błąd (oczekiwano %): %', p_name, p_pattern, sqlerrm;
  end;
  raise exception '% : operacja powinna była zawieść (%), a się powiodła', p_name, p_pattern;
end $$;

\set CANDA '11111111-1111-1111-1111-111111111111'
\set CANDB '22222222-2222-2222-2222-222222222222'
\set EMPA  '33333333-3333-3333-3333-333333333333'
\set EMPB  '44444444-4444-4444-4444-444444444444'
\set EMPC  '66666666-6666-6666-6666-666666666666'
\set ADMIN '77777777-7777-7777-7777-777777777777'
\set COMPA 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set COMPB 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set COMPC 'cccccccc-cccc-cccc-cccc-cccccccccccc'
\set JOBA  'a1111111-1111-1111-1111-111111111111'
\set JOBB  'b1111111-1111-1111-1111-111111111111'
\set JOBC  'c1111111-1111-1111-1111-111111111111'

-- ---------------- SEED (jako superuser; profiles z triggera handle_new_user) ----------------
insert into auth.users(id,email,raw_user_meta_data) values
  (:'CANDA','canda@test.be','{"role":"candidate","first_name":"Anna","last_name":"K","locale":"pl"}'),
  (:'CANDB','candb@test.be','{"role":"candidate","first_name":"Bea","last_name":"L","locale":"nl"}'),
  (:'EMPA','empa@test.be','{"role":"employer","first_name":"Emp","last_name":"A","locale":"nl"}'),
  (:'EMPB','empb@test.be','{"role":"employer","first_name":"Emp","last_name":"B","locale":"fr"}'),
  (:'EMPC','empc@test.be','{"role":"employer","first_name":"Emp","last_name":"C","locale":"en"}'),
  (:'ADMIN','admin@test.be','{"role":"employer","first_name":"Ad","last_name":"Min","locale":"en"}');
-- Nadaj rolę admina (self-signup ogranicza do candidate/employer; admin tylko ręcznie).
update public.profiles set role = 'admin' where id = :'ADMIN';

insert into public.companies(id,name,status) values
  (:'COMPA','Firma A','verified'),
  (:'COMPB','Firma B','verified'),
  (:'COMPC','Firma C','unverified');

insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'COMPA',:'EMPA','owner',true),
  (:'COMPB',:'EMPB','owner',true),
  (:'COMPC',:'EMPC','owner',true);

insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'JOBA',:'COMPA','job-a','Magazynier A','warehouse','permanent','Antwerpia','Flandria','active','pl'),
  (:'JOBB',:'COMPB','job-b','Kierowca B','transport','permanent','Gandawa','Flandria','active','pl'),
  (:'JOBC',:'COMPC','job-c','Pomocnik C','construction','temporary','Liege','Walonia','active','pl');

insert into public.candidate_profiles(profile_id, is_searchable) values
  (:'CANDA', true), (:'CANDB', true);

-- CANDB aplikuje do JOBC (COMPC) — relacja firma–kandydat istnieje, ale firma jest unverified
-- (test D1 sprawdza bramkę weryfikacji, nie relacji). auth.uid()=null => trigger nie nadpisuje pól.
insert into public.applications(id, job_id, candidate_id, company_id, status)
  values ('cc000000-0000-0000-0000-0000000000cb', :'JOBC', :'CANDB', :'COMPC', 'submitted');

\echo '=================== RLS INTEGRATION TESTS ==================='

-- ============================================================================
-- A. Blokada anonimowego dostępu do tabel bazowych (0014) + dostęp przez RPC
-- ============================================================================
set role anon; reset app.current_uid;
select pg_temp.expect_error('select count(*) from public.companies', 'permission denied', 'A1 anon->companies');
select pg_temp.expect_error('select count(*) from public.jobs',      'permission denied', 'A2 anon->jobs');
select pg_temp.assert(
  (select count(*) from public.get_public_jobs('pl', p_limit => 50, p_offset => 0)) >= 2,
  'A3 anon get_public_jobs >=2');
reset role;

-- ============================================================================
-- B. Aplikowanie: idempotencja + izolacja między kandydatami
-- ============================================================================
set role authenticated; set app.current_uid = :'CANDA';
select public.apply_to_job(:'JOBA','idem-a-1',null,null,'Chetnie') as appa \gset
select public.apply_to_job(:'JOBA','idem-a-1',null,null,'Chetnie') as appa2 \gset
reset role; reset app.current_uid;
select set_config('my.appa', :'appa', false);

select pg_temp.assert(:'appa' is not null, 'B1 aplikacja utworzona');
select pg_temp.assert(:'appa' = :'appa2', 'B2 aplikowanie idempotentne');
select pg_temp.assert(
  (select count(*) from public.applications where job_id = :'JOBA' and candidate_id = :'CANDA') = 1,
  'B3 dokladnie jedna aplikacja CANDA->JOBA');

-- B4: CANDB nie widzi aplikacji do JOBA (RLS wiersza).
set role authenticated; set app.current_uid = :'CANDB';
select pg_temp.assert((select count(*) from public.applications where job_id = :'JOBA') = 0,
  'B4 CANDB nie widzi cudzej aplikacji');
reset role; reset app.current_uid;

-- B5: EMPA (członek firmy oferty) widzi aplikację do swojej oferty.
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.assert((select count(*) from public.applications where job_id = :'JOBA') = 1,
  'B5 EMPA widzi aplikacje do JOBA');
reset role; reset app.current_uid;

-- ============================================================================
-- C. Zmiana statusu aplikacji: tylko firma oferty (izolacja między firmami)
-- ============================================================================
set role authenticated; set app.current_uid = :'EMPB';
select pg_temp.expect_error(
  'select public.transition_application(current_setting(''my.appa'')::uuid, ''viewed'')',
  'PERMISSION_DENIED', 'C1 EMPB nie zmienia cudzej aplikacji');
reset role; reset app.current_uid;

set role authenticated; set app.current_uid = :'EMPA';
select public.transition_application(:'appa'::uuid, 'viewed');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.applications where id = :'appa') = 'viewed',
  'C2 status = viewed');
select pg_temp.assert(
  (select count(*) from public.application_status_history where application_id = :'appa') >= 1,
  'C2b historia statusu dopisana');

-- ============================================================================
-- D. Propozycje: wymóg firmy zweryfikowanej + idempotencja
-- ============================================================================
set role authenticated; set app.current_uid = :'EMPC';
select pg_temp.expect_error(
  'select public.send_offer(''c1111111-1111-1111-1111-111111111111''::uuid, ''22222222-2222-2222-2222-222222222222''::uuid, ''offc-1'', ''x'', null)',
  'COMPANY_NOT_VERIFIED', 'D1 firma unverified nie wysyla propozycji');
reset role; reset app.current_uid;

set role authenticated; set app.current_uid = :'EMPA';
select public.send_offer(:'JOBA'::uuid, :'CANDA'::uuid, 'offa-1', 'Zapraszamy', null) as offa \gset
select public.send_offer(:'JOBA'::uuid, :'CANDA'::uuid, 'offa-1', 'Zapraszamy', null) as offa2 \gset
reset role; reset app.current_uid;
select set_config('my.offa', :'offa', false);
select pg_temp.assert(:'offa' is not null, 'D2 propozycja utworzona');
select pg_temp.assert(:'offa' = :'offa2', 'D3 send_offer idempotentne');
select pg_temp.assert((select count(*) from public.offers where idempotency_key = 'offa-1') = 1,
  'D4 jedna propozycja dla klucza offa-1');
-- P2-03 (0049): propozycja bez jawnego terminu dostaje DOMYŚLNY expires_at (least(job,now()+30d)).
select pg_temp.assert((select expires_at is not null from public.offers where id = :'offa'),
  'D4b propozycja ma domyślny termin ważności (P2-03)');

-- D5: obcy kandydat nie odpowiada; właściwy kandydat akceptuje.
set role authenticated; set app.current_uid = :'CANDB';
select pg_temp.expect_error(
  'select public.respond_to_offer(current_setting(''my.offa'')::uuid, true)',
  'PERMISSION_DENIED', 'D5 obcy kandydat nie odpowiada na propozycje');
reset role; reset app.current_uid;

set role authenticated; set app.current_uid = :'CANDA';
select public.respond_to_offer(:'offa'::uuid, true);
reset role; reset app.current_uid;
select pg_temp.assert((select status::text from public.offers where id = :'offa') = 'accepted',
  'D6 propozycja accepted');

-- ============================================================================
-- E. Wiadomości (0016): tylko strony relacji; obcy zablokowany
-- ============================================================================
set role authenticated; set app.current_uid = :'CANDA';
select public.get_or_create_conversation(:'appa'::uuid, null) as conv \gset
reset role; reset app.current_uid;
select set_config('my.conv', :'conv', false);
select pg_temp.assert(:'conv' is not null, 'E1 konwersacja powstala');
select pg_temp.assert((select count(*) from public.conversation_members where conversation_id = :'conv') = 2,
  'E1b konwersacja ma 2 uczestnikow');

-- E2/E3: EMPB (obca firma) nie utworzy konwersacji dla cudzej aplikacji ani nie napisze.
set role authenticated; set app.current_uid = :'EMPB';
select pg_temp.expect_error(
  'select public.get_or_create_conversation(current_setting(''my.appa'')::uuid, null)',
  'PERMISSION_DENIED', 'E2 obca firma nie tworzy cudzej konwersacji');
select pg_temp.expect_error(
  'select public.send_message(current_setting(''my.conv'')::uuid, ''wtargniecie'')',
  'PERMISSION_DENIED', 'E3 obcy nie pisze w cudzej konwersacji');
reset role; reset app.current_uid;

-- E4: CANDA wysyła wiadomość; EMPA dostaje powiadomienie in-app.
set role authenticated; set app.current_uid = :'CANDA';
select public.send_message(:'conv'::uuid, 'Dzien dobry') as msg \gset
reset role; reset app.current_uid;
select pg_temp.assert(:'msg' is not null, 'E4 wiadomosc wyslana');
select pg_temp.assert(
  (select count(*) from public.notifications where profile_id = :'EMPA' and type='message_received') >= 1,
  'E4b EMPA ma powiadomienie message_received');

-- ============================================================================
-- F. Powiadomienia: użytkownik widzi tylko własne (RLS) + oznaczanie przeczytania
-- ============================================================================
set role authenticated; set app.current_uid = :'CANDB';
select pg_temp.assert((select count(*) from public.notifications) = 0, 'F1 CANDB widzi 0 powiadomien');
reset role; reset app.current_uid;

set role authenticated; set app.current_uid = :'EMPA';
select public.mark_notifications_read(null) as marked \gset
reset role; reset app.current_uid;
select pg_temp.assert(:marked >= 1, 'F2 EMPA oznaczyl >=1 powiadomienie');
select pg_temp.assert(
  (select count(*) from public.notifications where profile_id = :'EMPA' and read_at is null) = 0,
  'F3 brak nieprzeczytanych EMPA po oznaczeniu');

-- ============================================================================
-- G. Audit logs (0017): wrażliwe zmiany zapisane; klient nie czyta audit_logs
-- ============================================================================
-- G1: zmiana statusu aplikacji (C2: viewed) zapisana z actor_id = EMPA.
select pg_temp.assert(
  (select count(*) from public.audit_logs
     where action='application.status_changed' and entity_id = :'appa' and actor_id = :'EMPA') >= 1,
  'G1 audit application.status_changed (actor=EMPA)');
-- G2: propozycja wysłana (D2) + odpowiedź (D6) zapisane.
select pg_temp.assert(
  (select count(*) from public.audit_logs where action='offer.sent' and entity_id = :'offa') = 1,
  'G2 audit offer.sent');
select pg_temp.assert(
  (select count(*) from public.audit_logs
     where action='offer.status_changed' and entity_id = :'offa' and actor_id = :'CANDA') = 1,
  'G2b audit offer.status_changed (actor=CANDA)');
-- G3: utworzenie firm z seeda zapisane (3).
select pg_temp.assert(
  (select count(*) from public.audit_logs where action='company.created') = 3,
  'G3 audit company.created x3');
-- G4: authenticated NIE czyta audit_logs (RLS deny + revoke).
set role authenticated; set app.current_uid = :'CANDA';
select pg_temp.expect_error('select count(*) from public.audit_logs', 'permission denied', 'G4 klient nie czyta audit_logs');
reset role; reset app.current_uid;

-- ============================================================================
-- H. Admin (0019): is_admin, weryfikacja firm tylko admin, ochrona przed self-verify
-- ============================================================================
-- H1: is_admin() -> true dla admina, false dla kandydata.
set role authenticated; set app.current_uid = :'ADMIN';
select pg_temp.assert((select public.is_admin()) = true, 'H1 is_admin(admin)=true');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CANDA';
select pg_temp.assert((select public.is_admin()) = false, 'H1b is_admin(candidate)=false');
reset role; reset app.current_uid;

-- H2: admin weryfikuje COMPC (unverified -> verified).
set role authenticated; set app.current_uid = :'ADMIN';
select public.admin_set_company_status(:'COMPC'::uuid, 'verified');
reset role; reset app.current_uid;
select pg_temp.assert((select status::text from public.companies where id = :'COMPC') = 'verified',
  'H2 admin zweryfikował COMPC');
select pg_temp.assert(
  (select count(*) from public.audit_logs
     where action='company.status_changed' and entity_id = :'COMPC' and actor_id = :'ADMIN') = 1,
  'H2b audit company.status_changed (actor=ADMIN)');

-- H3: nie-admin (EMPB) NIE może użyć admin_set_company_status.
set role authenticated; set app.current_uid = :'EMPB';
select pg_temp.expect_error(
  'select public.admin_set_company_status(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''::uuid, ''suspended'')',
  'PERMISSION_DENIED', 'H3 nie-admin nie zmienia statusu firmy');
reset role; reset app.current_uid;

-- H4: właściciel firmy NIE może samodzielnie zweryfikować firmy (bezpośredni UPDATE).
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.expect_error(
  'update public.companies set status=''suspended'' where id=''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''',
  'PERMISSION_DENIED', 'H4 zmiana statusu firmy przez właściciela zablokowana');
reset role; reset app.current_uid;

-- ============================================================================
-- I. Remediacja audytu 0020: maszyna stanów w DB, relacja send_offer, opt-out e-mail
-- ============================================================================
-- Stan wejściowy: appa='viewed' (C2), offa='accepted' (D6).

-- I1: FIRMA nie sfałszuje odpowiedzi na propozycję bezpośrednim UPDATE. Po 0025 (granica
-- zaufania) bezpośredni DML jest odebrany `authenticated` na poziomie grantu — błąd pada
-- ZANIM zadziała trigger (mocniejsza gwarancja). Zostaje jako defense-in-depth.
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.expect_error(
  'update public.offers set status=''declined'' where id=current_setting(''my.offa'')::uuid',
  'permission denied', 'I1 firma nie ustawia accepted/declined oferty (PATCH → grant deny)');
reset role; reset app.current_uid;

-- I2: FIRMA nie przeskoczy aplikacji bezpośrednim UPDATE (po 0025 grant deny, wcześniej trigger).
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.expect_error(
  'update public.applications set status=''offer_accepted'' where id=current_setting(''my.appa'')::uuid',
  'permission denied', 'I2 firma nie robi bezpośredniego PATCH aplikacji (grant deny)');
reset role; reset app.current_uid;

-- I2b: kontrola — RPC transition_application do allow-listy nadal działa.
set role authenticated; set app.current_uid = :'EMPA';
select public.transition_application(:'appa'::uuid, 'shortlisted');
reset role; reset app.current_uid;
select pg_temp.assert((select status::text from public.applications where id = :'appa') = 'shortlisted',
  'I2b transition_application (allow-lista) działa');

-- I3: send_offer do NIEpowiązanego kandydata blokowany (P2#2). CANDB: bez aplikacji do COMPA,
-- profil is_searchable=true ale profile_completed=false -> brak relacji.
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.expect_error(
  'select public.send_offer(''a1111111-1111-1111-1111-111111111111''::uuid, ''22222222-2222-2222-2222-222222222222''::uuid, ''offb-x'', ''hej'', null)',
  'PERMISSION_DENIED', 'I3 send_offer bez relacji firma–kandydat blokowany');
reset role; reset app.current_uid;

-- I4: respond_to_offer na już rozstrzygniętej propozycji blokowany (P3#1). offa='accepted'.
set role authenticated; set app.current_uid = :'CANDA';
select pg_temp.expect_error(
  'select public.respond_to_offer(current_setting(''my.offa'')::uuid, false)',
  'VALIDATION_FAILED', 'I4 respond_to_offer na nieaktywnej propozycji blokowany');
reset role; reset app.current_uid;

-- I5: opt-out e-mail honorowany (P1#2). Wyłącz CANDA email_applications, zmień status -> brak maila.
update public.notification_preferences set email_applications = false where profile_id = :'CANDA';
set role authenticated; set app.current_uid = :'EMPA';
select public.transition_application(:'appa'::uuid, 'interview');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.email_deliveries
     where profile_id = :'CANDA' and template = 'statusChanged'
       and idempotency_key like '%interview%') = 0,
  'I5 opt-out email_applications honorowany (brak maila statusChanged)');
-- kontrola: powiadomienie in-app nadal powstaje (opt-out dotyczy tylko e-maila)
select pg_temp.assert(
  (select count(*) from public.notifications
     where profile_id = :'CANDA' and type = 'application_status_changed') >= 1,
  'I5b powiadomienie in-app nadal tworzone');

-- I6: profiles_insert_own nie pozwala nadać sobie roli admin (P3#2).
set role authenticated; set app.current_uid = '88888888-8888-8888-8888-888888888888';
select pg_temp.expect_error(
  'insert into public.profiles (id, role) values (''88888888-8888-8888-8888-888888888888'', ''admin'')',
  'new row violates', 'I6 self-insert roli admin blokowany przez RLS');
reset role; reset app.current_uid;

-- I7: get_conversation_summaries (0021) zwraca konwersację uczestnika z ostatnią wiadomością.
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.assert(
  (select count(*) from public.get_conversation_summaries()) >= 1,
  'I7 get_conversation_summaries zwraca konwersacje uczestnika');
reset role; reset app.current_uid;

-- I8: claim_email_batch (0021) atomowo claimuje kolejkę; drugi claim (dzierżawa) nie dubluje.
select pg_temp.assert((select count(*) from public.claim_email_batch(100)) >= 1,
  'I8 claim_email_batch zwraca zakolejkowane e-maile');
select pg_temp.assert((select count(*) from public.claim_email_batch(100)) = 0,
  'I8b drugi natychmiastowy claim nie zwraca tych samych wierszy (dzierżawa locked_at)');

-- I9: get_applied_jobs_display (0023) zwraca ofertę własnej aplikacji NIEZALEŻNIE od statusu
-- oferty. Zamykamy JOBC (status=closed → NIEwidoczna publicznie przez get_public_jobs); mimo to
-- CANDB (który aplikował) musi widzieć jej tytuł/firmę na liście „moje aplikacje" (fix P3 —
-- stare wzbogacanie mapą publiczną dawało tu pusty tytuł). Stan `closed` gwarantuje, że test
-- realnie sprawdza obejście filtra publicznego (H2 wcześniej zweryfikował COMPC).
update public.jobs set status = 'closed' where id = :'JOBC';
set role authenticated; set app.current_uid = :'CANDB';
select pg_temp.assert(
  (select count(*) from public.get_applied_jobs_display('pl')) = 1,
  'I9 get_applied_jobs_display zwraca tylko własne aplikacje (CANDB=1)');
select pg_temp.assert(
  (select title from public.get_applied_jobs_display('pl') where job_id = :'JOBC') = 'Pomocnik C',
  'I9b tytuł oferty widoczny mimo statusu closed (fix P3 pustych tytułów)');
select pg_temp.assert(
  (select company_name from public.get_applied_jobs_display('pl') where job_id = :'JOBC') = 'Firma C',
  'I9c nazwa firmy widoczna dla oferty własnej aplikacji');
reset role; reset app.current_uid;
-- kontrola: kandydat bez aplikacji (CANDA) nie widzi cudzych ofert przez to RPC.
set role authenticated; set app.current_uid = :'CANDA';
select pg_temp.assert(
  (select count(*) from public.get_applied_jobs_display('pl') where job_id = :'JOBC') = 0,
  'I9d RPC ograniczone do WŁASNYCH aplikacji (CANDA nie widzi JOBC)');
reset role; reset app.current_uid;

-- I10: get_job_match_profile (0024) zwraca profil dopasowania TYLKO dla ofert widocznych
-- publicznie (active + firma verified) — jak get_public_job. Świeża firma unverified + oferta
-- active (COMPD/JOBD) izoluje test od mutacji COMPC (H2). Personalizacja tylko dla authenticated.
insert into public.companies(id,name,status)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd','Firma D','unverified');
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale)
  values ('d1111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd',
          'job-d','Pakowacz D','warehouse','permanent','Brugia','Flandria','active','pl');
set role authenticated; set app.current_uid = :'CANDA';
select pg_temp.assert(
  (select count(*) from public.get_job_match_profile(:'JOBA')) = 1,
  'I10 get_job_match_profile zwraca profil dla oferty active+verified (JOBA)');
select pg_temp.assert(
  (select count(*) from public.get_job_match_profile('d1111111-1111-1111-1111-111111111111')) = 0,
  'I10b get_job_match_profile NIE zwraca oferty firmy unverified (JOBD)');
reset role; reset app.current_uid;
-- anon nie ma grantu do RPC — wywołanie kończy się błędem uprawnień.
set role anon; reset app.current_uid;
select pg_temp.expect_error(
  'select count(*) from public.get_job_match_profile(''a1111111-1111-1111-1111-111111111111'')',
  'permission denied', 'I10c anon nie może wołać get_job_match_profile');
reset role;

-- ============================================================================
-- J. Granica zaufania 0025 — RPC-only DML na tabelach procesowych (SEC-05/06/07)
-- ============================================================================
-- `authenticated` może TYLKO czytać (RLS) i mutować przez SECURITY DEFINER RPC.
-- Bezpośredni INSERT/UPDATE/DELETE musi być odrzucony na poziomie grantu.
set role authenticated; set app.current_uid = :'CANDA';
select pg_temp.expect_error(
  'insert into public.applications(job_id, candidate_id, company_id, status) values ('''
  || :'JOBB' || ''','''|| :'CANDA' ||''','''|| :'COMPB' ||''',''submitted'')',
  'permission denied', 'J1 authenticated nie robi bezpośredniego INSERT do applications');
select pg_temp.expect_error(
  'insert into public.offers(job_id, candidate_id, company_id, sender_id, status, idempotency_key) '
  || 'values ('''|| :'JOBA' ||''','''|| :'CANDA' ||''','''|| :'COMPA' ||''','''|| :'EMPA' ||''',''sent'',''x'')',
  'permission denied', 'J2 authenticated nie robi bezpośredniego INSERT do offers');
select pg_temp.expect_error(
  'insert into public.conversations(subject) values (''wtargniecie'')',
  'permission denied', 'J3 authenticated nie robi bezpośredniego INSERT do conversations');
select pg_temp.expect_error(
  'insert into public.messages(conversation_id, sender_id, body) values ('''
  || current_setting('my.conv') ||''','''|| :'CANDA' ||''',''bezpośrednio'')',
  'permission denied', 'J4 authenticated nie robi bezpośredniego INSERT do messages');
-- Niezmienność wysłanej wiadomości: właściciel nie może jej edytować/usunąć bezpośrednio (SEC-07).
select pg_temp.expect_error(
  'update public.messages set body=''zmiana'' where id='''|| :'msg' ||'''::uuid',
  'permission denied', 'J5 authenticated nie edytuje wysłanej wiadomości (PATCH deny)');
select pg_temp.expect_error(
  'delete from public.messages where id='''|| :'msg' ||'''::uuid',
  'permission denied', 'J6 authenticated nie usuwa wysłanej wiadomości (DELETE deny)');
select pg_temp.expect_error(
  'delete from public.conversation_members where conversation_id=current_setting(''my.conv'')::uuid',
  'permission denied', 'J6b authenticated nie usuwa uczestników bezpośrednio');
reset role; reset app.current_uid;

-- J7: withdraw_application (0025) — kandydat wycofuje WŁASNĄ aplikację przez RPC (bez DML).
set role authenticated; set app.current_uid = :'CANDA';
select pg_temp.assert(
  public.withdraw_application(:'appa'::uuid) = 'withdrawn',
  'J7 withdraw_application wycofuje własną aplikację');
select pg_temp.assert(
  public.withdraw_application(:'appa'::uuid) = 'withdrawn',
  'J7b withdraw_application idempotentne (drugie wywołanie bez błędu)');
reset role; reset app.current_uid;
-- Cudza aplikacja: CANDB nie może wycofać aplikacji CANDA (NOT_FOUND, brak dostępu).
set role authenticated; set app.current_uid = :'CANDB';
select pg_temp.expect_error(
  'select public.withdraw_application(current_setting(''my.appa'')::uuid)',
  'NOT_FOUND', 'J7c withdraw_application nie wycofa cudzej aplikacji');
reset role; reset app.current_uid;

-- J8: rate_limit_hit (SEC-01) odebrany anon/authenticated; działa dla service_role.
set role authenticated; set app.current_uid = :'CANDA';
select pg_temp.expect_error(
  'select public.rate_limit_hit(''k'', 5, 60)',
  'permission denied', 'J8 authenticated nie woła rate_limit_hit');
reset role; reset app.current_uid;
set role anon; reset app.current_uid;
select pg_temp.expect_error(
  'select public.rate_limit_hit(''k'', 5, 60)',
  'permission denied', 'J8b anon nie woła rate_limit_hit');
reset role;
set role service_role;
select pg_temp.assert(public.rate_limit_hit('svc-key', 5, 60) is true,
  'J8c service_role woła rate_limit_hit (limiter działa z backendu)');
reset role;

-- ============================================================================
-- K. Hardening publicznych/procesowych RPC 0026 (SEC-03 limity, SEC-04 długości)
-- ============================================================================
-- SEC-03: ogromny p_limit i długie wejścia nie wywracają zapytania (clamp/left).
set role anon; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.get_public_jobs('pl', p_limit => 999999, p_offset => 0)) >= 2,
  'K1 get_public_jobs z ogromnym limitem działa (clamp do 100)');
select pg_temp.assert(
  (select count(*) from public.get_public_jobs('pl', repeat('x', 5000), p_limit => 20)) = 0,
  'K1b get_public_jobs z bardzo długim keyword nie błądzi (left→100, brak dopasowań)');
select pg_temp.assert(
  (select count(*) from public.get_public_jobs('xx', p_limit => 20)) >= 2,
  'K1c nieznane locale nie psuje zapytania (allow-lista → pl)');
reset role;
-- SEC-04: twarde sufity długości egzekwowane przez CHECK niezależnie od ścieżki (nawet superuser).
select pg_temp.expect_error(
  'insert into public.messages(conversation_id, sender_id, body) values ('''
  || current_setting('my.conv') ||''','''|| :'CANDA' ||''', repeat(''a'', 5000))',
  'messages_body_len', 'K2 CHECK długości messages.body egzekwowany (path-independent)');
select pg_temp.expect_error(
  'update public.applications set message = repeat(''a'', 5000) where id = '''|| :'appa' ||'''::uuid',
  'applications_message_len', 'K2b CHECK długości applications.message egzekwowany');

-- ============================================================================
-- L. SEC-08 (0027) — były członek firmy traci dostęp do rozmów firmowych
-- ============================================================================
-- conv (get_or_create_conversation(appa)) należy do COMPA; uczestnicy: CANDA (kandydat)
-- + EMPA (aktywny owner COMPA). Dowód, że dostęp firmowy wygasa wraz z dezaktywacją.
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.assert(public.is_conversation_member(:'conv'::uuid) is true,
  'L0 aktywny członek firmy ma dostęp do rozmowy firmowej');
reset role; reset app.current_uid;

-- Dezaktywacja członkostwa EMPA (symulacja: admin firmy wyłącza pracownika).
update public.company_members set is_active = false where company_id = :'COMPA' and profile_id = :'EMPA';

set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.assert(public.is_conversation_member(:'conv'::uuid) is false,
  'L1 były członek (is_active=false) traci dostęp do rozmowy firmowej (SEC-08)');
reset role; reset app.current_uid;

-- Kandydat (strona nie-firmowa) zachowuje dostęp mimo zmian po stronie firmy.
set role authenticated; set app.current_uid = :'CANDA';
select pg_temp.assert(public.is_conversation_member(:'conv'::uuid) is true,
  'L2 kandydat zachowuje dostęp do własnej rozmowy');
reset role; reset app.current_uid;

-- Przywrócenie stanu (gdyby doszły kolejne asercje na EMPA).
update public.company_members set is_active = true where company_id = :'COMPA' and profile_id = :'EMPA';

-- ============================================================================
-- M. Persystencja relacji onboardingu 0028 (FUN-04) + RPC-only DML
-- ============================================================================
set role authenticated; set app.current_uid = :'CANDA';
-- Umiejętności: dedup (duplikat pomijany) + replace-all przy kolejnym zapisie.
select public.set_candidate_skills(array['Spawanie','Wózek widłowy','Spawanie']);
select pg_temp.assert(
  (select count(*) from public.candidate_skills cs
     join public.candidate_profiles cp on cp.id = cs.candidate_profile_id
    where cp.profile_id = :'CANDA') = 2,
  'M1 set_candidate_skills zapisuje umiejętności (dedup do 2)');
select public.set_candidate_skills(array['Prawo jazdy C']);
select pg_temp.assert(
  (select count(*) from public.candidate_skills cs
     join public.candidate_profiles cp on cp.id = cs.candidate_profile_id
    where cp.profile_id = :'CANDA') = 1,
  'M1b set_candidate_skills zastępuje poprzedni zestaw (replace-all)');
-- Języki z poziomem.
select public.set_candidate_languages('[{"language":"polski","level":"native"},{"language":"niderlandzki","level":"basic"}]'::jsonb);
select pg_temp.assert(
  (select count(*) from public.candidate_languages cl
     join public.candidate_profiles cp on cp.id = cl.candidate_profile_id
    where cp.profile_id = :'CANDA' and cl.level = 'native') = 1,
  'M2 set_candidate_languages zapisuje języki z poziomem');
-- Certyfikaty.
select public.set_candidate_certificates(array['VCA','HACCP']);
select pg_temp.assert(
  (select count(*) from public.candidate_certificates cc
     join public.candidate_profiles cp on cp.id = cc.candidate_profile_id
    where cp.profile_id = :'CANDA') = 2,
  'M3 set_candidate_certificates zapisuje certyfikaty');
-- RPC-only: bezpośredni INSERT do relacji odrzucony na poziomie grantu.
select pg_temp.expect_error(
  'insert into public.candidate_skills(candidate_profile_id, skill_label) values '
  || '((select id from public.candidate_profiles where profile_id = '''|| :'CANDA' ||'''::uuid), ''hack'')',
  'permission denied', 'M4 bezpośredni INSERT do candidate_skills odrzucony (RPC-only)');
reset role; reset app.current_uid;

-- ============================================================================
-- N. Kompletność onboardingu 0029 (FUN-05) — liczona w DB, klient nie ustawia flag
-- ============================================================================
set role authenticated; set app.current_uid = :'CANDA';
-- CANDA nie ma jeszcze occupations/categories/city/availability → profil niekompletny.
select pg_temp.assert(public.finish_onboarding() is false,
  'N1 finish_onboarding=false dla niekompletnego profilu');
select pg_temp.assert(
  (select profile_completed from public.candidate_profiles where profile_id = :'CANDA') is false,
  'N1b profile_completed=false ustawione przez DB');
-- Opt-in wyszukiwalności zablokowany dla niekompletnego profilu.
select pg_temp.expect_error('select public.set_candidate_searchable(true)',
  'VALIDATION_FAILED', 'N2 set_candidate_searchable(true) blokowany dla niekompletnego profilu');
-- Klient nie może wprost ustawić flag kompletności (kolumny odebrane, 0029).
select pg_temp.expect_error(
  'update public.candidate_profiles set profile_completed = true where profile_id = '''|| :'CANDA' ||'''::uuid',
  'PERMISSION_DENIED', 'N3 klient nie ustawia profile_completed bezpośrednio (guard trigger)');
-- (CANDA.is_searchable=true z seeda → zmiana na false jest realną zmianą, którą guard blokuje)
select pg_temp.expect_error(
  'update public.candidate_profiles set is_searchable = false where profile_id = '''|| :'CANDA' ||'''::uuid',
  'PERMISSION_DENIED', 'N3b klient nie ustawia is_searchable bezpośrednio (guard trigger)');
reset role; reset app.current_uid;

-- Uzupełnienie wymaganych danych (jak kroki 2/4/6; tu wprost jako superuser dla testu).
update public.candidate_profiles
  set occupations = array['spawacz'], categories = array['warehouse']::public.job_category[],
      city = 'Antwerpia', availability = 'immediate'
  where profile_id = :'CANDA';

set role authenticated; set app.current_uid = :'CANDA';
select pg_temp.assert(public.finish_onboarding() is true,
  'N4 finish_onboarding=true po uzupełnieniu wymaganych danych');
select pg_temp.assert(
  (select profile_completed from public.candidate_profiles where profile_id = :'CANDA') is true,
  'N4b profile_completed=true ustawione przez DB');
select pg_temp.assert(public.set_candidate_searchable(true) is true,
  'N5 opt-in wyszukiwalności działa dla kompletnego profilu');
select pg_temp.assert(
  (select is_searchable from public.candidate_profiles where profile_id = :'CANDA') is true,
  'N5b is_searchable ustawione przez RPC');
reset role; reset app.current_uid;

-- ============================================================================
-- O. Języki/certyfikaty oferty 0030 (FUN-03) — persystencja + detal + matching
-- ============================================================================
-- EMPA (członek COMPA, właściciel JOBA) dodaje wymagania językowe/certyfikatowe (jak kreator).
set role authenticated; set app.current_uid = :'EMPA';
insert into public.job_languages(job_id, language_label, level) values (:'JOBA', 'Niderlandzki', 'intermediate');
insert into public.job_certificates(job_id, certificate_label) values (:'JOBA', 'VCA');
select pg_temp.assert(
  (select 'Niderlandzki' = any(languages) from public.get_public_job('job-a', 'pl')),
  'O1 get_public_job zwraca języki oferty (koniec pustej listy, FUN-03)');
select pg_temp.assert(
  (select 'Niderlandzki' = any(languages) and 'VCA' = any(certificates)
     from public.get_job_match_profile(:'JOBA'::uuid)),
  'O2 get_job_match_profile zwraca języki i certyfikaty oferty (matching)');
reset role; reset app.current_uid;
-- O3: nie-członek firmy nie doda wymagania do cudzej oferty (RLS insert member).
set role authenticated; set app.current_uid = :'EMPB';
select pg_temp.expect_error(
  'insert into public.job_languages(job_id, language_label) values ('''|| :'JOBA' ||''',''hak'')',
  'row-level security', 'O3 nie-członek nie dodaje języka do cudzej oferty (RLS)');
reset role; reset app.current_uid;

-- ============================================================================
-- P. Transakcyjna publikacja oferty 0031 (FUN-01) — kompletność + active-only-RPC
-- ============================================================================
reset role;
insert into public.jobs(id, company_id, slug, title, category, contract_type, city, region, status, default_locale)
  values ('e1111111-1111-1111-1111-111111111111', :'COMPA', 'draft-e', 'draft placeholder',
          'warehouse', 'permanent', '', '', 'draft', 'pl');

-- P1: niekompletny szkic (placeholder title, puste miasto/region) nie przechodzi publikacji.
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.expect_error(
  'select public.publish_job(''e1111111-1111-1111-1111-111111111111''::uuid, ''op-x'')',
  'VALIDATION_FAILED', 'P1 publish_job odrzuca niekompletny szkic');
reset role; reset app.current_uid;

-- Uzupełnienie wymaganych danych (jak kreator: tytuł/miasto/region + tłumaczenie + wymaganie).
update public.jobs set title = 'Operator produkcji', city = 'Antwerpia', region = 'Flandria'
  where id = 'e1111111-1111-1111-1111-111111111111';
-- Tłumaczenie z NIEPUSTYM opisem i obowiązkami (P1-11: twardsza walidacja publikacji, 0042).
insert into public.job_translations(job_id, locale, title, description, responsibilities)
  values ('e1111111-1111-1111-1111-111111111111', 'pl', 'Operator produkcji',
          'Praca przy linii produkcyjnej w Antwerpii, system dwuzmianowy.',
          array['Obsługa maszyn', 'Kontrola jakości']);
insert into public.job_requirements(job_id, locale, kind, position, content)
  values ('e1111111-1111-1111-1111-111111111111', 'pl', 'mandatory', 0, 'Dyspozycyjność');

-- P2: kompletny szkic publikuje się (status → active).
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.assert(
  public.publish_job('e1111111-1111-1111-1111-111111111111'::uuid, 'operator-produkcji-abc') is not null,
  'P2 publish_job publikuje kompletny szkic');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.jobs where id = 'e1111111-1111-1111-1111-111111111111') = 'active',
  'P2b oferta aktywna po publish_job');

-- P3: klient nie aktywuje oferty bezpośrednim UPDATE (guard trigger). Świeży szkic.
reset role;
insert into public.jobs(id, company_id, slug, title, category, contract_type, city, region, status, default_locale)
  values ('e2222222-2222-2222-2222-222222222222', :'COMPA', 'draft-e2', 'Szkic 2',
          'warehouse', 'permanent', 'Gandawa', 'Flandria', 'draft', 'pl');
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.expect_error(
  'update public.jobs set status=''active'' where id=''e2222222-2222-2222-2222-222222222222''',
  'PERMISSION_DENIED', 'P3 klient nie aktywuje oferty bezpośrednim UPDATE (guard)');
reset role; reset app.current_uid;

-- P4: nie-członek nie opublikuje cudzego szkicu.
set role authenticated; set app.current_uid = :'EMPB';
select pg_temp.expect_error(
  'select public.publish_job(''e2222222-2222-2222-2222-222222222222''::uuid, ''x'')',
  'PERMISSION_DENIED', 'P4 nie-członek nie publikuje cudzej oferty');
reset role; reset app.current_uid;

-- ============================================================================
-- Q. Owner invariants 0032 (SEC-10) — ochrona właściciela firmy
-- ============================================================================
-- Setup: EMPC (owner COMPC) zostaje ADMINEM (nie-owner) w COMPA. EMPA to jedyny owner COMPA.
reset role;
insert into public.company_members(company_id, profile_id, role, is_active)
  values (:'COMPA', :'EMPC', 'admin', true);

-- Q1: admin (nie-owner) nie awansuje siebie na ownera (przejęcie firmy).
set role authenticated; set app.current_uid = :'EMPC';
select pg_temp.expect_error(
  'update public.company_members set role=''owner'' where company_id='''|| :'COMPA' ||''' and profile_id='''|| :'EMPC' ||'''',
  'PERMISSION_DENIED', 'Q1 admin nie awansuje siebie na ownera');
reset role; reset app.current_uid;

-- Q2: nie można zdemotować OSTATNIEGO aktywnego ownera (EMPA demote self).
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.expect_error(
  'update public.company_members set role=''admin'' where company_id='''|| :'COMPA' ||''' and profile_id='''|| :'EMPA' ||'''',
  'VALIDATION_FAILED', 'Q2 nie można zdemotować ostatniego ownera');

-- Q3: nie można usunąć OSTATNIEGO aktywnego ownera (EMPA delete self).
select pg_temp.expect_error(
  'delete from public.company_members where company_id='''|| :'COMPA' ||''' and profile_id='''|| :'EMPA' ||'''',
  'VALIDATION_FAILED', 'Q3 nie można usunąć ostatniego ownera');

-- Q4: owner MOŻE awansować innego członka do owner (transfer/współwłasność).
update public.company_members set role='owner' where company_id=:'COMPA' and profile_id=:'EMPC';
select pg_temp.assert(
  (select role::text from public.company_members where company_id=:'COMPA' and profile_id=:'EMPC') = 'owner',
  'Q4 owner awansuje innego członka do owner');
reset role; reset app.current_uid;

-- Q5: gdy jest już drugi aktywny owner (EMPC), pierwszy (EMPA) MOŻE zejść z roli.
set role authenticated; set app.current_uid = :'EMPA';
update public.company_members set role='admin' where company_id=:'COMPA' and profile_id=:'EMPA';
select pg_temp.assert(
  (select role::text from public.company_members where company_id=:'COMPA' and profile_id=:'EMPA') = 'admin',
  'Q5 owner może zejść z roli, gdy istnieje inny aktywny owner');
reset role; reset app.current_uid;

-- ============================================================================
-- R. Capability RBAC 0033 (SEC-09) — zarządzanie ofertami/PII tylko recruiter+
-- ============================================================================
-- CANDB zostaje ZWYKŁYM członkiem (member) COMPA. EMPC jest ownerem COMPA (z sekcji Q).
reset role;
insert into public.company_members(company_id, profile_id, role, is_active)
  values (:'COMPA', :'CANDB', 'member', true);

-- R1: plain member nie utworzy oferty firmy (can_manage_jobs=false → RLS with-check).
set role authenticated; set app.current_uid = :'CANDB';
select pg_temp.expect_error(
  'insert into public.jobs(company_id, slug, title, category, contract_type, city, region, status, default_locale) '
  || 'values ('''|| :'COMPA' ||''',''rbac-1'',''X'',''warehouse'',''permanent'',''Gent'',''Flandria'',''draft'',''pl'')',
  'row-level security', 'R1 plain member nie tworzy oferty (RBAC recruiter+)');
-- R2: plain member nie widzi PII kandydata firmy (mimo istniejącej aplikacji do COMPA).
select pg_temp.assert(public.company_can_view_candidate(:'CANDA'::uuid) is false,
  'R2 plain member nie widzi PII kandydata (recruiter+ only)');
select pg_temp.assert(public.can_manage_jobs(:'COMPA'::uuid) is false,
  'R2b plain member: can_manage_jobs=false');
reset role; reset app.current_uid;

-- R3: recruiter+ (EMPC owner COMPA) zarządza ofertami i widzi kandydatów z relacją.
set role authenticated; set app.current_uid = :'EMPC';
select pg_temp.assert(public.can_manage_jobs(:'COMPA'::uuid) is true,
  'R3 owner/recruiter zarządza ofertami');
select pg_temp.assert(public.company_can_view_candidate(:'CANDA'::uuid) is true,
  'R3b recruiter+ widzi PII kandydata z relacją (CANDA aplikował do COMPA)');
reset role; reset app.current_uid;

-- ============================================================================
-- S. Powiadomienia in-app respektują preferencje 0035 (SEC-16)
-- ============================================================================
-- CANDB wyłącza in-app; insert powiadomienia dla CANDB jest pomijany. CANDA (default true) wstawia.
update public.notification_preferences set in_app_enabled = false where profile_id = :'CANDB';
insert into public.notifications (profile_id, type, title, entity_type, entity_id)
  values (:'CANDB', 'application_status_changed', 'x', 'application', :'appa');
insert into public.notifications (profile_id, type, title, entity_type, entity_id)
  values (:'CANDA', 'application_status_changed', 'x', 'application', :'appa');
select pg_temp.assert(
  (select count(*) from public.notifications where profile_id = :'CANDB' and title = 'x') = 0,
  'S1 in_app_enabled=false → powiadomienie pominięte (SEC-16)');
select pg_temp.assert(
  (select count(*) from public.notifications where profile_id = :'CANDA' and title = 'x') = 1,
  'S1b in_app domyślnie włączone → powiadomienie utworzone');

-- ============================================================================
-- T. Dedup webhooków 0036 (SEC-14) — brak dostępu klienta + unikat id
-- ============================================================================
set role authenticated; reset app.current_uid;
select pg_temp.expect_error('select count(*) from public.processed_webhooks',
  'permission denied', 'T1 authenticated nie ma dostępu do processed_webhooks');
reset role;
-- Unikat id = dedup: drugi insert tego samego id odrzucony.
insert into public.processed_webhooks(id, source) values ('t:evt-1', 'test');
select pg_temp.expect_error(
  'insert into public.processed_webhooks(id, source) values (''t:evt-1'', ''test'')',
  'duplicate key', 'T2 duplikat id odrzucony (dedup replay)');

-- ============================================================================
-- U. C3 0037: propozycje/statusy wymagają recruiter+ (CANDB = member COMPA)
-- ============================================================================
set role authenticated; set app.current_uid = :'CANDB';
select pg_temp.expect_error(
  'select public.transition_application(current_setting(''my.appa'')::uuid, ''viewed'')',
  'PERMISSION_DENIED', 'U1 zwykły member nie zmienia statusu aplikacji (recruiter+)');
select pg_temp.expect_error(
  'select public.send_offer('''|| :'JOBA' ||'''::uuid, '''|| :'CANDA' ||'''::uuid, ''c3-x'', ''hej'', null)',
  'PERMISSION_DENIED', 'U2 zwykły member nie wysyła propozycji (recruiter+)');
reset role; reset app.current_uid;
-- Kontrola pozytywna: recruiter+ (EMPC owner COMPA) MOŻE zmienić status ŚWIEŻEJ aplikacji.
-- (appa jest już 'withdrawn' po J7 — stan końcowy; tworzymy nową aplikację CANDB->JOBA.)
set role authenticated; set app.current_uid = :'CANDB';
select public.apply_to_job(:'JOBA'::uuid, 'candb-joba-1', null, null, 'chętnie') as appcb \gset
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPC';
select public.transition_application(:'appcb'::uuid, 'viewed');  -- submitted->viewed OK
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.applications where id = :'appcb') = 'viewed',
  'U3 recruiter+ zmienia status aplikacji (transition_application)');

-- ============================================================================
-- V. Audyt produkcyjny 0039 (P1-01/P1-02) — ODCZYT rekrutacyjny i rozmowy: recruiter+
-- ============================================================================
-- CANDB = zwykły member COMPA; EMPC = owner (recruiter+) COMPA; EMPA = admin (recruiter+)
-- COMPA i uczestnik rozmowy :conv (utworzonej w sekcji I dla aplikacji appa); CANDA = kandydat.

-- V1: plain member NIE widzi aplikacji firmowej (P1-01; wcześniej: widział pełny rekord).
set role authenticated; set app.current_uid = :'CANDB';
select pg_temp.assert((select count(*) from public.applications where id = :'appa') = 0,
  'V1 plain member nie widzi aplikacji firmowej (recruiter+ only)');
select pg_temp.assert(public.can_access_application(:'appa'::uuid) is false,
  'V1b can_access_application=false dla plain member');
reset role; reset app.current_uid;

-- V2: recruiter+ (EMPC owner) widzi aplikację (P1-01 kontrola pozytywna).
set role authenticated; set app.current_uid = :'EMPC';
select pg_temp.assert((select count(*) from public.applications where id = :'appa') = 1,
  'V2 recruiter+ widzi aplikację firmową');
select pg_temp.assert(public.can_access_application(:'appa'::uuid) is true,
  'V2b can_access_application=true dla recruiter+');
reset role; reset app.current_uid;

-- V3: recruiter+ uczestnik (EMPA admin, aktywny) widzi podsumowanie rozmowy :conv.
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.assert(
  (select count(*) from public.get_conversation_summaries() where conversation_id = :'conv') = 1,
  'V3 recruiter+ uczestnik widzi podsumowanie rozmowy');
reset role; reset app.current_uid;

-- V4: dezaktywacja członkostwa EMPA (admin, NIE ostatni owner) → były członek.
reset role;
update public.company_members set is_active = false where company_id = :'COMPA' and profile_id = :'EMPA';

-- V4a: były członek (EMPA) NIE widzi podsumowań mimo historycznego wiersza uczestnika (P1-02).
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.assert(
  (select count(*) from public.get_conversation_summaries() where conversation_id = :'conv') = 0,
  'V4a były członek nie widzi podsumowań rozmowy (P1-02)');
select pg_temp.expect_error(
  'select public.send_message('''|| :'conv' ||'''::uuid, ''próba b. członka'')',
  'PERMISSION_DENIED', 'V4b były członek nie wysyła wiadomości w rozmowie');
reset role; reset app.current_uid;

-- V4c: kandydat (strona kandydata) NADAL widzi swoją rozmowę.
set role authenticated; set app.current_uid = :'CANDA';
select pg_temp.assert(
  (select count(*) from public.get_conversation_summaries() where conversation_id = :'conv') = 1,
  'V4c kandydat nadal widzi podsumowanie swojej rozmowy');
reset role; reset app.current_uid;

-- Przywróć EMPA (porządek dla ewentualnych kolejnych sekcji).
reset role;
update public.company_members set is_active = true where company_id = :'COMPA' and profile_id = :'EMPA';

-- ============================================================================
-- W. Audyt produkcyjny 0040 (P1-03/P1-04/P1-05/P1-06)
-- ============================================================================
-- P1-03: edycja danych firmy tylko owner/admin (CANDB=member, EMPC=owner COMPA).
-- Uwaga: RLS UPDATE z fałszywym USING trafia 0 wierszy (bez błędu) — sprawdzamy brak zmiany.
set role authenticated; set app.current_uid = :'CANDB';
update public.companies set name = 'Hack' where id = :'COMPA';
reset role; reset app.current_uid;
select pg_temp.assert(
  (select name from public.companies where id = :'COMPA') <> 'Hack',
  'W1 plain member nie zmienia danych firmy (P1-03; UPDATE trafia 0 wierszy)');
set role authenticated; set app.current_uid = :'EMPC';
update public.companies set name = 'Firma A (edit)' where id = :'COMPA';
reset role; reset app.current_uid;
select pg_temp.assert(
  (select name from public.companies where id = :'COMPA') = 'Firma A (edit)',
  'W2 owner/admin edytuje dane firmy (P1-03)');

-- P1-04: konto pracodawcy nie aplikuje ani nie zakłada profilu kandydata (EMPB role=employer).
set role authenticated; set app.current_uid = :'EMPB';
select pg_temp.expect_error(
  'select public.apply_to_job('''|| :'JOBB' ||'''::uuid, ''emp-apply'', null, null, ''x'')',
  'PERMISSION_DENIED', 'W3 pracodawca nie aplikuje (rola candidate wymagana, P1-04)');
select pg_temp.expect_error(
  'select public.set_candidate_skills(array[''x''])',
  'PERMISSION_DENIED', 'W3b pracodawca nie zakłada profilu kandydata (P1-04)');
reset role; reset app.current_uid;

-- P1-05: maszyna stanów aplikacji (appcb='viewed' po sekcji U3; EMPC=recruiter+ COMPA).
set role authenticated; set app.current_uid = :'EMPC';
select pg_temp.expect_error(
  'select public.transition_application('''|| :'appcb' ||'''::uuid, ''withdrawn'')',
  'VALIDATION_FAILED', 'W4 status docelowy poza allow-listą odrzucony (P1-05)');
select public.transition_application(:'appcb'::uuid, 'rejected');  -- viewed->rejected OK
select pg_temp.expect_error(
  'select public.transition_application('''|| :'appcb' ||'''::uuid, ''hired'')',
  'VALIDATION_FAILED', 'W5 stan końcowy bez wyjścia: rejected->hired zablokowane (P1-05)');
reset role; reset app.current_uid;

-- P1-06: wycofanie tylko ze stanów aktywnych.
set role authenticated; set app.current_uid = :'CANDB';
select pg_temp.expect_error(  -- appcb='rejected' (końcowy) → kandydat nie wycofa
  'select public.withdraw_application('''|| :'appcb' ||'''::uuid)',
  'VALIDATION_FAILED', 'W6 nie można wycofać aplikacji w stanie końcowym (P1-06)');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CANDA';
select public.apply_to_job(:'JOBB'::uuid, 'cand-jobb-1', null, null, 'chętnie') as appjb \gset
select public.withdraw_application(:'appjb'::uuid) as wres \gset
select pg_temp.assert(:'wres' = 'withdrawn', 'W7 wycofanie aplikacji aktywnej OK (P1-06)');
reset role; reset app.current_uid;

-- ============================================================================
-- X. Audyt produkcyjny 0041 (P1-23) — idempotencja aktywnej pary + wygaśnięcie propozycji
-- ============================================================================
-- EMPC = recruiter+ COMPA; CANDA związany z COMPA (aplikacja appa). Brak aktywnej propozycji.
set role authenticated; set app.current_uid = :'EMPC';
select public.send_offer(:'JOBA'::uuid, :'CANDA'::uuid, 'x-off-key-1', 'Zapraszamy', null) as xoff1 \gset
-- Inny klucz idempotencji, TA SAMA aktywna para → zwraca ISTNIEJĄCĄ propozycję (bez dubletu).
select public.send_offer(:'JOBA'::uuid, :'CANDA'::uuid, 'x-off-key-2', 'Ponownie', null) as xoff2 \gset
reset role; reset app.current_uid;
select pg_temp.assert(:'xoff1' = :'xoff2',
  'X1 idempotencja po aktywnej parze (inny klucz → ta sama propozycja)');
select pg_temp.assert(
  (select count(*) from public.offers
     where job_id = :'JOBA' and candidate_id = :'CANDA' and status in ('sent','viewed')) = 1,
  'X1b dokładnie jedna aktywna propozycja na parę (partial unique)');

-- Wygaśnięcie: ustaw expires_at w przeszłości i spróbuj zaakceptować (kandydat).
reset role;
update public.offers set expires_at = now() - interval '1 day' where id = :'xoff1';
set role authenticated; set app.current_uid = :'CANDA';
select pg_temp.expect_error(
  'select public.respond_to_offer('''|| :'xoff1' ||'''::uuid, true)',
  'VALIDATION_FAILED', 'X2 wygasłej propozycji nie można zaakceptować (P1-23)');
reset role; reset app.current_uid;

-- ============================================================================
-- Y. Audyt produkcyjny 0043 (P1-24) — receipt zgód RPC-only (koniec floodowania)
-- ============================================================================
-- Y1: klient nie zapisuje wprost do consents (bezpośredni INSERT odebrany).
set role authenticated; reset app.current_uid;
select pg_temp.expect_error(
  'insert into public.consents(category, granted) values (''analytics'', true)',
  'permission denied', 'Y1 authenticated nie robi bezpośredniego INSERT do consents');
reset role;
-- Y2: record_consent (anon) zapisuje 4 kategorie z metadanymi receiptu.
set role anon; reset app.current_uid;
select public.record_consent('{"analytics":true,"marketing":false,"preferences":true}'::jsonb,
  'cookie_banner', 'vis-123', '203.0.113.7', 'UA/1.0');
reset role;
select pg_temp.assert(
  (select count(*) from public.consents where visitor_id = 'vis-123') = 4,
  'Y2 record_consent zapisuje 4 kategorie (receipt)');
select pg_temp.assert(
  (select granted from public.consents where visitor_id = 'vis-123' and category = 'necessary') = true,
  'Y2b necessary zawsze granted');
select pg_temp.assert(
  (select granted from public.consents where visitor_id = 'vis-123' and category = 'marketing') = false,
  'Y2c marketing=false zapisane w receipcie');
select pg_temp.assert(
  (select host(ip_address) from public.consents where visitor_id = 'vis-123' limit 1) = '203.0.113.7',
  'Y2d IP zapisane w receipcie');

-- ============================================================================
-- Z. Audyt produkcyjny 0045 (P1-15) — realizacja kodów rabatowych (rezerwacja + limit)
-- ============================================================================
reset role;
insert into public.discount_codes(id, code, percent_off, max_redemptions, is_active)
  values ('dc000000-0000-0000-0000-0000000000dc', 'ZTEST10', 10, 1, true);

-- Z1: klient nie ma dostępu do tabeli realizacji (RPC-only).
set role authenticated; reset app.current_uid;
select pg_temp.expect_error('select count(*) from public.discount_redemptions',
  'permission denied', 'Z1 authenticated nie widzi discount_redemptions');
reset role;

-- Z2: rezerwacja (service_role) zwraca zniżkę; ponowna dla tej samej firmy jest idempotentna.
set role service_role;
select (public.reserve_discount('ZTEST10', :'COMPA') ->> 'percent_off') as z_pct \gset
select public.reserve_discount('ZTEST10', :'COMPA'); -- idempotentny retry (bez błędu, bez dubletu)
reset role;
select pg_temp.assert(:'z_pct' = '10', 'Z2 reserve_discount zwraca zniżkę 10%');
select pg_temp.assert(
  (select count(*) from public.discount_redemptions
     where company_id = :'COMPA' and discount_code_id = 'dc000000-0000-0000-0000-0000000000dc') = 1,
  'Z2b jedna rezerwacja mimo retry (idempotencja per firma)');

-- Z3: limit=1 wyczerpany → inna firma nie zarezerwuje.
set role service_role;
select pg_temp.expect_error(
  'select public.reserve_discount(''ZTEST10'', '''|| :'COMPB' ||''')',
  'VALIDATION_FAILED', 'Z3 limit wykorzystania kodu (druga firma odrzucona)');
reset role;

-- Z4: finalizacja inkrementuje times_redeemed; po niej ta firma nie zarezerwuje ponownie.
set role service_role;
select public.finalize_discount('dc000000-0000-0000-0000-0000000000dc', :'COMPA', 'sess-1');
select pg_temp.expect_error(
  'select public.reserve_discount(''ZTEST10'', '''|| :'COMPA' ||''')',
  'VALIDATION_FAILED', 'Z4 kod już zrealizowany przez firmę (finalized)');
reset role;
select pg_temp.assert(
  (select times_redeemed from public.discount_codes where id = 'dc000000-0000-0000-0000-0000000000dc') = 1,
  'Z4b times_redeemed=1 po finalizacji');

-- ============================================================================
-- AA. Audyt produkcyjny 0046 (P1-12) — filtry/sort/paginacja get_public_jobs w SQL
-- ============================================================================
set role anon; reset app.current_uid;
-- AA1: filtr kategorii zwraca wyłącznie oferty tej kategorii (JOBA = warehouse, publiczna).
select pg_temp.assert(
  (select bool_and(category = 'warehouse')
     from public.get_public_jobs('pl', p_categories => array['warehouse'], p_limit => 100)),
  'AA1 p_categories filtruje po kategorii');
-- AA2: licznik spójny z listą dla tego samego filtra.
select pg_temp.assert(
  (select count(*)::bigint from public.get_public_jobs('pl', p_categories => array['warehouse'], p_limit => 100))
    = public.get_public_jobs_count('pl', p_categories => array['warehouse']),
  'AA2 licznik spójny z listą (filtr kategorii)');
-- AA3: sort po wynagrodzeniu nie błądzi i zwraca rekordy.
select pg_temp.assert(
  (select count(*) from public.get_public_jobs('pl', p_sort => 'salary', p_limit => 100)) >= 1,
  'AA3 sort=salary działa');
-- AA4: widełki — oferty BEZ podanego wynagrodzenia nie są wykluczane (semantyka jak w UI).
select pg_temp.assert(
  (select count(*) from public.get_public_jobs('pl', p_salary_min => 999999, p_limit => 100)) >= 1,
  'AA4 widełki nie wykluczają ofert bez wynagrodzenia');
reset role;

-- ============================================================================
-- BB. Audyt produkcyjny 0047 (P1-09) — atomowe RPC replace relacji oferty (recruiter+)
-- ============================================================================
-- EMPA (recruiter+ COMPA, właściciel JOBA) zastępuje języki atomowo (JOBA miało 'Niderlandzki').
set role authenticated; set app.current_uid = :'EMPA';
select public.set_job_languages(:'JOBA'::uuid, '[{"language":"Francuski","level":"basic"}]'::jsonb);
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.job_languages where job_id = :'JOBA') = 1
    and (select language_label from public.job_languages where job_id = :'JOBA' limit 1) = 'Francuski',
  'BB1 set_job_languages zastępuje atomowo (replace-all)');

-- BB2: zwykły member (CANDB w COMPA) nie zapisze relacji oferty (recruiter+ only).
set role authenticated; set app.current_uid = :'CANDB';
select pg_temp.expect_error(
  'select public.set_job_skills('''|| :'JOBA' ||'''::uuid, true, array[''x''])',
  'PERMISSION_DENIED', 'BB2 zwykły member nie zapisuje relacji oferty (recruiter+)');
reset role; reset app.current_uid;

-- ============================================================================
-- CC. AUDIT_REPORT 0048 (P1-11) — wygasłe oferty znikają publicznie i blokują apply
-- ============================================================================
reset role;
update public.jobs set expires_at = now() - interval '1 day' where id = :'JOBA';

set role anon; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.get_public_job('job-a', 'pl')) = 0,
  'CC1 wygasła oferta nie ma detalu publicznego (get_public_job)');
select pg_temp.assert(
  (select count(*) from public.get_public_jobs('pl', p_limit => 100) where slug = 'job-a') = 0,
  'CC2 wygasła oferta znika z listy publicznej (get_public_jobs)');
reset role;
select pg_temp.assert(public.job_is_public(:'JOBA'::uuid) is false,
  'CC3 job_is_public=false dla wygasłej oferty (blokuje apply_to_job)');

-- ============================================================================
-- DD. AUDIT_REPORT 0050 (P0-02) — serwerowa idempotencja checkoutu (checkout_intents)
-- ============================================================================
-- DD1: DML na checkout_intents odebrany anon/authenticated (RPC-only).
set role authenticated; set app.current_uid = :'EMPA';
select pg_temp.expect_error(
  'insert into public.checkout_intents (company_id, plan) values ('''|| :'COMPA' ||''', ''standard'')',
  'permission denied', 'DD1 authenticated nie pisze checkout_intents (RPC-only)');
select pg_temp.expect_error(
  'select public.begin_checkout('''|| :'COMPA' ||'''::uuid, ''standard'')',
  'permission denied', 'DD1b begin_checkout tylko service_role');
reset role; reset app.current_uid;

-- DD2: begin_checkout tworzy 'pending'; drugi otwarty dla tej samej firmy → CHECKOUT_IN_PROGRESS.
set role service_role;
select public.begin_checkout(:'COMPA'::uuid, 'standard') as cintent \gset
select pg_temp.assert(:'cintent' is not null, 'DD2 begin_checkout zwraca intent_id');
-- (rola nadal service_role) expect_error wywoła begin_checkout jako service_role.
select pg_temp.expect_error(
  'select public.begin_checkout('''|| :'COMPA' ||'''::uuid, ''standard'')',
  'CHECKOUT_IN_PROGRESS', 'DD3 drugi otwarty checkout tej samej firmy odrzucony');
reset role;

-- DD4: complete_checkout domyka 'pending'→'completed' (idempotentnie); po tym nowy checkout możliwy.
set role service_role;
select public.complete_checkout(:'cintent'::uuid, 'sess-cc-1');
select public.complete_checkout(:'cintent'::uuid, 'sess-cc-1'); -- idempotentny reprocessing
reset role;
select pg_temp.assert(
  (select status from public.checkout_intents where id = :'cintent') = 'completed',
  'DD4 complete_checkout oznacza completed');
set role service_role;
select public.begin_checkout(:'COMPA'::uuid, 'standard') as cintent2 \gset
reset role;
select pg_temp.assert(:'cintent2' is not null and :'cintent2' <> :'cintent',
  'DD5 po ukończeniu można rozpocząć nowy checkout');

-- DD6: aktywna subskrypcja blokuje begin_checkout (ACTIVE_SUBSCRIPTION).
set role service_role;
select public.release_checkout_intent(:'cintent2'::uuid); -- zwolnij otwarty, by test dotyczył sub
insert into public.subscriptions (company_id, plan, status, provider)
  values (:'COMPA', 'standard', 'active', 'stripe');
-- (rola nadal service_role) begin_checkout jako service_role — powinno odrzucić przez aktywną sub.
select pg_temp.expect_error(
  'select public.begin_checkout('''|| :'COMPA' ||'''::uuid, ''standard'')',
  'ACTIVE_SUBSCRIPTION', 'DD6 aktywna subskrypcja blokuje nowy checkout');
-- sprzątanie: usuń testową subskrypcję, by nie zaburzać ewentualnych kolejnych sekcji
delete from public.subscriptions where company_id = :'COMPA' and provider = 'stripe' and status = 'active';
reset role;

\echo '=================== ALL RLS TESTS PASSED ==================='
