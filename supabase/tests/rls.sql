-- =============================================================================
-- supabase/tests/rls.sql — adwersaryjne asercje RLS/triggerów (uruchamiane przez
-- scripts/test-rls.sh na świeżej bazie z produkcyjnym bootstrapem ról + wszystkimi migracjami).
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

-- Strażnik roli: po KAŻDYM przełączeniu na rolę klienta potwierdzamy current_user,
-- brak ścieżki do właściciela tabel/SUPERUSER/BYPASSRLS i row_security=on
-- (supabase/tests/role-assert.sql; kontrole ujemne w role-guard.sql).
\ir role-assert.sql

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
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'CANDA','canda@test.be','Anna K','{"role":"candidate","first_name":"Anna","last_name":"K","locale":"pl"}'),
  (:'CANDB','candb@test.be','Bea L','{"role":"candidate","first_name":"Bea","last_name":"L","locale":"nl"}'),
  (:'EMPA','empa@test.be','Emp A','{"role":"employer","first_name":"Emp","last_name":"A","locale":"nl"}'),
  (:'EMPB','empb@test.be','Emp B','{"role":"employer","first_name":"Emp","last_name":"B","locale":"fr"}'),
  (:'EMPC','empc@test.be','Emp C','{"role":"employer","first_name":"Emp","last_name":"C","locale":"en"}'),
  (:'ADMIN','admin@test.be','Ad Min','{"role":"employer","first_name":"Ad","last_name":"Min","locale":"en"}');
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
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.expect_error('select count(*) from public.companies', 'permission denied', 'A1 anon->companies');
select pg_temp.expect_error('select count(*) from public.jobs',      'permission denied', 'A2 anon->jobs');
select pg_temp.assert(
  (select count(*) from public.get_public_jobs('pl', p_limit => 50, p_offset => 0)) >= 2,
  'A3 anon get_public_jobs >=2');
reset role;

-- ============================================================================
-- B. Aplikowanie: idempotencja + izolacja między kandydatami
-- ============================================================================
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select public.apply_to_job(:'JOBA','idem-a-1',null,null,'Chetnie') as appa \gset
select public.apply_to_job(:'JOBA','idem-a-1',null,null,'Chetnie') as appa2 \gset
reset role; reset app.current_uid;
select set_config('my.appa', :'appa', false);

select pg_temp.assert(:'appa' is not null, 'B1 aplikacja utworzona');
select pg_temp.assert(:'appa' = :'appa2', 'B2 aplikowanie idempotentne');
select pg_temp.assert(
  (select count(*) from public.applications where job_id = :'JOBA' and candidate_id = :'CANDA') = 1,
  'B3 dokladnie jedna aplikacja CANDA->JOBA');
-- B3b/B3c (0071, #361): nowa próba z INNYM kluczem na tę samą ofertę → APPLICATION_ALREADY_EXISTS
-- (nie fałszywy sukces), bez drugiego wiersza. Kontrola ujemna do B2 (ten sam klucz = sukces).
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.apply_to_job('''|| :'JOBA' ||'''::uuid, ''idem-a-2'', null, null, null)',
  'APPLICATION_ALREADY_EXISTS', 'B3b ponowna aplikacja innym kluczem odrzucona');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.applications where job_id = :'JOBA' and candidate_id = :'CANDA') = 1,
  'B3c po odrzuconej ponownej aplikacji nadal jedna aplikacja');

-- B4: CANDB nie widzi aplikacji do JOBA (RLS wiersza).
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.applications where job_id = :'JOBA') = 0,
  'B4 CANDB nie widzi cudzej aplikacji');
reset role; reset app.current_uid;

-- B5: EMPA (członek firmy oferty) widzi aplikację do swojej oferty.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.applications where job_id = :'JOBA') = 1,
  'B5 EMPA widzi aplikacje do JOBA');
reset role; reset app.current_uid;

-- ============================================================================
-- C. Zmiana statusu aplikacji: tylko firma oferty (izolacja między firmami)
-- ============================================================================
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.transition_application(current_setting(''my.appa'')::uuid, ''viewed'')',
  'PERMISSION_DENIED', 'C1 EMPB nie zmienia cudzej aplikacji');
reset role; reset app.current_uid;

set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'EMPC'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.send_offer(''c1111111-1111-1111-1111-111111111111''::uuid, ''22222222-2222-2222-2222-222222222222''::uuid, ''offc-1'', ''x'', null)',
  'COMPANY_NOT_VERIFIED', 'D1 firma unverified nie wysyla propozycji');
reset role; reset app.current_uid;

set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.respond_to_offer(current_setting(''my.offa'')::uuid, true)',
  'PERMISSION_DENIED', 'D5 obcy kandydat nie odpowiada na propozycje');
reset role; reset app.current_uid;

set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select public.respond_to_offer(:'offa'::uuid, true);
reset role; reset app.current_uid;
select pg_temp.assert((select status::text from public.offers where id = :'offa') = 'accepted',
  'D6 propozycja accepted');

-- ============================================================================
-- E. Wiadomości (0016): tylko strony relacji; obcy zablokowany
-- ============================================================================
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select public.get_or_create_conversation(:'appa'::uuid, null) as conv \gset
reset role; reset app.current_uid;
select set_config('my.conv', :'conv', false);
select pg_temp.assert(:'conv' is not null, 'E1 konwersacja powstala');
select pg_temp.assert((select count(*) from public.conversation_members where conversation_id = :'conv') = 2,
  'E1b konwersacja ma 2 uczestnikow');

-- E2/E3: EMPB (obca firma) nie utworzy konwersacji dla cudzej aplikacji ani nie napisze.
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.get_or_create_conversation(current_setting(''my.appa'')::uuid, null)',
  'PERMISSION_DENIED', 'E2 obca firma nie tworzy cudzej konwersacji');
select pg_temp.expect_error(
  'select public.send_message(current_setting(''my.conv'')::uuid, ''wtargniecie'', gen_random_uuid())',
  'PERMISSION_DENIED', 'E3 obcy nie pisze w cudzej konwersacji');
reset role; reset app.current_uid;

-- E4: CANDA wysyła wiadomość; EMPA dostaje powiadomienie in-app.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select public.send_message(:'conv'::uuid, 'Dzien dobry', gen_random_uuid()) as msg \gset
reset role; reset app.current_uid;
select pg_temp.assert(:'msg' is not null, 'E4 wiadomosc wyslana');
select pg_temp.assert(
  (select count(*) from public.notifications where profile_id = :'EMPA' and type='message_received') >= 1,
  'E4b EMPA ma powiadomienie message_received');

-- ============================================================================
-- F. Powiadomienia: użytkownik widzi tylko własne (RLS) + oznaczanie przeczytania
-- ============================================================================
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.notifications) = 0, 'F1 CANDB widzi 0 powiadomien');
reset role; reset app.current_uid;

set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select count(*) from public.audit_logs', 'permission denied', 'G4 klient nie czyta audit_logs');
reset role; reset app.current_uid;

-- ============================================================================
-- H. Admin (0019): is_admin, weryfikacja firm tylko admin, ochrona przed self-verify
-- ============================================================================
-- H1: is_admin() -> true dla admina, false dla kandydata.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.assert((select public.is_admin()) = true, 'H1 is_admin(admin)=true');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.assert((select public.is_admin()) = false, 'H1b is_admin(candidate)=false');
reset role; reset app.current_uid;

-- H2: admin weryfikuje COMPC (unverified -> verified).
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_set_company_status(:'COMPC'::uuid, 'verified');
reset role; reset app.current_uid;
select pg_temp.assert((select status::text from public.companies where id = :'COMPC') = 'verified',
  'H2 admin zweryfikował COMPC');
select pg_temp.assert(
  (select count(*) from public.audit_logs
     where action='company.status_changed' and entity_id = :'COMPC' and actor_id = :'ADMIN') = 1,
  'H2b audit company.status_changed (actor=ADMIN)');

-- H3: nie-admin (EMPB) NIE może użyć admin_set_company_status.
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_set_company_status(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''::uuid, ''suspended'')',
  'PERMISSION_DENIED', 'H3 nie-admin nie zmienia statusu firmy');
reset role; reset app.current_uid;

-- H4: właściciel firmy NIE może samodzielnie zweryfikować firmy (bezpośredni UPDATE).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'update public.offers set status=''declined'' where id=current_setting(''my.offa'')::uuid',
  'permission denied', 'I1 firma nie ustawia accepted/declined oferty (PATCH → grant deny)');
reset role; reset app.current_uid;

-- I2: FIRMA nie przeskoczy aplikacji bezpośrednim UPDATE (po 0025 grant deny, wcześniej trigger).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'update public.applications set status=''offer_accepted'' where id=current_setting(''my.appa'')::uuid',
  'permission denied', 'I2 firma nie robi bezpośredniego PATCH aplikacji (grant deny)');
reset role; reset app.current_uid;

-- I2b: kontrola — RPC transition_application do allow-listy nadal działa.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.transition_application(:'appa'::uuid, 'shortlisted');
reset role; reset app.current_uid;
select pg_temp.assert((select status::text from public.applications where id = :'appa') = 'shortlisted',
  'I2b transition_application (allow-lista) działa');

-- I3: send_offer do NIEpowiązanego kandydata blokowany (P2#2). CANDB: bez aplikacji do COMPA,
-- profil is_searchable=true ale profile_completed=false -> brak relacji.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.send_offer(''a1111111-1111-1111-1111-111111111111''::uuid, ''22222222-2222-2222-2222-222222222222''::uuid, ''offb-x'', ''hej'', null)',
  'PERMISSION_DENIED', 'I3 send_offer bez relacji firma–kandydat blokowany');
reset role; reset app.current_uid;

-- I4: respond_to_offer na już rozstrzygniętej propozycji blokowany (P3#1). offa='accepted'.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.respond_to_offer(current_setting(''my.offa'')::uuid, false)',
  'VALIDATION_FAILED', 'I4 respond_to_offer na nieaktywnej propozycji blokowany');
reset role; reset app.current_uid;

-- I5: opt-out e-mail honorowany (P1#2). Wyłącz CANDA email_applications, zmień status -> brak maila.
update public.notification_preferences set email_applications = false where profile_id = :'CANDA';
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = '88888888-8888-8888-8888-888888888888'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'insert into public.profiles (id, role) values (''88888888-8888-8888-8888-888888888888'', ''admin'')',
  'new row violates', 'I6 self-insert roli admin blokowany przez RLS');
reset role; reset app.current_uid;

-- I7: get_conversation_summaries (0021) zwraca konwersację uczestnika z ostatnią wiadomością.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.get_job_match_profile(:'JOBA')) = 1,
  'I10 get_job_match_profile zwraca profil dla oferty active+verified (JOBA)');
select pg_temp.assert(
  (select count(*) from public.get_job_match_profile('d1111111-1111-1111-1111-111111111111')) = 0,
  'I10b get_job_match_profile NIE zwraca oferty firmy unverified (JOBD)');
reset role; reset app.current_uid;
-- anon nie ma grantu do RPC — wywołanie kończy się błędem uprawnień.
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select count(*) from public.get_job_match_profile(''a1111111-1111-1111-1111-111111111111'')',
  'permission denied', 'I10c anon nie może wołać get_job_match_profile');
reset role;

-- ============================================================================
-- J. Granica zaufania 0025 — RPC-only DML na tabelach procesowych (SEC-05/06/07)
-- ============================================================================
-- `authenticated` może TYLKO czytać (RLS) i mutować przez SECURITY DEFINER RPC.
-- Bezpośredni INSERT/UPDATE/DELETE musi być odrzucony na poziomie grantu.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  public.withdraw_application(:'appa'::uuid) = 'withdrawn',
  'J7 withdraw_application wycofuje własną aplikację');
select pg_temp.assert(
  public.withdraw_application(:'appa'::uuid) = 'withdrawn',
  'J7b withdraw_application idempotentne (drugie wywołanie bez błędu)');
reset role; reset app.current_uid;
-- Cudza aplikacja: CANDB nie może wycofać aplikacji CANDA (NOT_FOUND, brak dostępu).
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.withdraw_application(current_setting(''my.appa'')::uuid)',
  'NOT_FOUND', 'J7c withdraw_application nie wycofa cudzej aplikacji');
reset role; reset app.current_uid;
-- J7d/J7e (0071, #361): po wycofaniu nowa próba (inny klucz) → APPLICATION_ALREADY_EXISTS
-- i status zostaje 'withdrawn'; retry pierwotnym kluczem nadal zwraca tę samą aplikację.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.apply_to_job('''|| :'JOBA' ||'''::uuid, ''idem-a-after-withdraw'', null, null, null)',
  'APPLICATION_ALREADY_EXISTS', 'J7d ponowna aplikacja po wycofaniu odrzucona jawnie');
select pg_temp.assert(
  public.apply_to_job(:'JOBA'::uuid, 'idem-a-1', null, null, null) = :'appa'::uuid,
  'J7e retry pierwotnym kluczem zwraca tę samą aplikację');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.applications where id = :'appa'::uuid) = 'withdrawn',
  'J7f status aplikacji bez zmian po odrzuconej ponownej aplikacji');

-- J8: rate_limit_hit (SEC-01) odebrany anon/authenticated; działa dla service_role.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.rate_limit_hit(''k'', 5, 60)',
  'permission denied', 'J8 authenticated nie woła rate_limit_hit');
reset role; reset app.current_uid;
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
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
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.assert(public.is_conversation_member(:'conv'::uuid) is true,
  'L0 aktywny członek firmy ma dostęp do rozmowy firmowej');
reset role; reset app.current_uid;

-- Dezaktywacja członkostwa EMPA (symulacja: admin firmy wyłącza pracownika).
update public.company_members set is_active = false where company_id = :'COMPA' and profile_id = :'EMPA';

set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.assert(public.is_conversation_member(:'conv'::uuid) is false,
  'L1 były członek (is_active=false) traci dostęp do rozmowy firmowej (SEC-08)');
reset role; reset app.current_uid;

-- Kandydat (strona nie-firmowa) zachowuje dostęp mimo zmian po stronie firmy.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.assert(public.is_conversation_member(:'conv'::uuid) is true,
  'L2 kandydat zachowuje dostęp do własnej rozmowy');
reset role; reset app.current_uid;

-- Przywrócenie stanu (gdyby doszły kolejne asercje na EMPA).
update public.company_members set is_active = true where company_id = :'COMPA' and profile_id = :'EMPA';

-- ============================================================================
-- M. Persystencja relacji onboardingu 0028 (FUN-04) + RPC-only DML
-- ============================================================================
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
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
select public.set_candidate_certificates('["VCA","HACCP"]'::jsonb);  -- sygnatura jsonb od 0079
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
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
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

set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
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

-- P2: kompletny drugi szkic publikuje się bez subskrypcji (status → active).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  public.publish_job('e1111111-1111-1111-1111-111111111111'::uuid, 'operator-produkcji-abc') is not null,
  'P2 publish_job publikuje drugi kompletny szkic bez subskrypcji');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.jobs where id = 'e1111111-1111-1111-1111-111111111111') = 'active',
  'P2b oferta aktywna po publish_job');

-- P3: klient nie aktywuje oferty bezpośrednim UPDATE (guard trigger). Świeży szkic.
reset role;
insert into public.jobs(id, company_id, slug, title, category, contract_type, city, region, status, default_locale)
  values ('e2222222-2222-2222-2222-222222222222', :'COMPA', 'draft-e2', 'Szkic 2',
          'warehouse', 'permanent', 'Gandawa', 'Flandria', 'draft', 'pl');
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'update public.jobs set status=''active'' where id=''e2222222-2222-2222-2222-222222222222''',
  'PERMISSION_DENIED', 'P3 klient nie aktywuje oferty bezpośrednim UPDATE (guard)');
reset role; reset app.current_uid;

-- P4: bezpłatność nie omija wymagania zweryfikowanej firmy.
update public.companies set status = 'unverified' where id = :'COMPA';
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.publish_job(''e2222222-2222-2222-2222-222222222222''::uuid, ''x'')',
  'COMPANY_NOT_VERIFIED', 'P4 niezweryfikowana firma nie publikuje bezpłatnej oferty');
reset role; reset app.current_uid;
update public.companies set status = 'verified' where id = :'COMPA';

-- P5: nie-członek nie opublikuje cudzego szkicu.
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.publish_job(''e2222222-2222-2222-2222-222222222222''::uuid, ''x'')',
  'PERMISSION_DENIED', 'P5 nie-członek nie publikuje cudzej oferty');
reset role; reset app.current_uid;

-- ============================================================================
-- Q. Owner invariants 0032 (SEC-10) — ochrona właściciela firmy
-- ============================================================================
-- Setup: EMPC (owner COMPC) zostaje ADMINEM (nie-owner) w COMPA. EMPA to jedyny owner COMPA.
reset role;
insert into public.company_members(company_id, profile_id, role, is_active)
  values (:'COMPA', :'EMPC', 'admin', true);

-- Q1: admin (nie-owner) nie awansuje siebie na ownera (przejęcie firmy).
set role authenticated; set app.current_uid = :'EMPC'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'update public.company_members set role=''owner'' where company_id='''|| :'COMPA' ||''' and profile_id='''|| :'EMPC' ||'''',
  'PERMISSION_DENIED', 'Q1 admin nie awansuje siebie na ownera');
reset role; reset app.current_uid;

-- Q2: nie można zdemotować OSTATNIEGO aktywnego ownera (EMPA demote self).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'EMPC'; select pg_temp.assert_client_role();
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
set role authenticated; reset app.current_uid; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.transition_application(current_setting(''my.appa'')::uuid, ''viewed'')',
  'PERMISSION_DENIED', 'U1 zwykły member nie zmienia statusu aplikacji (recruiter+)');
select pg_temp.expect_error(
  'select public.send_offer('''|| :'JOBA' ||'''::uuid, '''|| :'CANDA' ||'''::uuid, ''c3-x'', ''hej'', null)',
  'PERMISSION_DENIED', 'U2 zwykły member nie wysyła propozycji (recruiter+)');
reset role; reset app.current_uid;
-- Kontrola pozytywna: recruiter+ (EMPC owner COMPA) MOŻE zmienić status ŚWIEŻEJ aplikacji.
-- (appa jest już 'withdrawn' po J7 — stan końcowy; tworzymy nową aplikację CANDB->JOBA.)
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select public.apply_to_job(:'JOBA'::uuid, 'candb-joba-1', null, null, 'chętnie') as appcb \gset
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPC'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.applications where id = :'appa') = 0,
  'V1 plain member nie widzi aplikacji firmowej (recruiter+ only)');
select pg_temp.assert(public.can_access_application(:'appa'::uuid) is false,
  'V1b can_access_application=false dla plain member');
reset role; reset app.current_uid;

-- V2: recruiter+ (EMPC owner) widzi aplikację (P1-01 kontrola pozytywna).
set role authenticated; set app.current_uid = :'EMPC'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.applications where id = :'appa') = 1,
  'V2 recruiter+ widzi aplikację firmową');
select pg_temp.assert(public.can_access_application(:'appa'::uuid) is true,
  'V2b can_access_application=true dla recruiter+');
reset role; reset app.current_uid;

-- V3: recruiter+ uczestnik (EMPA admin, aktywny) widzi podsumowanie rozmowy :conv.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.get_conversation_summaries() where conversation_id = :'conv') = 1,
  'V3 recruiter+ uczestnik widzi podsumowanie rozmowy');
reset role; reset app.current_uid;

-- V4: dezaktywacja członkostwa EMPA (admin, NIE ostatni owner) → były członek.
reset role;
update public.company_members set is_active = false where company_id = :'COMPA' and profile_id = :'EMPA';

-- V4a: były członek (EMPA) NIE widzi podsumowań mimo historycznego wiersza uczestnika (P1-02).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.get_conversation_summaries() where conversation_id = :'conv') = 0,
  'V4a były członek nie widzi podsumowań rozmowy (P1-02)');
select pg_temp.expect_error(
  'select public.send_message('''|| :'conv' ||'''::uuid, ''próba b. członka'', gen_random_uuid())',
  'PERMISSION_DENIED', 'V4b były członek nie wysyła wiadomości w rozmowie');
reset role; reset app.current_uid;

-- V4c: kandydat (strona kandydata) NADAL widzi swoją rozmowę.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
update public.companies set name = 'Hack' where id = :'COMPA';
reset role; reset app.current_uid;
select pg_temp.assert(
  (select name from public.companies where id = :'COMPA') <> 'Hack',
  'W1 plain member nie zmienia danych firmy (P1-03; UPDATE trafia 0 wierszy)');
set role authenticated; set app.current_uid = :'EMPC'; select pg_temp.assert_client_role();
update public.companies set name = 'Firma A (edit)' where id = :'COMPA';
reset role; reset app.current_uid;
select pg_temp.assert(
  (select name from public.companies where id = :'COMPA') = 'Firma A (edit)',
  'W2 owner/admin edytuje dane firmy (P1-03)');
-- 0072: zmiana nazwy zweryfikowanej firmy cofa ją do kolejki weryfikacji (sekcja MM);
-- tu przywracamy weryfikację, bo kolejne sekcje zakładają zweryfikowaną Firmę A.
select pg_temp.assert(
  (select status::text from public.companies where id = :'COMPA') = 'pending',
  'W2b zmiana nazwy zweryfikowanej firmy → pending (0072)');
update public.companies set status = 'verified', verified_at = now() where id = :'COMPA';

-- P1-04: konto pracodawcy nie aplikuje ani nie zakłada profilu kandydata (EMPB role=employer).
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.apply_to_job('''|| :'JOBB' ||'''::uuid, ''emp-apply'', null, null, ''x'')',
  'PERMISSION_DENIED', 'W3 pracodawca nie aplikuje (rola candidate wymagana, P1-04)');
select pg_temp.expect_error(
  'select public.set_candidate_skills(array[''x''])',
  'PERMISSION_DENIED', 'W3b pracodawca nie zakłada profilu kandydata (P1-04)');
reset role; reset app.current_uid;

-- P1-05: maszyna stanów aplikacji (appcb='viewed' po sekcji U3; EMPC=recruiter+ COMPA).
set role authenticated; set app.current_uid = :'EMPC'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.transition_application('''|| :'appcb' ||'''::uuid, ''withdrawn'')',
  'VALIDATION_FAILED', 'W4 status docelowy poza allow-listą odrzucony (P1-05)');
select public.transition_application(:'appcb'::uuid, 'rejected');  -- viewed->rejected OK
select pg_temp.expect_error(
  'select public.transition_application('''|| :'appcb' ||'''::uuid, ''hired'')',
  'VALIDATION_FAILED', 'W5 stan końcowy bez wyjścia: rejected->hired zablokowane (P1-05)');
reset role; reset app.current_uid;

-- P1-06: wycofanie tylko ze stanów aktywnych.
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(  -- appcb='rejected' (końcowy) → kandydat nie wycofa
  'select public.withdraw_application('''|| :'appcb' ||'''::uuid)',
  'VALIDATION_FAILED', 'W6 nie można wycofać aplikacji w stanie końcowym (P1-06)');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select public.apply_to_job(:'JOBB'::uuid, 'cand-jobb-1', null, null, 'chętnie') as appjb \gset
select public.withdraw_application(:'appjb'::uuid) as wres \gset
select pg_temp.assert(:'wres' = 'withdrawn', 'W7 wycofanie aplikacji aktywnej OK (P1-06)');
reset role; reset app.current_uid;

-- ============================================================================
-- X. Audyt produkcyjny 0041 (P1-23) — idempotencja aktywnej pary + wygaśnięcie propozycji
-- ============================================================================
-- EMPC = recruiter+ COMPA; CANDA związany z COMPA (aplikacja appa). Brak aktywnej propozycji.
set role authenticated; set app.current_uid = :'EMPC'; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.respond_to_offer('''|| :'xoff1' ||'''::uuid, true)',
  'VALIDATION_FAILED', 'X2 wygasłej propozycji nie można zaakceptować (P1-23)');
reset role; reset app.current_uid;

-- ============================================================================
-- Y. Audyt produkcyjny 0043 (P1-24) — receipt zgód RPC-only (koniec floodowania)
-- ============================================================================
-- Y1: klient nie zapisuje wprost do consents (bezpośredni INSERT odebrany).
set role authenticated; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'insert into public.consents(category, granted) values (''analytics'', true)',
  'permission denied', 'Y1 authenticated nie robi bezpośredniego INSERT do consents');
reset role;
-- Y2: record_consent (anon) zapisuje 4 kategorie z metadanymi receiptu.
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
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
set role authenticated; reset app.current_uid; select pg_temp.assert_client_role();
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
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.set_job_languages(:'JOBA'::uuid, '[{"language":"Francuski","level":"basic"}]'::jsonb);
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.job_languages where job_id = :'JOBA') = 1
    and (select language_label from public.job_languages where job_id = :'JOBA' limit 1) = 'Francuski',
  'BB1 set_job_languages zastępuje atomowo (replace-all)');

-- BB2: zwykły member (CANDB w COMPA) nie zapisze relacji oferty (recruiter+ only).
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.set_job_skills('''|| :'JOBA' ||'''::uuid, true, array[''x''])',
  'PERMISSION_DENIED', 'BB2 zwykły member nie zapisuje relacji oferty (recruiter+)');
reset role; reset app.current_uid;

-- ============================================================================
-- CC. AUDIT_REPORT 0048 (P1-11) — wygasłe oferty znikają publicznie i blokują apply
-- ============================================================================
reset role;
update public.jobs set expires_at = now() - interval '1 day' where id = :'JOBA';

set role anon; reset app.current_uid; select pg_temp.assert_client_role();
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
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
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

-- ============================================================================
-- EE. AUDIT_REPORT 0051 (P1-08) — umiejętność realnie przechodzi mandatory↔optional
-- ============================================================================
-- Punkt wyjścia: EMPA (recruiter+ w COMPA, właściciel JOBA) ustawia zakresy jak kreator.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.set_job_skills(:'JOBA'::uuid, false, array['Java', 'Python']); -- optional
select public.set_job_skills(:'JOBA'::uuid, true,  array['SQL']);            -- mandatory
reset role; reset app.current_uid;
select pg_temp.assert(
  (select is_mandatory from public.job_skills where job_id = :'JOBA' and skill_label = 'Java') = false,
  'EE1 Java startuje jako optional');

-- Przeniesienie Java optional → mandatory: musi zniknąć z optional i pojawić się w mandatory (1 wiersz).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.set_job_skills(:'JOBA'::uuid, true, array['SQL', 'Java']); -- Java dołącza do mandatory
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.job_skills where job_id = :'JOBA' and skill_label = 'Java') = 1,
  'EE2 Java istnieje dokładnie raz po przeniesieniu (koniec dubletu/blokady)');
select pg_temp.assert(
  (select is_mandatory from public.job_skills where job_id = :'JOBA' and skill_label = 'Java') = true,
  'EE3 Java realnie przeniesiona do mandatory (P1-08)');
select pg_temp.assert(
  (select is_mandatory from public.job_skills where job_id = :'JOBA' and skill_label = 'Python') = false,
  'EE4 Python nietknięty (nadal optional)');

-- ============================================================================
-- FF. AUDIT_REPORT 0054 (P1-16) — niezmienny receipt akceptacji regulaminu/polityki
-- ============================================================================
-- FF1: bezpośredni DML odebrany authenticated (RPC-only).
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'insert into public.document_acceptances (profile_id, document) values ('''|| :'CANDA' ||''', ''terms'')',
  'permission denied', 'FF1 authenticated nie pisze document_acceptances (RPC-only)');
reset role; reset app.current_uid;

-- FF2: record_document_acceptance (service_role) tworzy receipt dla terms+privacy.
set role service_role;
select public.record_document_acceptance(:'CANDA'::uuid, array['terms','privacy'], 'pl', '203.0.113.7', 'UA/1.0');
reset role;
select pg_temp.assert(
  (select count(*) from public.document_acceptances where profile_id = :'CANDA') = 2,
  'FF2 receipt dla terms+privacy utworzony');

-- FF3: kandydat widzi WŁASNE akceptacje; obcy nie.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.document_acceptances) = 2, 'FF3 CANDA widzi swoje akceptacje');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.document_acceptances where profile_id = :'CANDA') = 0,
  'FF4 obcy nie widzi cudzych akceptacji (RLS)');
reset role; reset app.current_uid;

-- ============================================================================
-- GG. Część #51 — billing pozostaje kompatybilny, publikacja jest bezpłatna
-- ============================================================================
-- GG1: członek widzi uprawnienia — bez subskrypcji plan 'free', limit 1.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select max_active_jobs as gg_max, plan as gg_plan
  from public.get_company_entitlements(:'COMPA'::uuid) \gset
reset role; reset app.current_uid;
select pg_temp.assert(:'gg_plan' = 'free' and :'gg_max' = '1', 'GG1 plan free → limit 1');

-- GG2: nie-członek nie widzi uprawnień firmy.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.get_company_entitlements('''|| :'COMPA' ||'''::uuid)',
  'PERMISSION_DENIED', 'GG2 nie-członek nie widzi entitlements');
reset role; reset app.current_uid;

-- Przygotuj KOMPLETNY szkic dla COMPA (superuser) — COMPA ma już JOBA aktywne (limit free = 1).
reset role;
insert into public.jobs (id, company_id, slug, title, category, contract_type, city, region, status, default_locale)
  values ('a2222222-2222-2222-2222-222222222222', :'COMPA', 'draft-gg', 'Nowa oferta', 'warehouse', 'permanent', 'Gandawa', 'Flandria', 'draft', 'pl');
insert into public.job_translations (job_id, locale, title, description, responsibilities)
  values ('a2222222-2222-2222-2222-222222222222', 'pl', 'Nowa oferta', 'Dłuższy opis stanowiska magazynowego.', array['Obsługa magazynu']);
insert into public.job_requirements (job_id, kind, locale, content, position)
  values ('a2222222-2222-2222-2222-222222222222', 'mandatory', 'pl', 'Doświadczenie', 1);

-- GG3: brak subskrypcji nie blokuje publikacji kolejnej kompletnej oferty.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.publish_job('a2222222-2222-2222-2222-222222222222'::uuid, 'nowa-oferta');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.jobs where id = 'a2222222-2222-2222-2222-222222222222') = 'active',
  'GG3 bez subskrypcji: druga kompletna oferta jest aktywna');

-- GG4: ponowne żądanie publikacji nie może udawać drugiego sukcesu.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.publish_job(''a2222222-2222-2222-2222-222222222222''::uuid, ''inna-nazwa'')',
  'VALIDATION_FAILED', 'GG4 ponowna publikacja aktywnej oferty jest odrzucona');
reset role; reset app.current_uid;

-- ============================================================================
-- HH. AUDIT_REPORT 0056 (P1-04) — cykl życia oferty (maszyna stanów set_job_status)
-- ============================================================================
-- Punkt wyjścia: 'a2222222…' jest AKTYWNA (opublikowana w GG4).
-- HH1: klient nie zmienia statusu bezpośrednim UPDATE (guard_job_status — dotąd chroniona
-- była tylko zmiana na 'active'; teraz KAŻDA zmiana idzie przez RPC).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'update public.jobs set status = ''paused'' where id = ''a2222222-2222-2222-2222-222222222222''',
  'PERMISSION_DENIED', 'HH1 klient nie zmienia statusu oferty bezpośrednio');

-- HH2: niedozwolone przejście (resume z active) odrzucone macierzą.
select pg_temp.expect_error(
  'select public.set_job_status(''a2222222-2222-2222-2222-222222222222''::uuid, ''resume'')',
  'VALIDATION_FAILED', 'HH2 resume z active odrzucone (macierz przejść)');

-- HH3: pauza działa (active → paused), oferta znika z warstwy publicznej.
select public.set_job_status('a2222222-2222-2222-2222-222222222222'::uuid, 'pause');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.jobs where id = 'a2222222-2222-2222-2222-222222222222') = 'paused',
  'HH3 pause: active → paused');
select pg_temp.assert(public.job_is_public('a2222222-2222-2222-2222-222222222222'::uuid) is false,
  'HH3b wstrzymana oferta nie jest publiczna');

-- HH4: bezpłatność nie omija wymagania zweryfikowanej firmy przy aktywacji.
reset role;
update public.companies set status = 'unverified' where id = :'COMPA';
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.set_job_status(''a2222222-2222-2222-2222-222222222222''::uuid, ''resume'')',
  'COMPANY_NOT_VERIFIED', 'HH4 niezweryfikowana firma nie wznawia bezpłatnej oferty');
reset role; reset app.current_uid;
update public.companies set status = 'verified' where id = :'COMPA';

-- HH5: wznowienie bez subskrypcji przechodzi (paused → active).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.set_job_status('a2222222-2222-2222-2222-222222222222'::uuid, 'resume');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.jobs where id = 'a2222222-2222-2222-2222-222222222222') = 'active',
  'HH5 resume: paused → active bez subskrypcji');

-- HH6: zamknięcie (active → closed) i ponowne otwarcie (closed → active) z kompletnością.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.set_job_status('a2222222-2222-2222-2222-222222222222'::uuid, 'close');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.jobs where id = 'a2222222-2222-2222-2222-222222222222') = 'closed',
  'HH6 close: active → closed');
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.set_job_status('a2222222-2222-2222-2222-222222222222'::uuid, 'reopen');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.jobs where id = 'a2222222-2222-2222-2222-222222222222') = 'active',
  'HH7 reopen: closed → active bez subskrypcji (kompletna oferta)');

-- HH8: zwykły member (bez recruiter+) nie zarządza cyklem życia oferty.
reset role;
insert into public.company_members(company_id, profile_id, role, is_active)
  values (:'COMPA', :'CANDB', 'member', true)
  on conflict do nothing;
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.set_job_status(''a2222222-2222-2222-2222-222222222222''::uuid, ''pause'')',
  'PERMISSION_DENIED', 'HH8 zwykły member nie zmienia statusu oferty (recruiter+)');
reset role; reset app.current_uid;
-- sprzątanie
reset role;
delete from public.company_members where company_id = :'COMPA' and profile_id = :'CANDB';

-- ============================================================================
-- II. Grupowane liczniki publicznych ofert (0064) — anon bez SELECT na tabelach
-- ============================================================================
reset role;
-- Jedyny pasujący rekord construction jest aktywny, ale firma pozostaje unverified.
-- RPC musi zachować requested row i zwrócić 0, zamiast usunąć grupę przez WHERE po LEFT JOIN.
update public.companies set status = 'unverified' where id = :'COMPC';
update public.jobs set status = 'active', expires_at = null where id = :'JOBC';
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select total from public.get_public_job_category_counts(array['warehouse']) where key = 'warehouse') = 2,
  'II1 anon widzi pełny grupowany licznik kategorii przez SECURITY DEFINER');
select pg_temp.assert(
  (select total from public.get_public_job_category_counts(array['transport']) where key = 'transport') = 1,
  'II2 licznik kategorii obejmuje właściwy publiczny zakres');
select pg_temp.assert(
  (select total from public.get_public_job_category_counts(array['construction']) where key = 'construction') = 0,
  'II3 licznik wyklucza ofertę niezweryfikowanej firmy');
select pg_temp.assert(
  (select count(*) from public.get_public_job_category_counts(array['construction'])
    where key = 'construction' and total = 0) = 1,
  'II3b jedyne niezweryfikowane dopasowanie zwraca jawny wiersz construction=0');
select pg_temp.assert(
  (select count(*) from public.get_public_job_category_counts(array[repeat('x', 150)])
    where length(key) = 100 and total = 0) = 1,
  'II3c klucz kategorii jest ograniczony do 100 znaków tak jak miasto');
select pg_temp.assert(
  (select total from public.get_public_job_city_counts(array['Gandawa']) where key = 'Gandawa') = 2,
  'II4 anon widzi pełny grupowany licznik miasta');
select pg_temp.expect_error('select count(*) from public.jobs', 'permission denied',
  'II5 RPC nie przywraca anon bezpośredniego SELECT jobs');
select pg_temp.expect_error('select count(*) from public.companies', 'permission denied',
  'II6 RPC nie przywraca anon bezpośredniego SELECT companies');
reset role; reset app.current_uid;

-- ============================================================================
-- JJ. Dokładne facety listingu (0065) — pełny zbiór, jeden publiczny RPC
-- ============================================================================
insert into public.jobs(company_id,slug,title,category,contract_type,city,region,status,default_locale,
  published_at,expires_at,accommodation,immediate,no_language_required)
select :'COMPA','facet-rls-'||n,'Facet '||n,'warehouse','permanent','Antwerpia','Flandria','active','pl',
  now(),now()+interval '30 days',n%2=0,n%3=0,n%5=0 from generate_series(1,205) n;
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select total from public.get_public_job_filter_facets('pl',p_locations=>array['Antwerpia'],
    p_contract_types=>array['permanent']) where dimension='total' and key='all') > 200,
  'JJ1 dokładny total nie zatrzymuje się na 200');
select pg_temp.assert(
  (select total from public.get_public_job_filter_facets('pl',p_locations=>array['Antwerpia'],
    p_contract_types=>array['permanent']) where dimension='category' and key='warehouse') > 200,
  'JJ2 widoczny badge kategorii zachowuje pozostałe aktywne filtry');
select pg_temp.assert(
  (select count(*) from public.get_public_job_filter_facets('pl')
    where dimension in ('category','location','contract','accommodation','additional')) >= 7,
  'JJ3 RPC zwraca wszystkie widoczne wymiary filtrów');
select pg_temp.expect_error('select count(*) from public.jobs', 'permission denied',
  'JJ4 facet RPC nie daje anon SELECT jobs');
reset role; reset app.current_uid;
delete from public.jobs where slug like 'facet-rls-%';

-- ============================================================================
-- KK. Języki serwisu jako dane (0069) — FK zamiast CHECK, jedna funkcja
-- ============================================================================
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select array_agg(code order by code) from public.supported_locales) = array['en','fr','nl','pl'],
  'KK1 anon czyta słownik języków: dokładnie pl/nl/fr/en');
select pg_temp.expect_error($$insert into public.supported_locales(code) values ('de')$$,
  'permission denied', 'KK2 anon nie dopisze języka');
reset role;
select set_config('app.current_uid', :'CANDA', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.expect_error($$delete from public.supported_locales where code = 'pl'$$,
  'permission denied', 'KK3 zalogowany nie usunie języka');
reset role; reset app.current_uid;

select pg_temp.assert(public.is_supported_locale('pl') and not public.is_supported_locale('de')
  and not public.is_supported_locale('PL') and public.is_supported_locale(null) is null,
  'KK4 is_supported_locale: pl=true, de/PL=false, NULL=NULL (jak `x in (...)`)');
select pg_temp.expect_error(
  format($$update public.profiles set preferred_locale = 'de' where id = %L$$, :'CANDA'),
  'foreign key', 'KK5 nieznany język w profilu odrzucony przez FK');
select pg_temp.expect_error(
  format($$update public.jobs set default_locale = 'de' where id = %L$$, :'JOBA'),
  'foreign key', 'KK6 nieznany język oferty odrzucony przez FK');

-- Nowy język = jeden wiersz: kolumny i funkcje przyjmują go bez zmian w kodzie SQL.
insert into public.supported_locales(code) values ('ro');
update public.profiles set preferred_locale = 'ro' where id = :'CANDA';
select pg_temp.assert(public.resolve_recipient_locale(:'CANDA') = 'ro',
  'KK7 po dodaniu ro: profil i resolve_recipient_locale przyjmują ro');
update public.profiles set preferred_locale = null where id = :'CANDA';
delete from public.supported_locales where code = 'ro';
select pg_temp.assert(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','auth') and p.prosrc ~ '''pl''\s*,\s*''nl''\s*,\s*''fr''\s*,\s*''en''')
  and not exists (select 1 from pg_constraint where contype = 'c'
    and pg_get_constraintdef(oid) ~ '''nl''::text'),
  'KK8 żadna funkcja ani CHECK nie powiela listy języków');

-- ============================================================================
-- LL. Odbiorcy powiadomień firmowych = aktywni recruiter+ (0070); e-mail o wiadomości
--     do kandydata bez danych osobowych członka firmy
-- ============================================================================
\set CANDL 'd1000000-0000-0000-0000-00000000000c'
\set OWNL  'd1000000-0000-0000-0000-0000000000a1'
\set EXL   'd1000000-0000-0000-0000-0000000000a2'
\set MEML  'd1000000-0000-0000-0000-0000000000a3'
\set DELL  'd1000000-0000-0000-0000-0000000000a4'
\set COMPL 'd1000000-0000-0000-0000-0000000000f1'
\set JOBL  'd1000000-0000-0000-0000-0000000000b1'
reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'CANDL','candl@test.be','Cara L','{"role":"candidate","first_name":"Cara","last_name":"Lambrecht","locale":"fr"}'),
  (:'OWNL','ownl@test.be','Olaf O','{"role":"employer","first_name":"Olaf","last_name":"Oosterlinck","locale":"nl"}'),
  (:'EXL','exl@test.be','Ewa X','{"role":"employer","first_name":"Ewa","last_name":"Exowska","locale":"pl"}'),
  (:'MEML','meml@test.be','Mia M','{"role":"employer","first_name":"Mia","last_name":"Memberska","locale":"en"}'),
  (:'DELL','dell@test.be','Dirk D','{"role":"employer","first_name":"Dirk","last_name":"Deleted","locale":"nl"}');
insert into public.companies(id,name,status) values (:'COMPL','Firma L','verified');
insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'COMPL',:'OWNL','owner',true),
  (:'COMPL',:'EXL','recruiter',true),
  (:'COMPL',:'MEML','member',true),
  (:'COMPL',:'DELL','recruiter',true);
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'JOBL',:'COMPL','job-l','Operator L','warehouse','permanent','Brugge','Flandria','active','pl');
insert into public.candidate_profiles(profile_id, is_searchable) values (:'CANDL', false);

-- Stan wyjściowy (wszyscy aktywni): aplikacja, propozycja od EXL, rozmowa z udziałem firmy.
select set_config('app.current_uid', :'CANDL', false);
set role authenticated; select pg_temp.assert_client_role();
select public.apply_to_job(:'JOBL'::uuid, 'll-app-1', null, null, 'chętnie') as appl \gset
reset role;
select set_config('app.current_uid', :'EXL', false);
set role authenticated; select pg_temp.assert_client_role();
select public.send_offer(:'JOBL'::uuid, :'CANDL'::uuid, 'll-off-1', 'Zapraszamy', null) as offl \gset
select public.get_or_create_conversation(:'appl'::uuid, null) as convl \gset
reset role; reset app.current_uid;
select pg_temp.assert((select count(*) from public.conversation_members where conversation_id = :'convl') = 5,
  'LL0 rozmowa objęła kandydata i wszystkich aktywnych członków firmy');
select pg_temp.assert(
  (select count(*) from public.notifications where entity_id = :'appl' and profile_id = :'MEML') = 0
  and (select count(*) from public.email_deliveries where entity_id = :'appl' and profile_id = :'MEML') = 0,
  'LL0b zwykły member nie dostaje powiadomienia o aplikacji');

-- EXL odchodzi z firmy; profil DELL zostaje usunięty (soft delete).
update public.company_members set is_active = false where company_id = :'COMPL' and profile_id = :'EXL';
update public.profiles set deleted_at = now() where id = :'DELL';

-- LL1: nowa aplikacja — tylko aktywny recruiter+ z aktywnym profilem (OWNL).
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  ('d1000000-0000-0000-0000-0000000000b2',:'COMPL','job-l2','Operator L2','warehouse','permanent','Brugge','Flandria','active','pl');
select set_config('app.current_uid', :'CANDL', false);
set role authenticated; select pg_temp.assert_client_role();
select public.apply_to_job('d1000000-0000-0000-0000-0000000000b2'::uuid, 'll-app-2', null, null, null) as appl2 \gset
reset role; reset app.current_uid;
select pg_temp.assert(
  (select array_agg(profile_id::text order by profile_id) from public.notifications where entity_id = :'appl2')
    = array[:'OWNL'::text],
  'LL1 powiadomienie o aplikacji tylko dla aktywnego recruiter+ (nie b. członek, nie usunięty profil)');
select pg_temp.assert(
  (select array_agg(profile_id::text order by profile_id) from public.email_deliveries where entity_id = :'appl2')
    = array[:'OWNL'::text],
  'LL1b e-mail o aplikacji tylko dla aktywnego recruiter+');

-- LL2: wiadomość kandydata — b. członek, usunięty profil i zwykły member bez wpisów.
select set_config('app.current_uid', :'CANDL', false);
set role authenticated; select pg_temp.assert_client_role();
select public.send_message(:'convl'::uuid, 'Dzień dobry, pytanie o zmianę', gen_random_uuid()) as msgl \gset
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.notifications
     where entity_id = :'convl' and type = 'message_received' and profile_id in (:'EXL', :'DELL', :'MEML')) = 0,
  'LL2 b. członek / usunięty profil / member nie dostają powiadomienia o wiadomości');
select pg_temp.assert(
  (select array_agg(profile_id::text order by profile_id) from public.email_deliveries where entity_id = :'msgl')
    = array[:'OWNL'::text],
  'LL2b e-mail o wiadomości tylko dla aktywnego recruiter+ firmy');

-- LL3: odpowiedź na propozycję b. członka — trafia do aktywnych recruiter+, nie do nadawcy.
select set_config('app.current_uid', :'CANDL', false);
set role authenticated; select pg_temp.assert_client_role();
select public.respond_to_offer(:'offl'::uuid, true);
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.notifications where entity_id = :'offl' and type = 'offer_status_changed'
     and profile_id = :'EXL') = 0
  and (select count(*) from public.email_deliveries where entity_id = :'offl' and profile_id = :'EXL') = 0,
  'LL3 b. członek (nadawca propozycji) nie dostaje odpowiedzi kandydata');
select pg_temp.assert(
  (select array_agg(profile_id::text order by profile_id) from public.email_deliveries
     where entity_id = :'offl' and template = 'offerAccepted') = array[:'OWNL'::text],
  'LL3b odpowiedź trafia do aktywnego recruiter+ firmy');

-- LL4: wiadomość członka firmy do kandydata — e-mail podpisany nazwą firmy, bez nazwiska.
select set_config('app.current_uid', :'OWNL', false);
set role authenticated; select pg_temp.assert_client_role();
select public.send_message(:'convl'::uuid, 'Zapraszamy na rozmowę', gen_random_uuid()) as msgl2 \gset
reset role; reset app.current_uid;
select pg_temp.assert(
  (select payload->>'senderName' from public.email_deliveries
     where entity_id = :'msgl2' and profile_id = :'CANDL') = 'Firma L',
  'LL4 kandydat widzi w e-mailu nazwę firmy jako nadawcę');
select pg_temp.assert(
  not exists (select 1 from public.email_deliveries
    where entity_id = :'msgl2' and payload::text ~ '(Olaf|Oosterlinck)'),
  'LL4b payload e-maila do kandydata nie zawiera imienia/nazwiska rekrutera');
-- Kierunek kandydat → firma bez zmian: firma widzi imię i nazwisko kandydata.
select pg_temp.assert(
  (select payload->>'senderName' from public.email_deliveries
     where entity_id = :'msgl' and profile_id = :'OWNL') = 'Cara Lambrecht',
  'LL4c firma nadal dostaje imię i nazwisko kandydata');
select pg_temp.assert(
  not has_function_privilege('authenticated', 'public.company_recipient_ok(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.company_recipient_ok(uuid, uuid)', 'execute'),
  'LL5 helper odbiorców nie jest wywoływalny przez role klienta');

-- ============================================================================
-- MM. Weryfikacja firmy po stronie pracodawcy (0072): ponowne zgłoszenie odrzuconej
--     firmy, zmiana nazwy/VAT zweryfikowanej firmy → kolejka admina, pierwsza firma
--     z panelu atomowo z VAT i idempotentnie
-- ============================================================================
\set OWNM  'e1000000-0000-0000-0000-0000000000a1'
\set MEMM  'e1000000-0000-0000-0000-0000000000a2'
\set OWNN  'e1000000-0000-0000-0000-0000000000a3'
\set NOCO  'e1000000-0000-0000-0000-0000000000a4'
\set EXM   'e1000000-0000-0000-0000-0000000000a5'
\set NOCO2 'e1000000-0000-0000-0000-0000000000a6'
\set CANDM 'e1000000-0000-0000-0000-00000000000c'
\set COMPM 'e1000000-0000-0000-0000-0000000000f1'
\set COMPN 'e1000000-0000-0000-0000-0000000000f2'
\set COMPS 'e1000000-0000-0000-0000-0000000000f3'
reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'OWNM','ownm@test.be','Otto M','{"role":"employer","first_name":"Otto","last_name":"M","locale":"nl"}'),
  (:'MEMM','memm@test.be','Mila M','{"role":"employer","first_name":"Mila","last_name":"M","locale":"pl"}'),
  (:'OWNN','ownn@test.be','Nora N','{"role":"employer","first_name":"Nora","last_name":"N","locale":"fr"}'),
  (:'NOCO','noco@test.be','Nico C','{"role":"employer","first_name":"Nico","last_name":"C","locale":"en"}'),
  (:'EXM','exm@test.be','Ex M','{"role":"employer","first_name":"Ex","last_name":"M","locale":"pl"}'),
  (:'NOCO2','noco2@test.be','Nina C','{"role":"employer","first_name":"Nina","last_name":"C","locale":"pl"}'),
  (:'CANDM','candm@test.be','Cleo M','{"role":"candidate","first_name":"Cleo","last_name":"M","locale":"pl"}');
insert into public.companies(id,name,status,vat_number,verified_at) values
  (:'COMPM','Firma M','rejected',null,null),
  (:'COMPN','Firma N','verified','BE0111111111',now()),
  (:'COMPS','Firma S','suspended',null,null);
insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'COMPM',:'OWNM','owner',true),
  (:'COMPM',:'MEMM','member',true),
  (:'COMPM',:'EXM','recruiter',false),
  (:'COMPN',:'OWNN','owner',true),
  (:'COMPS',:'OWNN','owner',true);

-- MM1: ponowne zgłoszenie — kontrola ujemna (member, obca firma, stany inne niż rejected).
set role authenticated; set app.current_uid = :'MEMM'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.request_company_reverification(''e1000000-0000-0000-0000-0000000000f1''::uuid)',
  'PERMISSION_DENIED', 'MM1 zwykły member nie zgłasza firmy ponownie');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'OWNN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.request_company_reverification(''e1000000-0000-0000-0000-0000000000f1''::uuid)',
  'PERMISSION_DENIED', 'MM1b owner innej firmy nie zgłasza obcej firmy');
select pg_temp.expect_error(
  'select public.request_company_reverification(''e1000000-0000-0000-0000-0000000000f2''::uuid)',
  'COMPANY_STATUS_INVALID', 'MM1c firma verified nie wraca do kolejki przez RPC');
select pg_temp.expect_error(
  'select public.request_company_reverification(''e1000000-0000-0000-0000-0000000000f3''::uuid)',
  'COMPANY_STATUS_INVALID', 'MM1d zawieszenie zdejmuje tylko admin');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.companies where id = :'COMPM') = 'rejected'
  and (select status::text from public.companies where id = :'COMPS') = 'suspended',
  'MM1e nieudane zgłoszenia nie zmieniają statusu');

-- MM2: owner nie ustawi statusu bezpośrednio — także ze znacznikiem transakcji ustawionym ręcznie.
set role authenticated; set app.current_uid = :'OWNM'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'update public.companies set status=''pending'' where id=''e1000000-0000-0000-0000-0000000000f1''',
  'PERMISSION_DENIED', 'MM2 bezpośredni UPDATE rejected→pending zablokowany');
select pg_temp.expect_error(
  'select set_config(''pracujbe.company_reverify'', ''e1000000-0000-0000-0000-0000000000f1'', false); '
  || 'update public.companies set status=''verified'' where id=''e1000000-0000-0000-0000-0000000000f1''',
  'PERMISSION_DENIED', 'MM2b znacznik nie pozwala na samodzielną weryfikację');
select set_config('pracujbe.company_reverify', '', false);

-- MM3: owner odrzuconej firmy zgłasza ją ponownie → pending (kolejka awaiting), audyt.
select public.request_company_reverification(:'COMPM'::uuid);
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.companies where id = :'COMPM') = 'pending',
  'MM3 rejected → pending po ponownym zgłoszeniu');
select pg_temp.assert(
  exists (select 1 from public.audit_logs where entity_id = :'COMPM'
            and action = 'company.reverification_requested' and actor_id = :'OWNM')
  and exists (select 1 from public.audit_logs where entity_id = :'COMPM'
            and action = 'company.status_changed' and after_data->>'status' = 'pending'),
  'MM3b audyt ponownego zgłoszenia i zmiany statusu');
select pg_temp.assert(
  coalesce(current_setting('pracujbe.company_reverify', true), '') = '',
  'MM3c znacznik RPC nie zostaje w sesji');
set role authenticated; set app.current_uid = :'OWNM'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.request_company_reverification(''e1000000-0000-0000-0000-0000000000f1''::uuid)',
  'COMPANY_STATUS_INVALID', 'MM3d drugie zgłoszenie bez ponownego odrzucenia odrzucone');
reset role; reset app.current_uid;

-- MM4: zmiana nazwy/VAT zweryfikowanej firmy przez ownera → pending, bez daty weryfikacji.
set role authenticated; set app.current_uid = :'OWNN'; select pg_temp.assert_client_role();
update public.companies set name = 'Firma N' where id = :'COMPN';
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.companies where id = :'COMPN') = 'verified',
  'MM4 zapis bez zmiany nazwy/VAT nie cofa weryfikacji');
set role authenticated; set app.current_uid = :'OWNN'; select pg_temp.assert_client_role();
update public.companies set name = 'Firma N Nowa' where id = :'COMPN';
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'pending' and verified_at is null and verified_by is null
     from public.companies where id = :'COMPN'),
  'MM4b zmiana nazwy zweryfikowanej firmy → pending');
update public.companies set status = 'verified', verified_at = now() where id = :'COMPN';
set role authenticated; set app.current_uid = :'OWNN'; select pg_temp.assert_client_role();
update public.companies set vat_number = 'BE0222222222' where id = :'COMPN';
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.companies where id = :'COMPN') = 'pending',
  'MM4c zmiana VAT zweryfikowanej firmy → pending');
-- Admin ponownie weryfikuje firmę z kolejki.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_set_company_status(:'COMPN'::uuid, 'verified');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.companies where id = :'COMPN') = 'verified',
  'MM4d admin ponownie weryfikuje firmę z kolejki');

-- MM5: pierwsza firma z panelu — atomowo z VAT, idempotentnie, tylko pracodawca.
set role authenticated; set app.current_uid = :'NOCO'; select pg_temp.assert_client_role();
select company_id as nocomp, created as nocreated
  from public.create_first_company('Firma Nowa', 'firma-nowa-mm5', ' BE0333333333 ') \gset
select company_id as nocomp2, created as nocreated2
  from public.create_first_company('Firma Nowa', 'firma-nowa-mm5-b', 'BE0333333333') \gset
reset role; reset app.current_uid;
select pg_temp.assert(:'nocreated'::boolean and not :'nocreated2'::boolean and :'nocomp' = :'nocomp2',
  'MM5 ponowne wywołanie zwraca tę samą firmę (bez duplikatu)');
select pg_temp.assert(
  (select status::text = 'unverified' and vat_number = 'BE0333333333' and name = 'Firma Nowa'
     from public.companies where id = :'nocomp'),
  'MM5b firma unverified z zapisanym VAT w jednej transakcji');
select pg_temp.assert(
  (select count(*) from public.company_members where profile_id = :'NOCO') = 1
  and (select role::text from public.company_members where profile_id = :'NOCO') = 'owner',
  'MM5c jedno członkowstwo ownera');
set role authenticated; set app.current_uid = :'CANDM'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.create_first_company(''Firma K'', ''firma-k-mm5'', null)',
  'PERMISSION_DENIED', 'MM5d kandydat nie zakłada firmy');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EXM'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.create_first_company(''Firma X'', ''firma-x-mm5'', null)',
  'PERMISSION_DENIED', 'MM5e odebrany dostęp nie tworzy firmy zastępczej');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'NOCO2'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.create_first_company(''Firma Y'', ''firma-y-mm5'', repeat(''9'', 65))',
  'companies_vat_len', 'MM5f za długi VAT odrzuca całą operację');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.company_members where profile_id = :'NOCO2') = 0
  and not exists (select 1 from public.companies where slug = 'firma-y-mm5'),
  'MM5g błąd VAT nie zostawia firmy bez numeru');

-- ============================================================================
-- NN. Kolejka e-mail (0073): klucz per przejście statusu (#292), applicationViewed
--     i jobPublished (#295); język = język ODBIORCY (Invariant #1)
-- ============================================================================
-- Fixture z LL: appl2 (CANDL, locale fr) w stanie submitted; OWNL = aktywny owner COMPL.
select set_config('app.current_uid', :'OWNL', false);
set role authenticated; select pg_temp.assert_client_role();
select public.transition_application(:'appl2'::uuid, 'viewed');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.email_deliveries
     where entity_id = :'appl2' and profile_id = :'CANDL' and template = 'applicationViewed' and locale = 'fr') = 1
  and (select count(*) from public.email_deliveries
     where entity_id = :'appl2' and template = 'statusChanged') = 0,
  'NN1 viewed → dedykowany applicationViewed w języku kandydata (fr), bez statusChanged');

-- Cykl interview → shortlisted → interview: każde przejście = jeden e-mail.
select set_config('app.current_uid', :'OWNL', false);
set role authenticated; select pg_temp.assert_client_role();
select public.transition_application(:'appl2'::uuid, 'interview');
select public.transition_application(:'appl2'::uuid, 'shortlisted');
select public.transition_application(:'appl2'::uuid, 'interview');
-- Ponowienie tego samego żądania (status bez zmian) nie tworzy przejścia ani e-maila.
select public.transition_application(:'appl2'::uuid, 'interview');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.email_deliveries
     where entity_id = :'appl2' and template = 'statusChanged' and payload->>'status' = 'interview') = 2,
  'NN2 powrót do interview wysyła drugi e-mail (#292)');
select pg_temp.assert(
  (select count(*) from public.email_deliveries where entity_id = :'appl2' and template = 'statusChanged') = 3
  and (select count(*) from public.application_status_history where application_id = :'appl2') = 4,
  'NN2b retry bez zmiany statusu nie dodaje e-maila ani historii (idempotencja)');
select pg_temp.assert(
  (select count(distinct idempotency_key) from public.email_deliveries where entity_id = :'appl2')
    = (select count(*) from public.email_deliveries where entity_id = :'appl2'),
  'NN2c klucze idempotencji unikalne per przejście');

-- Kontrola ujemna: opt-out email_applications wyłącza oba szablony statusu; in-app zostaje.
insert into public.notification_preferences (profile_id, email_applications) values (:'CANDL', false)
  on conflict (profile_id) do update set email_applications = false;
select set_config('app.current_uid', :'OWNL', false);
set role authenticated; select pg_temp.assert_client_role();
select public.transition_application(:'appl2'::uuid, 'shortlisted');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.email_deliveries where entity_id = :'appl2' and profile_id = :'CANDL') = 4
  and (select count(*) from public.notifications
         where entity_id = :'appl2' and profile_id = :'CANDL' and type = 'application_status_changed') = 5,
  'NN3 opt-out: brak e-maila, powiadomienie in-app powstaje');

-- jobPublished: GG3 opublikował szkic (EMPA, locale nl); GG4 (odrzucona ponowna publikacja) bez maila.
select pg_temp.assert(
  (select count(*) from public.email_deliveries
     where entity_id = 'a2222222-2222-2222-2222-222222222222' and template = 'jobPublished') = 1
  and (select profile_id::text || '/' || locale from public.email_deliveries
     where entity_id = 'a2222222-2222-2222-2222-222222222222' and template = 'jobPublished') = :'EMPA' || '/nl',
  'NN4 publikacja → jeden jobPublished do publikującego w jego języku');
select pg_temp.assert(
  (select payload->>'jobTitle' from public.email_deliveries
     where entity_id = 'a2222222-2222-2222-2222-222222222222' and template = 'jobPublished') = 'Nowa oferta',
  'NN4b payload jobPublished zawiera tytuł oferty');

-- ============================================================================
-- OO. Dopasowanie 0074 — dostępność „w ciągu 2 tygodni" (#190), poziomy języków
--     w get_job_match_profile (#195), publiczne oferty po ID dla polecanych (#196)
-- ============================================================================
\set JOBO   'e7400000-0000-0000-0000-0000000000b3'
\set JOBOX  'e7400000-0000-0000-0000-0000000000b4'
\set JOBOD  'e7400000-0000-0000-0000-0000000000b5'
reset role; reset app.current_uid;
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,expires_at,deleted_at) values
  (:'JOBO', :'COMPL','job-o','Operator M','warehouse','permanent','Mechelen','Flandria','active','pl',null,null),
  (:'JOBOX',:'COMPL','job-ox','Operator MX','warehouse','permanent','Mechelen','Flandria','active','pl',now() - interval '1 day',null),
  (:'JOBOD',:'COMPL','job-od','Operator MD','warehouse','permanent','Mechelen','Flandria','active','pl',null,now());
insert into public.job_translations(job_id, locale, title) values (:'JOBO','fr','Opérateur M');
insert into public.job_languages(job_id, language_label, level) values
  (:'JOBO','Niderlandzki','fluent'), (:'JOBO','Angielski',null);

-- OO1: aplikacja zapisuje within_two_weeks; firma (recruiter+) odczytuje tę wartość pod RLS.
select set_config('app.current_uid', :'CANDL', false);
set role authenticated; select pg_temp.assert_client_role();
select public.apply_to_job(:'JOBO'::uuid, 'oo-app-1', null, 'within_two_weeks', null) as appo \gset
reset role;
select set_config('app.current_uid', :'OWNL', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select availability::text from public.applications where id = :'appo') = 'within_two_weeks',
  'OO1 aplikacja zachowuje within_two_weeks; firma odczytuje ją pod RLS');
reset role; reset app.current_uid;
select pg_temp.assert(
  'within_month' = any(enum_range(null::public.availability_status)::text[]),
  'OO1b dotychczasowa wartość within_month pozostaje w enumie');

-- OO2: poziom wymagany (także brak poziomu) przechodzi z oferty do dopasowania bez utraty.
select set_config('app.current_uid', :'CANDL', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select language_requirements from public.get_job_match_profile(:'JOBO'::uuid))
    = '[{"label":"Angielski","level":null},{"label":"Niderlandzki","level":"fluent"}]'::jsonb,
  'OO2 get_job_match_profile zwraca poziomy języków (null = poziom dowolny)');
select pg_temp.assert(
  (select count(*) from public.get_job_match_profile(:'JOBOX'::uuid)) = 0,
  'OO2b wygasła oferta nie ma profilu dopasowania');
reset role; reset app.current_uid;

-- OO3: get_public_jobs_by_ids zwraca dokładnie publiczne oferty z listy (tłumaczenie w locale),
-- pomija wygasłe, usunięte i firmy unverified (kontrola ujemna).
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select array_agg(id order by id) from public.get_public_jobs_by_ids(
     array[:'JOBO', :'JOBOX', :'JOBOD', 'd1111111-1111-1111-1111-111111111111']::uuid[], 'fr'))
    = array[:'JOBO']::uuid[],
  'OO3 po ID tylko oferty publiczne (bez wygasłej, usuniętej, unverified)');
select pg_temp.assert(
  (select title from public.get_public_jobs_by_ids(array[:'JOBO']::uuid[], 'fr')) = 'Opérateur M',
  'OO3b tytuł w locale odbiorcy');
select pg_temp.assert(
  (select count(*) from public.get_public_jobs_by_ids(
     array(select gen_random_uuid() from generate_series(1, 150)) || array[:'JOBO']::uuid[], 'pl')) = 0,
  'OO3c twardy sufit 100 ID na wywołanie');
reset role;

-- ============================================================================
-- PP. Idempotentna wysyłka wiadomości (0075, #147) oraz wyścig i granica wygaśnięcia
--     odpowiedzi na propozycję (0075, #88). Równoległość: dwie osobne sesje przez dblink.
--
-- Zestaw bywa uruchamiany w jednej zewnętrznej transakcji (tests/integration/rate-limit.test.ts:
-- BEGIN … ROLLBACK), której niezatwierdzonych danych inne sesje nie widzą. Dlatego fixture'y
-- tej sekcji zakłada i ZATWIERDZA osobna sesja (pp_setup), a testy wymagające własnej
-- transakcji (granica expires_at = now()) też idą przez osobną sesję — bez BEGIN/ROLLBACK
-- w tym skrypcie. Identyfikatory fixture'ów są stałe i unikalne dla sekcji PP.
-- ============================================================================
\set CANDP 'e7500000-0000-0000-0000-00000000000c'
\set OWNP  'e7500000-0000-0000-0000-0000000000a1'
\set COMPP 'e7500000-0000-0000-0000-0000000000f1'
\set JOBP1 'e7500000-0000-0000-0000-0000000000b1'
\set JOBP2 'e7500000-0000-0000-0000-0000000000b2'
\set JOBP3 'e7500000-0000-0000-0000-0000000000b3'
\set JOBP4 'e7500000-0000-0000-0000-0000000000b4'
\set KEYP1  'e7500000-0000-0000-0000-0000000000d1'
\set KEYP2  'e7500000-0000-0000-0000-0000000000d2'
\set KEYP3  'e7500000-0000-0000-0000-0000000000d3'
reset role; reset app.current_uid;

-- Sesje równoległe: dblink tylko w bazie testowej, poza schematem public.
create schema if not exists dbl;
create extension if not exists dblink schema dbl;

create function pg_temp.remote_connect(p_conn text) returns void
language plpgsql as $$
begin
  perform dbl.dblink_connect(p_conn, format('dbname=%s user=%s', current_database(), current_user));
end $$;

-- Ustawia w otwartej transakcji sesji rolę `authenticated` i uid; zwraca pid sesji.
create function pg_temp.remote_as(p_conn text, p_uid uuid) returns int
language plpgsql as $$
declare v_pid int; v_role text; v_rls text;
begin
  perform dbl.dblink_exec(p_conn, 'set local role authenticated');
  perform dbl.dblink_exec(p_conn, format('set local app.current_uid = %L', p_uid));
  select t.pid, t.r, t.rls into v_pid, v_role, v_rls
    from dbl.dblink(p_conn, 'select pg_backend_pid(), current_user::text, current_setting(''row_security'')')
      as t(pid int, r text, rls text);
  if v_role <> 'authenticated' or v_rls <> 'on' then
    raise exception 'ROLE GUARD: sesja % działa jako % (row_security=%)', p_conn, v_role, v_rls;
  end if;
  return v_pid;
end $$;

-- Otwiera osobne połączenie jako `authenticated` z danym uid w otwartej transakcji; zwraca pid.
create function pg_temp.remote_begin(p_conn text, p_uid uuid) returns int
language plpgsql as $$
begin
  perform pg_temp.remote_connect(p_conn);
  perform dbl.dblink_exec(p_conn, 'begin');
  -- Kolizja z niezatwierdzonym wierszem zewnętrznej transakcji (tryb BEGIN … ROLLBACK)
  -- ma skończyć się błędem, nie zawieszeniem: czekanie na nią jest niewykrywalne przez PG.
  perform dbl.dblink_exec(p_conn, 'set local lock_timeout = ''15s''');
  return pg_temp.remote_as(p_conn, p_uid);
end $$;

-- Wywołuje RPC jako dany użytkownik w osobnej, ZATWIERDZANEJ transakcji; zwraca wynik jako tekst.
create function pg_temp.remote_commit_call(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_val text;
begin
  perform pg_temp.remote_begin('pp_setup', p_uid);
  select t.v into v_val from dbl.dblink('pp_setup', p_sql) as t(v text);
  perform dbl.dblink_exec('pp_setup', 'commit');
  perform dbl.dblink_disconnect('pp_setup');
  return v_val;
end $$;

-- Czeka, aż sesja o danym pid zablokuje się na blokadzie trzymanej przez inną transakcję.
create function pg_temp.wait_blocked(p_pid int, p_name text) returns void
language plpgsql as $$
begin
  for i in 1..200 loop
    if cardinality(pg_blocking_pids(p_pid)) > 0 then return; end if;
    perform pg_sleep(0.05);
  end loop;
  raise exception 'ASSERT FAILED: % — druga sesja nie czekała na pierwszą', p_name;
end $$;

-- Odbiera wynik zapytania wysłanego asynchronicznie; błąd zwraca jako tekst (bez przerywania).
create function pg_temp.remote_result(p_conn text) returns text
language plpgsql as $$
declare v_val text; v_err text;
begin
  select t.v into v_val from dbl.dblink_get_result(p_conn, false) as t(v text);
  if not found then
    v_err := dbl.dblink_error_message(p_conn);
    v_val := 'ERROR: ' || coalesce(v_err, '?');
  end if;
  perform * from dbl.dblink_get_result(p_conn, false) as t(v text);  -- domknięcie wyniku
  return v_val;
end $$;

-- Fixture'y (zatwierdzone w osobnej sesji jako superuser).
select pg_temp.remote_connect('pp_setup');
select dbl.dblink_exec('pp_setup', $fx$
  insert into auth.users(id,email,name,raw_user_meta_data) values
    ('e7500000-0000-0000-0000-00000000000c','candp@test.be','Maja M',
     '{"role":"candidate","first_name":"Maja","last_name":"Mertens","locale":"pl"}'),
    ('e7500000-0000-0000-0000-0000000000a1','ownp@test.be','Otto M',
     '{"role":"employer","first_name":"Otto","last_name":"Maes","locale":"nl"}');
  insert into public.companies(id,name,status) values ('e7500000-0000-0000-0000-0000000000f1','Firma P','verified');
  insert into public.company_members(company_id,profile_id,role,is_active) values
    ('e7500000-0000-0000-0000-0000000000f1','e7500000-0000-0000-0000-0000000000a1','owner',true);
  insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
    ('e7500000-0000-0000-0000-0000000000b1','e7500000-0000-0000-0000-0000000000f1','job-p1','Operator P1','warehouse','permanent','Leuven','Flandria','active','pl'),
    ('e7500000-0000-0000-0000-0000000000b2','e7500000-0000-0000-0000-0000000000f1','job-p2','Operator P2','warehouse','permanent','Leuven','Flandria','active','pl'),
    ('e7500000-0000-0000-0000-0000000000b3','e7500000-0000-0000-0000-0000000000f1','job-p3','Operator P3','warehouse','permanent','Leuven','Flandria','active','pl'),
    ('e7500000-0000-0000-0000-0000000000b4','e7500000-0000-0000-0000-0000000000f1','job-p4','Operator P4','warehouse','permanent','Leuven','Flandria','active','pl');
  insert into public.candidate_profiles(profile_id, is_searchable) values ('e7500000-0000-0000-0000-00000000000c', false);
$fx$);
select dbl.dblink_disconnect('pp_setup');

select pg_temp.remote_commit_call(:'CANDP',
  'select public.apply_to_job(''' || :'JOBP1' || '''::uuid, ''pp-app-1'', null, null, null)::text') as app_pp \gset
select pg_temp.remote_commit_call(:'OWNP',
  'select public.get_or_create_conversation(''' || :'app_pp' || '''::uuid, null)::text') as conv_pp \gset
select pg_temp.remote_commit_call(:'OWNP',
  'select public.send_offer(''' || :'JOBP1' || '''::uuid, ''' || :'CANDP' || '''::uuid, ''pp-off-1'', ''Zapraszamy'', null)::text')
  as off_pp \gset
select count(*) as pp_notif0 from public.notifications
  where entity_id = :'conv_pp' and type = 'message_received' and profile_id = :'OWNP' \gset
-- PP1: „commit wykonany, odpowiedź utracona" — pierwsza transakcja zatwierdzona, ponowienie
-- w nowej transakcji z tym samym kluczem = ta sama wiadomość. (Zapisy wiadomości idą przez
-- osobne sesje: blokada wiersza rozmowy w zewnętrznej transakcji zakleszczyłaby PP5/PP6.)
select pg_temp.remote_commit_call(:'CANDP',
  'select public.send_message(''' || :'conv_pp' || '''::uuid, ''Czy mogę zacząć w poniedziałek?'', ''' || :'KEYP1' || '''::uuid)::text') as pp1a \gset
select pg_temp.remote_commit_call(:'CANDP',
  'select public.send_message(''' || :'conv_pp' || '''::uuid, ''Czy mogę zacząć w poniedziałek?'', ''' || :'KEYP1' || '''::uuid)::text') as pp1b \gset
select pg_temp.assert(:'pp1a' = :'pp1b', 'PP1 ponowienie z tym samym kluczem zwraca to samo messages.id');
select pg_temp.assert((select count(*) from public.messages where client_message_id = :'KEYP1') = 1,
  'PP1b jedna wiadomość dla klucza');
select pg_temp.assert(
  (select count(*) from public.notifications
     where entity_id = :'conv_pp' and type = 'message_received' and profile_id = :'OWNP') = :pp_notif0 + 1,
  'PP1c jedno powiadomienie dla odbiorcy mimo ponowienia');
select pg_temp.assert(
  (select count(*) from public.email_deliveries where entity_id = :'pp1a' and profile_id = :'OWNP') = 1,
  'PP1d jeden wpis e-mail dla odbiorcy mimo ponowienia');

-- PP2: kontrola ujemna — inny klucz z identyczną treścią to nowa, zasadna wiadomość.
select pg_temp.remote_commit_call(:'CANDP',
  'select public.send_message(''' || :'conv_pp' || '''::uuid, ''Czy mogę zacząć w poniedziałek?'', ''' || gen_random_uuid()::text || '''::uuid)::text') as pp2 \gset
select pg_temp.assert(:'pp2' <> :'pp1a'
  and (select count(*) from public.messages
         where conversation_id = :'conv_pp' and body = 'Czy mogę zacząć w poniedziałek?') = 2,
  'PP2 różne klucze z tą samą treścią tworzą dwie wiadomości (brak deduplikacji po treści)');

-- PP3: klucz jest per nadawca — druga strona z tym samym UUID pisze własną wiadomość.
select pg_temp.remote_commit_call(:'OWNP',
  'select public.send_message(''' || :'conv_pp' || '''::uuid, ''Tak, zapraszamy'', ''' || :'KEYP1' || '''::uuid)::text') as pp3 \gset
select pg_temp.assert(:'pp3' <> :'pp1a'
  and (select sender_id::text from public.messages where id = :'pp3') = :'OWNP',
  'PP3 ten sam klucz innego nadawcy nie zwraca cudzej wiadomości');

-- PP4: ponowienie nie omija kontroli członkostwa; brak klucza i stary podpis odrzucone.
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.send_message(''' || :'conv_pp' || '''::uuid, ''Czy mogę zacząć w poniedziałek?'', ''' || :'KEYP1' || '''::uuid)',
  'PERMISSION_DENIED', 'PP4 obcy z cudzym kluczem nie odczyta ani nie wyśle wiadomości');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CANDP'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.send_message(''' || :'conv_pp' || '''::uuid, ''bez klucza'', null)',
  'VALIDATION_FAILED', 'PP4b wysyłka bez identyfikatora operacji odrzucona');
select pg_temp.expect_error(
  'select public.send_message(''' || :'conv_pp' || '''::uuid, ''stary podpis'')',
  'does not exist', 'PP4c nie ma już ścieżki send_message bez klucza');
reset role; reset app.current_uid;

-- PP5: dwie RÓWNOLEGŁE próby z tym samym kluczem — druga czeka na commit pierwszej
-- i zwraca to samo id; efekty uboczne powstają raz.
select pg_temp.remote_begin('pp_a', :'CANDP') as pid_a \gset
select pg_temp.remote_begin('pp_b', :'CANDP') as pid_b \gset
select t.v as pp5a from dbl.dblink('pp_a',
  'select public.send_message(''' || :'conv_pp' || '''::uuid, ''Równolegle'', ''' || :'KEYP2' || '''::uuid)::text')
  as t(v text) \gset
select dbl.dblink_send_query('pp_b',
  'select public.send_message(''' || :'conv_pp' || '''::uuid, ''Równolegle'', ''' || :'KEYP2' || '''::uuid)::text');
select pg_temp.wait_blocked(:pid_b, 'PP5');
select dbl.dblink_exec('pp_a', 'commit');
select pg_temp.remote_result('pp_b') as pp5b \gset
select dbl.dblink_exec('pp_b', 'commit');
select dbl.dblink_disconnect('pp_a'); select dbl.dblink_disconnect('pp_b');
select pg_temp.assert(:'pp5a' = :'pp5b', 'PP5 równoległa próba z tym samym kluczem zwraca to samo messages.id');
select pg_temp.assert((select count(*) from public.messages where client_message_id = :'KEYP2') = 1,
  'PP5b jedna wiadomość po równoległych próbach');
select pg_temp.assert(
  (select count(*) from public.notifications
     where entity_id = :'conv_pp' and type = 'message_received' and profile_id = :'OWNP') = :pp_notif0 + 3,
  'PP5c równoległe próby dodały jedno powiadomienie (łącznie PP1+PP2+PP5)');
select pg_temp.assert(
  (select count(*) from public.email_deliveries where entity_id = :'pp5a' and profile_id = :'OWNP') = 1,
  'PP5d jeden wpis e-mail po równoległych próbach');

-- PP6: atomowość — pierwsza próba wycofana (rollback) nie zostawia efektów; równoległe
-- ponowienie z tym samym kluczem tworzy wiadomość i jej alerty dokładnie raz.
select pg_temp.remote_begin('pp_a', :'CANDP') as pid_a \gset
select pg_temp.remote_begin('pp_b', :'CANDP') as pid_b \gset
select t.v as pp6a from dbl.dblink('pp_a',
  'select public.send_message(''' || :'conv_pp' || '''::uuid, ''Po awarii'', ''' || :'KEYP3' || '''::uuid)::text')
  as t(v text) \gset
select dbl.dblink_send_query('pp_b',
  'select public.send_message(''' || :'conv_pp' || '''::uuid, ''Po awarii'', ''' || :'KEYP3' || '''::uuid)::text');
select pg_temp.wait_blocked(:pid_b, 'PP6');
select dbl.dblink_exec('pp_a', 'rollback');
select pg_temp.remote_result('pp_b') as pp6b \gset
select dbl.dblink_exec('pp_b', 'commit');
select dbl.dblink_disconnect('pp_a'); select dbl.dblink_disconnect('pp_b');
select pg_temp.assert(:'pp6b' <> :'pp6a' and :'pp6b' not like 'ERROR:%',
  'PP6 po wycofaniu pierwszej próby ponowienie zapisuje wiadomość');
select pg_temp.assert(
  (select count(*) from public.messages where client_message_id = :'KEYP3') = 1
  and (select count(*) from public.email_deliveries where entity_id = :'pp6a') = 0
  and (select count(*) from public.email_deliveries where entity_id = :'pp6b' and profile_id = :'OWNP') = 1,
  'PP6b wycofana próba nie zostawia wiadomości ani e-maila; ponowienie ma je raz');

-- PP7: wyścig accept/decline w dwóch sesjach — decline czeka na blokadę wiersza,
-- po commicie accept dostaje kontrolowany błąd; stan, historia i alerty pojedyncze.
select pg_temp.remote_begin('pp_a', :'CANDP') as pid_a \gset
select pg_temp.remote_begin('pp_b', :'CANDP') as pid_b \gset
select t.v as pp7a from dbl.dblink('pp_a',
  'select public.respond_to_offer(''' || :'off_pp' || '''::uuid, true)::text') as t(v text) \gset
select dbl.dblink_send_query('pp_b',
  'select public.respond_to_offer(''' || :'off_pp' || '''::uuid, false)::text');
select pg_temp.wait_blocked(:pid_b, 'PP7');
select dbl.dblink_exec('pp_a', 'commit');
select pg_temp.remote_result('pp_b') as pp7b \gset
select dbl.dblink_exec('pp_b', 'rollback');
select dbl.dblink_disconnect('pp_a'); select dbl.dblink_disconnect('pp_b');
select pg_temp.assert(:'pp7b' like 'ERROR:%VALIDATION_FAILED%',
  'PP7 druga równoległa odpowiedź kończy się kontrolowanym błędem');
select pg_temp.assert((select status::text from public.offers where id = :'off_pp') = 'accepted',
  'PP7b stan końcowy = odpowiedź, która pierwsza zdobyła blokadę');
select pg_temp.assert(
  (select count(*) from public.offer_status_history
     where offer_id = :'off_pp' and to_status in ('accepted', 'declined')) = 1,
  'PP7c jeden wpis historii odpowiedzi');
select pg_temp.assert(
  (select count(*) from public.notifications where entity_id = :'off_pp' and type = 'offer_status_changed') = 1
  and (select count(*) from public.email_deliveries where entity_id = :'off_pp' and template = 'offerAccepted') = 1
  and (select count(*) from public.email_deliveries where entity_id = :'off_pp' and template = 'offerDeclined') = 0,
  'PP7d jedno powiadomienie i jeden e-mail — tylko dla zwycięskiej odpowiedzi');

-- PP8: granica wygaśnięcia — propozycja aktywna tylko ściśle przed expires_at
-- (jak warstwa odczytu i UI). Przeszła i RÓWNA chwili odniesienia odrzucone, przyszła przyjęta.
insert into public.offers(job_id,candidate_id,company_id,sender_id,status,message,locale,idempotency_key,sent_at,expires_at)
  values (:'JOBP2',:'CANDP',:'COMPP',:'OWNP','sent','Przeszła','pl','pp-exp-past', now() - interval '2 days', now() - interval '1 second')
  returning id as off_pp_past \gset
insert into public.offers(job_id,candidate_id,company_id,sender_id,status,message,locale,idempotency_key,sent_at,expires_at)
  values (:'JOBP4',:'CANDP',:'COMPP',:'OWNP','sent','Przyszła','pl','pp-exp-future', now(), now() + interval '1 hour')
  returning id as off_pp_fut \gset
set role authenticated; set app.current_uid = :'CANDP'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.respond_to_offer(''' || :'off_pp_past' || '''::uuid, true)',
  'propozycja wygasła', 'PP8 propozycja po terminie odrzucona');
select public.respond_to_offer(:'off_pp_fut'::uuid, true);
reset role; reset app.current_uid;
select pg_temp.assert((select status::text from public.offers where id = :'off_pp_fut') = 'accepted',
  'PP8b propozycja przed terminem przyjęta');
select pg_temp.assert((select status::text from public.offers where id = :'off_pp_past') = 'sent',
  'PP8c odrzucona próba nie zmienia stanu wygasłej propozycji');

-- Równość: now() jest stałe w transakcji, więc expires_at = now() to dokładnie granica.
-- Własna transakcja w osobnej sesji: wstawienie propozycji i odpowiedź w tej samej chwili now().
select pg_temp.remote_connect('pp_eq');
select dbl.dblink_exec('pp_eq', 'begin');
select dbl.dblink_exec('pp_eq',
  'insert into public.offers(job_id,candidate_id,company_id,sender_id,status,message,locale,idempotency_key,sent_at,expires_at)
   values (''' || :'JOBP3' || ''',''' || :'CANDP' || ''',''' || :'COMPP' || ''',''' || :'OWNP' || ''',''sent'',''Na granicy'',''pl'',''pp-exp-eq'', now() - interval ''1 day'', now())');
select pg_temp.remote_as('pp_eq', :'CANDP') as pid_eq \gset
select dbl.dblink_send_query('pp_eq',
  'select public.respond_to_offer(o.id, false)::text from public.offers o where o.idempotency_key = ''pp-exp-eq''');
select pg_temp.remote_result('pp_eq') as pp8d \gset
select dbl.dblink_exec('pp_eq', 'rollback');
select dbl.dblink_disconnect('pp_eq');
select pg_temp.assert(:'pp8d' like 'ERROR:%propozycja wygasła%',
  'PP8d expires_at = now() to już po terminie (spójnie z expires_at > now())');
select pg_temp.assert(not exists (select 1 from public.offers where idempotency_key = 'pp-exp-eq'),
  'PP8e próba na granicy wycofana razem z transakcją sesji');

-- ============================================================================
-- QQ. Panel administratora (0076): funkcje admina, zgłoszenia, granty funkcji ról
-- ============================================================================
-- QQ1: anon nie wywoła RPC admina (grant), a zalogowany nie-admin dostaje PERMISSION_DENIED
--      także dla zgłoszeń (H3 pokrywa firmy).
select pg_temp.assert(
  not has_function_privilege('anon', 'public.admin_set_company_status(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_resolve_report(uuid, text)', 'execute'),
  'QQ1 anon bez EXECUTE na RPC admina');
reset role; reset app.current_uid;
insert into public.reports(id, reporter_id, target_type, target_id, reason)
  values ('f7000000-0000-0000-0000-0000000000a1', :'CANDB', 'job', :'JOBA', 'spam');
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_resolve_report(''f7000000-0000-0000-0000-0000000000a1''::uuid, ''dismissed'')',
  'PERMISSION_DENIED', 'QQ1b nie-admin nie rozstrzyga zgłoszenia');
reset role; reset app.current_uid;

-- QQ2: zgłoszenie — tożsamość i stan moderacji ustala baza, nie klient.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
insert into public.reports(id, reporter_id, target_type, target_id, reason, status, resolved_by, resolved_at, created_at)
  values ('f7000000-0000-0000-0000-0000000000a2', :'CANDA', 'job', :'JOBB', 'spam',
          'resolved', :'ADMIN', now(), now() - interval '400 days');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'open' and resolved_by is null and resolved_at is null
          and created_at > now() - interval '1 minute'
     from public.reports where id = 'f7000000-0000-0000-0000-0000000000a2'),
  'QQ2 klient nie ustawia statusu/rozstrzygnięcia/daty zgłoszenia');

-- QQ2b: zgłoszenie w cudzym imieniu — zapisuje się jako zgłoszenie zalogowanego (albo odrzucone).
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
do $$ begin
  insert into public.reports(id, reporter_id, target_type, target_id, reason)
    values ('f7000000-0000-0000-0000-0000000000a3', '22222222-2222-2222-2222-222222222222',
            'job', 'b1111111-1111-1111-1111-111111111111', 'spam');
exception when insufficient_privilege then null; end $$;
reset role; reset app.current_uid;
select pg_temp.assert(
  not exists (select 1 from public.reports
    where id = 'f7000000-0000-0000-0000-0000000000a3' and reporter_id is distinct from :'CANDA'),
  'QQ2b brak zgłoszenia przypisanego innemu użytkownikowi');

-- QQ2c: klient nie zmienia ani nie usuwa zgłoszenia (także własnego).
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'update public.reports set status = ''dismissed'' where id = ''f7000000-0000-0000-0000-0000000000a2''',
  'permission denied', 'QQ2c UPDATE zgłoszenia przez klienta odrzucony');
select pg_temp.expect_error(
  'delete from public.reports where id = ''f7000000-0000-0000-0000-0000000000a2''',
  'permission denied', 'QQ2d DELETE zgłoszenia przez klienta odrzucony');
-- QQ2e: twardy sufit długości treści zgłoszenia.
select pg_temp.expect_error(
  'insert into public.reports(reporter_id, target_type, target_id, reason, details) values (''11111111-1111-1111-1111-111111111111'', ''job'', ''b1111111-1111-1111-1111-111111111111'', ''spam'', repeat(''x'', 5001))',
  'reports_details_length', 'QQ2e zbyt długi opis zgłoszenia odrzucony');
select pg_temp.expect_error(
  'insert into public.reports(reporter_id, target_type, target_id, reason) values (''11111111-1111-1111-1111-111111111111'', ''job'', ''b1111111-1111-1111-1111-111111111111'', repeat(''x'', 201))',
  'reports_reason_length', 'QQ2f zbyt długi powód zgłoszenia odrzucony');
reset role; reset app.current_uid;

-- QQ2g: admin nadal rozstrzyga zgłoszenie przez RPC (audyt z aktorem admina).
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_resolve_report('f7000000-0000-0000-0000-0000000000a2'::uuid, 'dismissed');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'dismissed' and resolved_by = :'ADMIN'
     from public.reports where id = 'f7000000-0000-0000-0000-0000000000a2'),
  'QQ2g admin rozstrzyga zgłoszenie przez RPC');

-- QQ3: funkcje pomocnicze ról nie są wywoływalne przez anon (ani PUBLIC). Wyjątek:
--      is_job_company_member — używana w politykach SELECT dla anon (job_* tłumaczenia/relacje).
select pg_temp.assert(
  (select count(*) from unnest(array[
     'public.is_admin()', 'public.is_company_member(uuid)', 'public.is_company_admin(uuid)',
     'public.is_company_owner(uuid)', 'public.can_manage_jobs(uuid)', 'public.is_job_manager(uuid)',
     'public.is_conversation_member(uuid)', 'public.can_access_application(uuid)',
     'public.can_access_offer(uuid)', 'public.company_can_view_candidate(uuid)']) as f(sig)
   where has_function_privilege('anon', f.sig, 'execute')
      or has_function_privilege('public', f.sig, 'execute')) = 0,
  'QQ3 anon/PUBLIC bez EXECUTE na funkcjach pomocniczych ról');
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.is_admin()', 'permission denied', 'QQ3b anon nie woła is_admin()');
-- Polityki dla anon nadal działają (publiczne relacje ofert).
select pg_temp.assert((select count(*) from public.job_translations) >= 0, 'QQ3c anon czyta job_translations');
reset role;
-- QQ3d: zalogowany nadal korzysta z helperów (polityki/UI) — is_admin() zwraca własny stan.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.assert((select public.is_admin()) = true, 'QQ3d authenticated: is_admin() działa');
reset role; reset app.current_uid;

-- ============================================================================
-- MC. Dopasowanie (0079): data ważności certyfikatów kandydata (#96) oraz pięciu RÓŻNYCH
--     najlepiej dopasowanych kandydatów firmy przed limitem (#141). Identyfikatory e79….
-- ============================================================================
\set CANDMA 'e7900000-0000-0000-0000-0000000000ca'
\set CANDMB 'e7900000-0000-0000-0000-0000000000cb'
\set CANDMC 'e7900000-0000-0000-0000-0000000000cc'
\set CANDMD 'e7900000-0000-0000-0000-0000000000cd'
\set CANDME 'e7900000-0000-0000-0000-0000000000ce'
\set CANDMF 'e7900000-0000-0000-0000-0000000000cf'
\set CANDMH 'e7900000-0000-0000-0000-0000000000c8'
\set CANDMG 'e7900000-0000-0000-0000-0000000000c9'
\set OWNMC  'e7900000-0000-0000-0000-0000000000a1'
\set MEMMC  'e7900000-0000-0000-0000-0000000000a2'
\set OWNMY  'e7900000-0000-0000-0000-0000000000a3'
\set COMPMC 'e7900000-0000-0000-0000-0000000000f1'
\set COMPMY 'e7900000-0000-0000-0000-0000000000f2'
\set JOBMY  'e7900000-0000-0000-0000-0000000999b1'
reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data)
  select c.id::uuid, 'mc-' || c.tag || '@test.be', 'MC ' || c.tag,
         jsonb_build_object('role', c.role, 'first_name', 'MC', 'last_name', c.tag, 'locale', 'pl')
  from (values (:'CANDMA','a','candidate'), (:'CANDMB','b','candidate'), (:'CANDMC','c','candidate'),
               (:'CANDMD','d','candidate'), (:'CANDME','e','candidate'), (:'CANDMF','f','candidate'),
               (:'CANDMH','h','candidate'), (:'CANDMG','g','candidate'),
               (:'OWNMC','own','employer'), (:'MEMMC','mem','employer'), (:'OWNMY','owny','employer'))
       as c(id, tag, role);
insert into public.companies(id,name,status) values
  (:'COMPMC','Firma MC','verified'), (:'COMPMY','Firma MY','verified');
insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'COMPMC',:'OWNMC','owner',true), (:'COMPMC',:'MEMMC','member',true), (:'COMPMY',:'OWNMY','owner',true);
-- 24 oferty firmy MC (…01b1 … …24b1) i jedna oferta firmy MY.
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale)
  select format('e7900000-0000-0000-0000-000000%sb1', lpad(i::text, 4, '0'))::uuid, :'COMPMC',
         'job-mc-' || i, 'Oferta MC ' || i, 'warehouse', 'permanent', 'Gent', 'Flandria', 'active', 'pl'
  from generate_series(1, 24) i;
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'JOBMY',:'COMPMY','job-my','Oferta MY','warehouse','permanent','Gent','Flandria','active','pl');
-- Wyszukiwalne kompletne profile (A–G); H niewyszukiwalny i bez relacji z firmą.
insert into public.candidate_profiles(profile_id, is_searchable, profile_completed)
  select id::uuid, true, true
  from unnest(array[:'CANDMA',:'CANDMB',:'CANDMC',:'CANDMD',:'CANDME',:'CANDMF',:'CANDMG']) id;
insert into public.candidate_profiles(profile_id, is_searchable, profile_completed) values (:'CANDMH', false, true);
-- A: 100 do każdej z 24 ofert. B: 99 (oferta 2) i 50 (oferta 1). C: 98. D i E: remis 97. F: 90.
-- H: 95 (niewidoczny). G: 100 tylko do oferty INNEJ firmy.
insert into public.matches(candidate_id, job_id, score)
  select :'CANDMA', j.id, 100 from public.jobs j where j.company_id = :'COMPMC';
insert into public.matches(candidate_id, job_id, score) values
  (:'CANDMB','e7900000-0000-0000-0000-0000000002b1'::uuid, 99),
  (:'CANDMB','e7900000-0000-0000-0000-0000000001b1'::uuid, 50),
  (:'CANDMC','e7900000-0000-0000-0000-0000000003b1'::uuid, 98),
  (:'CANDMD','e7900000-0000-0000-0000-0000000004b1'::uuid, 97),
  (:'CANDME','e7900000-0000-0000-0000-0000000005b1'::uuid, 97),
  (:'CANDMF','e7900000-0000-0000-0000-0000000006b1'::uuid, 90),
  (:'CANDMH','e7900000-0000-0000-0000-0000000007b1'::uuid, 95),
  (:'CANDMG',:'JOBMY', 100);

-- MC1 kontrola ujemna: dawny odczyt (24 najlepsze wiersze, dedup dopiero w aplikacji) = sam A.
select pg_temp.assert(
  (select count(distinct s.candidate_id) from (
     select m.candidate_id from public.matches m join public.jobs j on j.id = m.job_id
     where j.company_id = :'COMPMC' order by m.score desc limit 24) s) = 1,
  'MC1 kontrola ujemna: limit 24 wierszy przed deduplikacją zostawiał jednego kandydata');

select set_config('app.current_uid', :'OWNMC', false);
set role authenticated; select pg_temp.assert_client_role();
select string_agg(candidate_id::text || '/' || job_id::text || '/' || score, ',' order by ord) as mc2
  from public.get_company_top_matches(:'COMPMC'::uuid, 5) with ordinality as t(candidate_id, job_id, score, ord) \gset
select count(*) as mc3 from public.get_company_top_matches(:'COMPMC'::uuid, 100) \gset
select count(*) as mc3b from public.get_company_top_matches(:'COMPMC'::uuid, 2) \gset
reset role; reset app.current_uid;
select pg_temp.assert(:'mc2' =
  :'CANDMA' || '/e7900000-0000-0000-0000-0000000001b1/100,' ||
  :'CANDMB' || '/e7900000-0000-0000-0000-0000000002b1/99,' ||
  :'CANDMC' || '/e7900000-0000-0000-0000-0000000003b1/98,' ||
  :'CANDMD' || '/e7900000-0000-0000-0000-0000000004b1/97,' ||
  :'CANDME' || '/e7900000-0000-0000-0000-0000000005b1/97',
  'MC2 pięciu różnych kandydatów, job_id = najwyższe dopasowanie (remis ofert → najmniejszy job_id, remis kandydatów → candidate_id)');
select pg_temp.assert(:'mc3' = '6',
  'MC3 bez limitu 5: A–F (bez H niewidocznego i G z innej firmy), każdy raz');
select pg_temp.assert(:'mc3b' = '2', 'MC3b limit respektowany');

-- MC4: izolacja — owner innej firmy i zwykły member nie dostają dopasowań firmy MC.
select set_config('app.current_uid', :'OWNMY', false);
set role authenticated; select pg_temp.assert_client_role();
select count(*) as mc4 from public.get_company_top_matches(:'COMPMC'::uuid, 5) \gset
select string_agg(candidate_id::text, ',') as mc4c from public.get_company_top_matches(:'COMPMY'::uuid, 5) \gset
reset role;
select set_config('app.current_uid', :'MEMMC', false);
set role authenticated; select pg_temp.assert_client_role();
select count(*) as mc4b from public.get_company_top_matches(:'COMPMC'::uuid, 5) \gset
reset role; reset app.current_uid;
select pg_temp.assert(:'mc4' = '0', 'MC4 firma B nie widzi dopasowań firmy A');
select pg_temp.assert(:'mc4c' = :'CANDMG', 'MC4c firma B widzi tylko swoje dopasowania');
select pg_temp.assert(:'mc4b' = '0', 'MC4b zwykły member bez dostępu do dopasowań (recruiter+)');

-- MC5: bramka weryfikacji firmy — niezweryfikowana firma nie dostaje wyników.
update public.companies set status = 'pending' where id = :'COMPMC';
select set_config('app.current_uid', :'OWNMC', false);
set role authenticated; select pg_temp.assert_client_role();
select count(*) as mc5 from public.get_company_top_matches(:'COMPMC'::uuid, 5) \gset
reset role; reset app.current_uid;
update public.companies set status = 'verified' where id = :'COMPMC';
select pg_temp.assert(:'mc5' = '0', 'MC5 firma niezweryfikowana nie dostaje dopasowanych kandydatów');

-- MC6: certyfikaty z datą ważności (#96) przez RPC; stara sygnatura text[] usunięta.
select pg_temp.assert(to_regprocedure('public.set_candidate_certificates(text[])') is null,
  'MC6 wersja text[] zastąpiona wersją jsonb');
select set_config('app.current_uid', :'CANDMA', false);
set role authenticated; select pg_temp.assert_client_role();
select public.set_candidate_certificates(
  '[{"label":" VCA ","expires_at":"2026-01-31"},"ADR",{"label":"VCA","expires_at":null},{"label":" "},{"label":"Heftruck","expires_at":""}]'::jsonb);
select string_agg(certificate_label || '=' || coalesce(expires_at::text, '-'), ',' order by certificate_label) as mc6
  from public.candidate_certificates cc
  join public.candidate_profiles cp on cp.id = cc.candidate_profile_id
  where cp.profile_id = :'CANDMA' \gset
reset role;
select pg_temp.assert(:'mc6' = 'ADR=-,Heftruck=-,VCA=2026-01-31',
  'MC6b zapis dat ważności: pierwsze wystąpienie etykiety wygrywa, pusta data = bezterminowy');

set role authenticated; select pg_temp.assert_client_role();
-- Zgodność ze starszą aplikacją: tablica etykiet (replace-all).
select public.set_candidate_certificates('["X","Y"]'::jsonb);
select string_agg(certificate_label || '=' || coalesce(expires_at::text, '-'), ',' order by certificate_label) as mc7
  from public.candidate_certificates cc
  join public.candidate_profiles cp on cp.id = cc.candidate_profile_id
  where cp.profile_id = :'CANDMA' \gset
select pg_temp.expect_error($q$select public.set_candidate_certificates('[{"label":"VCA","expires_at":"jutro"}]'::jsonb)$q$,
  'invalid input syntax for type date', 'MC7b niepoprawna data odrzucona');
select pg_temp.expect_error($q$select public.set_candidate_certificates('{"label":"VCA"}'::jsonb)$q$,
  'VALIDATION_FAILED', 'MC7c obiekt zamiast tablicy odrzucony');
reset role; reset app.current_uid;
select pg_temp.assert(:'mc7' = 'X=-,Y=-', 'MC7 tablica etykiet (stary klient) zapisuje bezterminowe certyfikaty');
-- Kontrola ujemna: pracodawca nie wywoła RPC kandydata (ensure_candidate_profile).
select set_config('app.current_uid', :'OWNMC', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.expect_error($q$select public.set_candidate_certificates('["VCA"]'::jsonb)$q$,
  '', 'MC7d pracodawca nie zapisze certyfikatów kandydata');
reset role; reset app.current_uid;

\echo '=================== ALL RLS TESTS PASSED ==================='
