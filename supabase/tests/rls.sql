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
-- Wymagania językowe/certyfikatowe aktywnej JOBA (fixture superusera — od 0077 klient nie zmienia
-- relacji opublikowanej oferty bezpośrednio; ścieżka edycji = update_published_job, sekcja OO).
insert into public.job_languages(job_id, language_label, level) values (:'JOBA', 'Niderlandzki', 'intermediate');
insert into public.job_certificates(job_id, certificate_label) values (:'JOBA', 'VCA');
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
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
-- set_job_* to ścieżka kreatora SZKICU (0077) — na czas sekcji JOBA jest szkicem.
reset role;
update public.jobs set status = 'draft' where id = :'JOBA';
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
update public.jobs set status = 'active' where id = :'JOBA';

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
-- Punkt wyjścia: EMPA (recruiter+ w COMPA, właściciel JOBA) ustawia zakresy jak kreator
-- (ścieżka szkicu — na czas sekcji JOBA jest szkicem, 0077).
reset role;
update public.jobs set status = 'draft' where id = :'JOBA';
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
update public.jobs set status = 'active' where id = :'JOBA';

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
  not has_function_privilege('anon', 'public.admin_set_company_status(uuid, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_resolve_report(uuid, text, text)', 'execute'),
  'QQ1 anon bez EXECUTE na RPC admina');
reset role; reset app.current_uid;
insert into public.reports(id, reporter_id, target_type, target_id, reason)
  values ('f7000000-0000-0000-0000-0000000000a1', :'CANDB', 'job', :'JOBA', 'spam');
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_resolve_report(''f7000000-0000-0000-0000-0000000000a1''::uuid, ''dismissed'')',
  'PERMISSION_DENIED', 'QQ1b nie-admin nie rozstrzyga zgłoszenia');
reset role; reset app.current_uid;

-- QQ2: zgłoszenie zapisuje wyłącznie RPC (0094) — bezpośredni INSERT klienta odrzucony,
-- także z podrobionym stanem moderacji albo w cudzym imieniu.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  $q$insert into public.reports(id, reporter_id, target_type, target_id, reason, status, resolved_by, resolved_at, created_at)
     values ('f7000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'job',
             'b1111111-1111-1111-1111-111111111111', 'spam', 'resolved',
             '77777777-7777-7777-7777-777777777777', now(), now() - interval '400 days')$q$,
  'permission denied', 'QQ2 klient nie zapisuje zgłoszenia bezpośrednio (ani stanu moderacji)');
select pg_temp.expect_error(
  $q$insert into public.reports(id, reporter_id, target_type, target_id, reason)
     values ('f7000000-0000-0000-0000-0000000000a3', '22222222-2222-2222-2222-222222222222',
             'job', 'b1111111-1111-1111-1111-111111111111', 'spam')$q$,
  'permission denied', 'QQ2b klient nie zapisuje zgłoszenia w cudzym imieniu');
reset role; reset app.current_uid;
select pg_temp.assert(
  not exists (select 1 from public.reports
    where id in ('f7000000-0000-0000-0000-0000000000a2', 'f7000000-0000-0000-0000-0000000000a3')),
  'QQ2a brak zgłoszeń z bezpośredniego zapisu klienta');
-- Zgłoszenie jakościowe do dalszych kroków (zapis serwerowy).
insert into public.reports(id, reporter_id, target_type, target_id, reason)
  values ('f7000000-0000-0000-0000-0000000000a2', :'CANDA', 'job', :'JOBB', 'spam');

-- QQ2c: klient nie zmienia ani nie usuwa zgłoszenia (także własnego).
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'update public.reports set status = ''dismissed'' where id = ''f7000000-0000-0000-0000-0000000000a2''',
  'permission denied', 'QQ2c UPDATE zgłoszenia przez klienta odrzucony');
select pg_temp.expect_error(
  'delete from public.reports where id = ''f7000000-0000-0000-0000-0000000000a2''',
  'permission denied', 'QQ2d DELETE zgłoszenia przez klienta odrzucony');
reset role; reset app.current_uid;
-- QQ2e: twardy sufit długości treści zgłoszenia (także dla zapisu serwerowego).
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
-- RR. Edycja opublikowanej oferty (0077, #325): update_published_job — atomowa rewizja
--     aktywnej/wstrzymanej oferty z kompletnością jak publish_job; bezpośredni zapis zablokowany
-- ============================================================================
\set JOBE 'a2222222-2222-2222-2222-222222222222'
-- Punkt wyjścia: JOBE aktywna (HH7), opublikowana przez EMPA (owner COMPA, verified).
-- Zgłoszenie kandydata na ofertę — po edycji musi zostać nietknięte razem z historią.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select public.apply_to_job(:'JOBE'::uuid, 'rr-edit-app-1', null, null, 'chętnie') as apprr \gset
reset role; reset app.current_uid;
select slug as rr_slug, published_at as rr_pub, updated_at as rr_upd from public.jobs where id = :'JOBE' \gset
select count(*) as rr_hist from public.application_status_history where application_id = :'apprr' \gset

-- Pełna, poprawna treść (kształt z akcji updatePublishedJob).
select set_config('pb.rr_ok', $j${
  "job": {"title": "Magazynier – zmiana nocna", "category": "warehouse", "occupation": "Magazynier",
          "contract_type": "temporary", "working_hours": "40 h", "shifts": "noc",
          "start_immediately": false, "start_date": "2026-10-15", "city": "Gandawa",
          "region": "Flandria", "address": null, "remote": false, "salary_min": 16,
          "salary_max": 18, "currency": "EUR", "salary_period": "hour",
          "min_experience_years": 1, "requires_driving_license": false,
          "no_language_required": true, "accommodation": true, "transport": false,
          "contact_email": "hr@firma-a.be"},
  "translation": {"description": "Praca na magazynie w Gandawie, zmiana nocna, stała ekipa.",
                  "responsibilities": ["Kompletacja zamówień", "Załadunek"],
                  "conditions": ["Umowa przez agencję"], "benefits": ["Dodatek nocny", "Parking"],
                  "company_description": "Firma A — logistyka."},
  "requirements_mandatory": ["Praca w nocy"], "requirements_optional": ["Wózek widłowy"],
  "skills_mandatory": ["Skaner"], "skills_optional": ["Excel"],
  "languages": [{"language": "Angielski", "level": "basic"}], "certificates": ["VCA"]
}$j$, false);
-- Ta sama treść z pustą listą wymagań obowiązkowych (niekompletna jak przy publish_job).
select set_config('pb.rr_bad', (current_setting('pb.rr_ok')::jsonb
  || '{"requirements_mandatory": []}'::jsonb)::text, false);

-- OO1: recruiter+ poprawia aktywną ofertę — status, slug, published_at i zgłoszenie bez zmian.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.update_published_job(:'JOBE'::uuid, current_setting('pb.rr_ok')::jsonb, :'rr_upd'::timestamptz) as rr_res \gset
reset role; reset app.current_uid;
select pg_temp.assert(
  (:'rr_res'::jsonb ->> 'slug') = :'rr_slug'
  and (:'rr_res'::jsonb ->> 'updated_at')::timestamptz = (select updated_at from public.jobs where id = :'JOBE')
  and (:'rr_res'::jsonb ->> 'updated_at')::timestamptz > :'rr_upd'::timestamptz,
  'RR1 update_published_job zwraca niezmieniony slug i nową wersję (updated_at)');
select pg_temp.assert(
  (select status::text = 'active' and slug = :'rr_slug' and published_at = :'rr_pub'::timestamptz
          and title = 'Magazynier – zmiana nocna' and salary_min = 16 and salary_period::text = 'hour'
          and start_date = '2026-10-15'::date and contract_type::text = 'temporary'
     from public.jobs where id = :'JOBE'),
  'RR1b nowa treść zapisana, status/slug/published_at bez zmian');
select pg_temp.assert(
  (select description like 'Praca na magazynie%' and responsibilities = array['Kompletacja zamówień', 'Załadunek']
          and highlights = array['Dodatek nocny', 'Parking'] and title = 'Magazynier – zmiana nocna'
     from public.job_translations where job_id = :'JOBE' and locale = 'pl')
  and (select array_agg(content order by position) from public.job_requirements
         where job_id = :'JOBE' and kind = 'mandatory') = array['Praca w nocy']
  and (select count(*) from public.job_skills where job_id = :'JOBE') = 2
  and exists (select 1 from public.job_languages where job_id = :'JOBE' and language_label = 'Angielski')
  and exists (select 1 from public.job_certificates where job_id = :'JOBE' and certificate_label = 'VCA'),
  'RR1c tłumaczenie i relacje zastąpione nową treścią');
select pg_temp.assert(
  (select status::text from public.applications where id = :'apprr') = 'submitted'
  and (select count(*) from public.application_status_history where application_id = :'apprr') = :'rr_hist'::int,
  'RR1d zgłoszenie i historia statusów nietknięte');
select pg_temp.assert(
  (select count(*) from public.get_public_job(:'rr_slug', 'pl') where title = 'Magazynier – zmiana nocna') = 1,
  'RR1e zmiana widoczna publicznie pod tym samym adresem');
select pg_temp.assert(
  exists (select 1 from public.audit_logs where action = 'job.update_published'
            and entity_id = :'JOBE'::uuid and actor_id = :'EMPA'::uuid
            and before_data->>'title' = 'Nowa oferta' and after_data->>'title' = 'Magazynier – zmiana nocna'),
  'RR1f wpis audytu z treścią przed/po');

-- OO2: CAS — nieaktualny updated_at (drugie okno edycji) nie nadpisuje po cichu.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.update_published_job(%L::uuid, %L::jsonb, %L::timestamptz)',
         :'JOBE', current_setting('pb.rr_ok'), :'rr_upd'),
  'JOB_EDIT_CONFLICT', 'RR2 nieaktualna wersja → JOB_EDIT_CONFLICT');
-- OO2b: kolejna poprawka z wersją zwróconą przez poprzedni zapis przechodzi.
select pg_temp.assert(
  (public.update_published_job(:'JOBE'::uuid, current_setting('pb.rr_ok')::jsonb,
     (:'rr_res'::jsonb ->> 'updated_at')::timestamptz) ->> 'slug') = :'rr_slug',
  'RR2b kolejna poprawka z aktualną wersją przechodzi');

-- OO3 (kontrola ujemna kompletności): brak wymagań obowiązkowych odrzucony, rewizja cofnięta w całości.
select pg_temp.expect_error(
  format('select public.update_published_job(%L::uuid, %L::jsonb)', :'JOBE',
         jsonb_set(current_setting('pb.rr_bad')::jsonb, '{job,title}', '"Tytuł, który nie może wejść"')::text),
  'VALIDATION_FAILED', 'RR3 niekompletna treść odrzucona (jak publish_job)');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select title from public.jobs where id = :'JOBE') = 'Magazynier – zmiana nocna'
  and (select count(*) from public.job_requirements where job_id = :'JOBE' and kind = 'mandatory') = 1,
  'RR3b odrzucona rewizja nie zostawia częściowych zmian (rollback)');

-- OO4: pusty tytuł / placeholder odrzucony.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.update_published_job(%L::uuid, %L::jsonb)', :'JOBE',
         jsonb_set(current_setting('pb.rr_ok')::jsonb, '{job,title}', '"   "')::text),
  'VALIDATION_FAILED', 'RR4 pusty tytuł odrzucony');

-- OO5: klient nie ominie RPC — bezpośredni UPDATE/relacje opublikowanej oferty zablokowane.
select pg_temp.expect_error(
  format($$update public.jobs set title = '' where id = %L$$, :'JOBE'),
  'JOB_NOT_DRAFT', 'RR5 bezpośredni UPDATE treści aktywnej oferty zablokowany');
select pg_temp.expect_error(
  format($$delete from public.job_requirements where job_id = %L$$, :'JOBE'),
  'JOB_NOT_DRAFT', 'RR5b bezpośrednie usunięcie wymagań aktywnej oferty zablokowane');
select pg_temp.expect_error(
  format($$update public.job_translations set description = '' where job_id = %L$$, :'JOBE'),
  'JOB_NOT_DRAFT', 'RR5c bezpośrednia zmiana tłumaczenia aktywnej oferty zablokowana');
select pg_temp.expect_error(
  format($$select public.set_job_requirements(%L::uuid, 'pl', 'mandatory', array[]::text[])$$, :'JOBE'),
  'JOB_NOT_DRAFT', 'RR5d set_job_* (ścieżka szkicu) nie opróżni relacji aktywnej oferty');
select pg_temp.expect_error(
  format($$select set_config('pracujbe.job_edit', %L, true), public.set_job_requirements(%L::uuid, 'pl', 'mandatory', array[]::text[])$$, '00000000-0000-0000-0000-000000000000', :'JOBE'),
  'JOB_NOT_DRAFT', 'RR5e znacznik innej oferty nie otwiera zapisu');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.job_requirements where job_id = :'JOBE' and kind = 'mandatory') = 1,
  'RR5f wymagania aktywnej oferty nietknięte po próbach obejścia');

-- OO6: wstrzymaną ofertę też można poprawić (status zostaje paused).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.set_job_status(:'JOBE'::uuid, 'pause');
select public.update_published_job(:'JOBE'::uuid,
  jsonb_set(current_setting('pb.rr_ok')::jsonb, '{job,salary_min}', '17'));
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'paused' and salary_min = 17 from public.jobs where id = :'JOBE'),
  'RR6 edycja wstrzymanej oferty zachowuje status paused');

-- OO7: bez weryfikacji firmy nie ma edycji (nawet wstrzymanej).
update public.companies set status = 'pending' where id = :'COMPA';
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.update_published_job(%L::uuid, %L::jsonb)', :'JOBE', current_setting('pb.rr_ok')),
  'COMPANY_NOT_VERIFIED', 'RR7 niezweryfikowana firma nie edytuje opublikowanej oferty');
reset role; reset app.current_uid;
update public.companies set status = 'verified' where id = :'COMPA';

-- OO8: zwykły member i obca firma bez prawa edycji.
insert into public.company_members(company_id, profile_id, role, is_active)
  values (:'COMPA', :'CANDB', 'member', true) on conflict do nothing;
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.update_published_job(%L::uuid, %L::jsonb)', :'JOBE', current_setting('pb.rr_ok')),
  'PERMISSION_DENIED', 'RR8 zwykły member nie edytuje oferty (recruiter+)');
reset role; reset app.current_uid;
delete from public.company_members where company_id = :'COMPA' and profile_id = :'CANDB';
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.update_published_job(%L::uuid, %L::jsonb)', :'JOBE', current_setting('pb.rr_ok')),
  'PERMISSION_DENIED', 'RR8b obca firma nie edytuje oferty');

-- OO9: zamknięta oferta i szkic nie idą tą ścieżką.
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.set_job_status(:'JOBE'::uuid, 'close');
select pg_temp.expect_error(
  format('select public.update_published_job(%L::uuid, %L::jsonb)', :'JOBE', current_setting('pb.rr_ok')),
  'JOB_NOT_EDITABLE', 'RR9 zamkniętej oferty nie edytuje się bez ponownego otwarcia');
select pg_temp.expect_error(
  format('select public.update_published_job(%L::uuid, %L::jsonb)',
         'e2222222-2222-2222-2222-222222222222', current_setting('pb.rr_ok')),
  'JOB_NOT_EDITABLE', 'RR9b szkic edytuje się kreatorem, nie update_published_job');
-- Kontrola: szkic nadal zapisuje relacje ścieżką kreatora (set_job_*).
select public.set_job_certificates('e2222222-2222-2222-2222-222222222222'::uuid, array['BHP']);
reset role; reset app.current_uid;
select pg_temp.assert(
  exists (select 1 from public.job_certificates
            where job_id = 'e2222222-2222-2222-2222-222222222222' and certificate_label = 'BHP'),
  'RR9c szkic dalej zapisuje relacje przez set_job_*');

-- ============================================================================
-- BL. Kandydat blokuje firmę (0078, #97): dwie firmy × dwóch kandydatów.
--     Firma zablokowana traci wgląd w profil/PII, wyszukiwanie, dopasowania, nie wyśle
--     propozycji ani wiadomości; druga firma i drugi kandydat bez zmian (kontrole ujemne).
-- ============================================================================
\set BLC1 'e7800000-0000-0000-0000-0000000000c1'
\set BLC2 'e7800000-0000-0000-0000-0000000000c2'
\set BLE1 'e7800000-0000-0000-0000-0000000000e1'
\set BLE2 'e7800000-0000-0000-0000-0000000000e2'
\set BLF1 'e7800000-0000-0000-0000-0000000000f1'
\set BLF2 'e7800000-0000-0000-0000-0000000000f2'
\set BLJ1 'e7800000-0000-0000-0000-0000000000b1'
\set BLJ2 'e7800000-0000-0000-0000-0000000000b2'
reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'BLC1','blc1@test.be','Bl C1','{"role":"candidate","first_name":"Bloker","last_name":"Jeden","locale":"pl"}'),
  (:'BLC2','blc2@test.be','Bl C2','{"role":"candidate","first_name":"Kontrola","last_name":"Dwa","locale":"nl"}'),
  (:'BLE1','ble1@test.be','Bl E1','{"role":"employer","first_name":"Rek","last_name":"Jeden","locale":"pl"}'),
  (:'BLE2','ble2@test.be','Bl E2','{"role":"employer","first_name":"Rek","last_name":"Dwa","locale":"pl"}');
insert into public.companies(id,name,status) values
  (:'BLF1','Firma Blok 1','verified'), (:'BLF2','Firma Blok 2','verified');
insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'BLF1',:'BLE1','owner',true), (:'BLF2',:'BLE2','owner',true);
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'BLJ1',:'BLF1','job-bl-1','Magazynier BL1','warehouse','permanent','Antwerpia','Flandria','active','pl'),
  (:'BLJ2',:'BLF2','job-bl-2','Magazynier BL2','warehouse','permanent','Antwerpia','Flandria','active','pl');
insert into public.candidate_profiles(profile_id, is_searchable, profile_completed) values
  (:'BLC1', true, true), (:'BLC2', true, true);
insert into public.matches(candidate_id, job_id, score) values
  (:'BLC1',:'BLJ1',80), (:'BLC2',:'BLJ1',70), (:'BLC1',:'BLJ2',60);

-- Obaj kandydaci aplikują do BLJ1; BLC1 także do BLJ2.
select set_config('app.current_uid', :'BLC1', false);
set role authenticated; select pg_temp.assert_client_role();
select public.apply_to_job(:'BLJ1'::uuid, 'bl-app-11', null, 'immediate', null) as blapp11 \gset
select public.apply_to_job(:'BLJ2'::uuid, 'bl-app-12', null, 'immediate', null) as blapp12 \gset
reset role;
select set_config('app.current_uid', :'BLC2', false);
set role authenticated; select pg_temp.assert_client_role();
select public.apply_to_job(:'BLJ1'::uuid, 'bl-app-21', null, 'immediate', null) as blapp21 \gset
reset role;

-- Przed blokadą BLE1 widzi PII BLC1 (punkt odniesienia).
select set_config('app.current_uid', :'BLE1', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.profiles where id = :'BLC1') = 1,
  'BL0 przed blokadą firma z relacją widzi profil kandydata');
reset role;

-- BL1: kandydat blokuje firmę BLF1 (idempotentnie), widzi blokadę na liście.
select set_config('app.current_uid', :'BLC1', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert(public.set_company_block(:'BLF1'::uuid, true), 'BL1 blokada zwraca true');
select public.set_company_block(:'BLF1'::uuid, true);
select pg_temp.assert(
  (select count(*) from public.candidate_company_blocks) = 1
  and (select company_name from public.get_my_company_blocks()) = 'Firma Blok 1',
  'BL1b jedna blokada (idempotencja), lista z nazwą firmy');
select pg_temp.assert(
  (select blocked from public.get_job_company_block(:'BLJ1'::uuid))
  and not (select blocked from public.get_job_company_block(:'BLJ2'::uuid)),
  'BL1c stan blokady na szczególe oferty');
-- Polecane: oferty firmy zablokowanej znikają tylko dla blokującego.
select pg_temp.assert(
  (select array_agg(id) from public.get_public_jobs_by_ids(array[:'BLJ1', :'BLJ2']::uuid[], 'pl'))
    = array[:'BLJ2']::uuid[],
  'BL1d polecane pomijają ofertę firmy zablokowanej');
-- Historia zostaje: własne aplikacje (także do firmy zablokowanej) nadal widoczne.
select pg_temp.assert(
  (select count(*) from public.applications where candidate_id = :'BLC1') = 2,
  'BL1e historia aplikacji kandydata nietknięta');
-- Bezpośredni zapis do tabeli blokad odrzucony (RPC-only).
select pg_temp.expect_error(
  format('insert into public.candidate_company_blocks(candidate_id, company_id) values (%L, %L)',
         :'BLC1', :'BLF2'),
  'permission denied', 'BL1f bezpośredni INSERT blokady odrzucony');
reset role;
select set_config('app.current_uid', :'BLC2', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.get_public_jobs_by_ids(array[:'BLJ1', :'BLJ2']::uuid[], 'pl')) = 2
  and (select count(*) from public.candidate_company_blocks) = 0,
  'BL1g kontrola ujemna: drugi kandydat widzi obie oferty i nie widzi cudzych blokad');
reset role;
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.get_public_jobs_by_ids(array[:'BLJ1', :'BLJ2']::uuid[], 'pl')) = 2,
  'BL1h gość widzi obie oferty (publiczny URL/lista bez zmian)');
reset role;

-- BL2: firma zablokowana — brak PII, wyszukiwania, dopasowań; firma nie widzi blokad.
select set_config('app.current_uid', :'BLE1', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.profiles where id = :'BLC1') = 0
  and (select count(*) from public.candidate_profiles where profile_id = :'BLC1') = 0
  and not public.company_can_view_candidate(:'BLC1'::uuid),
  'BL2 firma zablokowana nie widzi profilu/PII kandydata (także po ID)');
select pg_temp.assert(
  (select count(*) from public.profiles where id = :'BLC2') = 1
  and (select count(*) from public.candidate_profiles where profile_id = :'BLC2') = 1,
  'BL2b kontrola ujemna: ta sama firma widzi drugiego kandydata');
select pg_temp.assert(
  (select array_agg(candidate_id) from public.matches where job_id = :'BLJ1') = array[:'BLC2']::uuid[],
  'BL2c dopasowania firmy zablokowanej bez blokującego kandydata');
select pg_temp.assert(
  (select count(*) from public.applications where candidate_id = :'BLC1' and company_id = :'BLF1') = 1,
  'BL2d historyczna aplikacja pozostaje w firmie');
select pg_temp.assert(
  (select count(*) from public.candidate_company_blocks) = 0
  and (select count(*) from public.get_job_company_block(:'BLJ1'::uuid)) = 0
  and (select count(*) from public.get_my_company_blocks()) = 0,
  'BL2e firma nie odczyta blokad (brak informacji o blokadzie)');
select pg_temp.expect_error(
  format('select public.candidate_blocked_company(%L::uuid, %L::uuid)', :'BLC1', :'BLF1'),
  'permission denied', 'BL2f helper blokad niedostępny dla klienta');
select pg_temp.expect_error(
  format('select public.set_company_block(%L::uuid, true)', :'BLF2'),
  'PERMISSION_DENIED', 'BL2g pracodawca nie blokuje firm');

-- BL3: propozycja do blokującego = ten sam neutralny błąd co brak relacji; do drugiego OK.
select pg_temp.expect_error(
  format('select public.send_offer(%L::uuid, %L::uuid, %L)', :'BLJ1', :'BLC1', 'bl-offer-11'),
  'brak relacji firma–kandydat', 'BL3 propozycja do kandydata, który zablokował firmę, odrzucona');
select public.send_offer(:'BLJ1'::uuid, :'BLC2'::uuid, 'bl-offer-21') as bloffer21 \gset
reset role;
select pg_temp.assert(
  (select count(*) from public.offers where candidate_id = :'BLC1' and company_id = :'BLF1') = 0
  and (select count(*) from public.offers where id = :'bloffer21') = 1,
  'BL3b brak propozycji dla blokującego; kontrola ujemna: drugi kandydat dostał propozycję');

-- BL4: nowa rozmowa od strony firmy zablokowanej odrzucona; kandydat może ją założyć.
select set_config('app.current_uid', :'BLE1', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.get_or_create_conversation(%L::uuid, null)', :'blapp11'),
  'PERMISSION_DENIED', 'BL4 firma zablokowana nie otwiera nowej rozmowy');
select public.get_or_create_conversation(:'blapp21'::uuid, null) as blconv21 \gset
reset role;
select set_config('app.current_uid', :'BLC1', false);
set role authenticated; select pg_temp.assert_client_role();
select public.get_or_create_conversation(:'blapp11'::uuid, null) as blconv11 \gset
reset role;

-- BL5: wiadomość (trigger niezależny od sygnatury send_message): firma zablokowana → odmowa,
-- kandydat pisze; firma pisze do drugiego kandydata (kontrola ujemna).
reset app.current_uid;
select pg_temp.expect_error(
  format('insert into public.messages(conversation_id, sender_id, body) values (%L, %L, %L)',
         :'blconv11', :'BLE1', 'Od firmy'),
  'PERMISSION_DENIED', 'BL5 wiadomość firmy zablokowanej odrzucona');
insert into public.messages(conversation_id, sender_id, body) values (:'blconv11', :'BLC1', 'Od kandydata');
insert into public.messages(conversation_id, sender_id, body) values (:'blconv21', :'BLE1', 'Do kandydata 2');
select pg_temp.assert(
  (select count(*) from public.messages where conversation_id = :'blconv11') = 1
  and (select count(*) from public.messages where conversation_id = :'blconv21') = 1,
  'BL5b wiadomość kandydata i wiadomość do drugiego kandydata zapisane');

-- BL6: druga firma bez zmian (izolacja firm): widzi PII, dopasowanie, wysyła propozycję.
select set_config('app.current_uid', :'BLE2', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.profiles where id = :'BLC1') = 1
  and (select count(*) from public.candidate_profiles where profile_id = :'BLC1') = 1
  and (select count(*) from public.matches where candidate_id = :'BLC1' and job_id = :'BLJ2') = 1,
  'BL6 firma niezablokowana widzi profil i dopasowanie kandydata');
select public.send_offer(:'BLJ2'::uuid, :'BLC1'::uuid, 'bl-offer-12') as bloffer12 \gset
reset role;
select pg_temp.assert((select count(*) from public.offers where id = :'bloffer12') = 1,
  'BL6b propozycja firmy niezablokowanej zapisana');

-- BL7: odblokowanie przywraca dostęp (profil, dopasowanie, propozycja).
select set_config('app.current_uid', :'BLC1', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert(not public.set_company_block(:'BLF1'::uuid, false), 'BL7 odblokowanie zwraca false');
select public.set_company_block(:'BLF1'::uuid, false);
select pg_temp.assert(
  (select count(*) from public.get_public_jobs_by_ids(array[:'BLJ1']::uuid[], 'pl')) = 1,
  'BL7b po odblokowaniu oferta wraca do polecanych');
reset role;
select set_config('app.current_uid', :'BLE1', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.profiles where id = :'BLC1') = 1
  and (select count(*) from public.matches where candidate_id = :'BLC1' and job_id = :'BLJ1') = 1,
  'BL7c po odblokowaniu firma znów widzi profil i dopasowanie');
select public.send_offer(:'BLJ1'::uuid, :'BLC1'::uuid, 'bl-offer-11b') as bloffer11 \gset
reset role; reset app.current_uid;
select pg_temp.assert((select count(*) from public.offers where id = :'bloffer11') = 1,
  'BL7d po odblokowaniu propozycja przechodzi');

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

-- MC5b: blokada firmy przez kandydata (0078) obowiązuje też w RPC (SECURITY INVOKER + RLS
-- matches/candidate_profiles): B blokuje firmę MC → znika z wyniku, F wchodzi na jego miejsce.
select set_config('app.current_uid', :'CANDMB', false);
set role authenticated; select pg_temp.assert_client_role();
select public.set_company_block(:'COMPMC'::uuid, true);
reset role;
select set_config('app.current_uid', :'OWNMC', false);
set role authenticated; select pg_temp.assert_client_role();
select string_agg(candidate_id::text, ',' order by ord) as mc5b
  from public.get_company_top_matches(:'COMPMC'::uuid, 5) with ordinality as t(candidate_id, job_id, score, ord) \gset
reset role;
select set_config('app.current_uid', :'CANDMB', false);
set role authenticated; select pg_temp.assert_client_role();
select public.set_company_block(:'COMPMC'::uuid, false);
reset role; reset app.current_uid;
select pg_temp.assert(:'mc5b' = :'CANDMA' || ',' || :'CANDMC' || ',' || :'CANDMD' || ',' || :'CANDME' || ',' || :'CANDMF',
  'MC5b kandydat, który zablokował firmę, nie trafia do jej najlepiej dopasowanych');

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

-- ============================================================================
-- SAL. Okres stawki w filtrze, sortowaniu i facetach listy ofert (0080, #188).
--      Suwak = EUR brutto/mies.: month bez zmian, year / 12, hour bez przeliczenia
--      (oferta godzinowa i bez wynagrodzenia nie odpada z filtra, sort = na końcu).
--      Fixture'y izolowane słowem kluczowym „salp188"; identyfikatory unikalne dla SAL.
-- ============================================================================
\set JOBSALH  'e8000000-0000-0000-0000-0000000000b1'
\set JOBSALM  'e8000000-0000-0000-0000-0000000000b2'
\set JOBSALY  'e8000000-0000-0000-0000-0000000000b3'
\set JOBSALY2 'e8000000-0000-0000-0000-0000000000b4'
\set JOBSALM2 'e8000000-0000-0000-0000-0000000000b5'
\set JOBSALN  'e8000000-0000-0000-0000-0000000000b6'
reset role; reset app.current_uid;
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,
                        salary_min,salary_max,salary_period,published_at) values
  (:'JOBSALH', :'COMPL','sal-h', 'Salp188 H', 'warehouse','permanent','Mechelen','Flandria','active','pl', 20,   22,   'hour',  now() - interval '5 hours'),
  (:'JOBSALM', :'COMPL','sal-m', 'Salp188 M', 'warehouse','permanent','Mechelen','Flandria','active','pl', 3000, null, 'month', now() - interval '1 hour'),
  (:'JOBSALY', :'COMPL','sal-y', 'Salp188 Y', 'warehouse','permanent','Mechelen','Flandria','active','pl', 36000,null, 'year',  now() - interval '2 hours'),
  (:'JOBSALY2',:'COMPL','sal-y2','Salp188 Y2','warehouse','permanent','Mechelen','Flandria','active','pl', 24000,null, 'year',  now() - interval '4 hours'),
  (:'JOBSALM2',:'COMPL','sal-m2','Salp188 M2','warehouse','permanent','Mechelen','Flandria','active','pl', 2000, null, 'month', now() - interval '3 hours'),
  (:'JOBSALN', :'COMPL','sal-n', 'Salp188 N', 'warehouse','permanent','Mechelen','Flandria','active','pl', null, null, 'month', now() - interval '6 hours');

set role anon; reset app.current_uid; select pg_temp.assert_client_role();
-- SAL1: ekwiwalent miesięczny — rok / 12, godzina bez przeliczenia.
select pg_temp.assert(public.job_monthly_salary(36000, 'year') = 3000
  and public.job_monthly_salary(3000, 'month') = 3000
  and public.job_monthly_salary(20, 'hour') is null,
  'SAL1 month = kwota, year = kwota/12, hour = brak przeliczenia');

-- SAL2: filtr od 2500/mies. — roczna 36 000 (=3000) przechodzi, roczna 24 000 (=2000)
-- odpada (kontrola ujemna: surowe 24 000 >= 2500 przeszłoby), godzinowa i bez kwoty zostają.
select pg_temp.assert(
  (select array_agg(slug order by slug) from public.get_public_jobs(
     'pl','salp188',null,null,null,null,2500,null,null,null,null,null,'newest',100,0))
    = array['sal-h','sal-m','sal-n','sal-y'],
  'SAL2 filtr od 2500/mies. porównuje ekwiwalent miesięczny');

-- SAL3: filtr do 2500/mies. — roczna 36 000 odpada, roczna 24 000 i miesięczna 2000 zostają.
select pg_temp.assert(
  (select array_agg(slug order by slug) from public.get_public_jobs(
     'pl','salp188',null,null,null,null,null,2500,null,null,null,null,'newest',100,0))
    = array['sal-h','sal-m2','sal-n','sal-y2'],
  'SAL3 filtr do 2500/mies. nie porównuje surowej kwoty rocznej');

-- SAL4: sortowanie „najwyższe wynagrodzenie" po ekwiwalencie miesięcznym; remis → nowsze;
-- godzinowa i bez kwoty na końcu (kontrola ujemna: surowo 36 000 > 24 000 > 3000).
select pg_temp.assert(
  (select array_agg(slug) from public.get_public_jobs(
     'pl','salp188',null,null,null,null,null,null,null,null,null,null,'salary',100,0))
    = array['sal-m','sal-y','sal-m2','sal-y2','sal-h','sal-n'],
  'SAL4 sort po ekwiwalencie miesięcznym, nieporównywalne na końcu');

-- SAL5: licznik i facety stosują identyczną regułę jak listing.
select pg_temp.assert(
  public.get_public_jobs_count('pl','salp188',null,null,null,null,2500,null,null,null,null,null) = 4
  and public.get_public_jobs_count('pl','salp188',null,null,null,null,null,2500,null,null,null,null) = 4
  and (select total from public.get_public_job_filter_facets(
         'pl','salp188',null,null,null,null,2500,null,null,null,null,null)
       where dimension = 'total') = 4
  and (select total from public.get_public_job_filter_facets(
         'pl','salp188',null,null,null,null,3100,null,null,null,null,null)
       where dimension = 'total') = 2,
  'SAL5 licznik i facety zgodne z listingiem (od 3100: tylko godzinowa i bez kwoty)');
reset role;

-- ============================================================================
-- SP188. Jednostka filtra/sortu wynagrodzeń (0091, #188): p_salary_unit.
--        'month' = reguła 0080 bez zmian; 'hour' = tylko stawki godzinowe, miesięczne
--        i roczne NIE są przeliczane na godziny (nieporównywalne → nie odpadają, sort na
--        końcu). Fixture'y SAL + dwie stawki godzinowe o różnym wymiarze czasu pracy.
-- ============================================================================
\set JOBSPH2 'e8000000-0000-0000-0000-0000000000b7'
\set JOBSPH3 'e8000000-0000-0000-0000-0000000000b8'
reset role; reset app.current_uid;
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,
                        salary_min,salary_max,salary_period,working_hours,published_at) values
  (:'JOBSPH2',:'COMPL','sal-h2','Salp188 H2','warehouse','permanent','Mechelen','Flandria','active','pl', 14, null, 'hour', '20 h/tydz.', now() - interval '7 hours'),
  (:'JOBSPH3',:'COMPL','sal-h3','Salp188 H3','warehouse','permanent','Mechelen','Flandria','active','pl', 14, 16,   'hour', '38 h/tydz.', now() - interval '8 hours');

set role anon; reset app.current_uid; select pg_temp.assert_client_role();
-- SP188-1: kwota porównywalna w jednostce.
select pg_temp.assert(public.job_comparable_salary(20, 'hour', 'hour') = 20
  and public.job_comparable_salary(3000, 'month', 'hour') is null
  and public.job_comparable_salary(36000, 'year', 'hour') is null
  and public.job_comparable_salary(36000, 'year', 'month') = 3000
  and public.job_comparable_salary(20, 'hour', 'month') is null
  and public.job_comparable_salary(36000, 'year', 'week') = 3000,
  'SP188-1 hour = tylko stawka godzinowa; month = reguła 0080; nieznana jednostka = month');

-- SP188-2: od 18 EUR/godz. — 20–22/h przechodzi, 14/h i 14–16/h odpadają niezależnie od
-- wymiaru czasu pracy; miesięczne, roczne i bez kwoty zostają (nieporównywalne).
select pg_temp.assert(
  (select array_agg(slug order by slug) from public.get_public_jobs(
     'pl','salp188',null,null,null,null,18,null,null,null,null,null,'newest',100,0,'hour'))
    = array['sal-h','sal-m','sal-m2','sal-n','sal-y','sal-y2'],
  'SP188-2 filtr od 18 EUR/godz. porównuje wyłącznie stawki godzinowe');

-- SP188-3 (kontrola ujemna): ten sam próg w jednostce miesięcznej (domyślnej) nie wyklucza
-- stawek godzinowych i przepuszcza wszystkie kwoty miesięczne/roczne ≥ 18.
select pg_temp.assert(
  (select count(*) from public.get_public_jobs(
     'pl','salp188',null,null,null,null,18,null,null,null,null,null,'newest',100,0)) = 8
  and (select count(*) from public.get_public_jobs(
     'pl','salp188',null,null,null,null,18,null,null,null,null,null,'newest',100,0,'month')) = 8,
  'SP188-3 bez jednostki = month (0080), stawki godzinowe nie są filtrowane');

-- SP188-4: sort po stawce godzinowej — godzinowe malejąco (remis → nowsze), reszta na końcu
-- wg daty publikacji; sort miesięczny bez zmian względem SAL4.
select pg_temp.assert(
  (select array_agg(slug) from public.get_public_jobs(
     'pl','salp188',null,null,null,null,null,null,null,null,null,null,'salary',100,0,'hour'))
    = array['sal-h','sal-h3','sal-h2','sal-m','sal-y','sal-m2','sal-y2','sal-n']
  and (select array_agg(slug) from public.get_public_jobs(
     'pl','salp188',null,null,null,null,null,null,null,null,null,null,'salary',100,0))
    = array['sal-m','sal-y','sal-m2','sal-y2','sal-h','sal-n','sal-h2','sal-h3'],
  'SP188-4 sort po stawce godzinowej; sort miesięczny jak 0080');

-- SP188-5: licznik i facety w jednostce godzinowej zgodne z listingiem; do 15 EUR/godz.
-- odpada tylko 20–22/h (14–16 zachodzi na widełki).
select pg_temp.assert(
  public.get_public_jobs_count('pl','salp188',null,null,null,null,18,null,null,null,null,null,'hour') = 6
  and (select total from public.get_public_job_filter_facets(
         'pl','salp188',null,null,null,null,18,null,null,null,null,null,'hour')
       where dimension = 'total') = 6
  and public.get_public_jobs_count('pl','salp188',null,null,null,null,null,15,null,null,null,null,'hour') = 7
  and (select total from public.get_public_job_filter_facets(
         'pl','salp188',null,null,null,null,null,15,null,null,null,null,'hour')
       where dimension = 'total') = 7
  and (select array_agg(slug order by slug) from public.get_public_jobs(
     'pl','salp188',null,null,null,null,null,15,null,null,null,null,'newest',100,0,'hour'))
    = array['sal-h2','sal-h3','sal-m','sal-m2','sal-n','sal-y','sal-y2'],
  'SP188-5 licznik, facety i listing — ta sama reguła jednostki godzinowej');

-- SP188-6: wywołania nazwane bez p_salary_unit (PostgREST/supabase-js) nie są
-- niejednoznaczne — stare sygnatury usunięte, została jedna funkcja każdego RPC.
select pg_temp.assert(
  (select count(*) from public.get_public_jobs(p_locale => 'pl', p_keyword => 'salp188')) = 8
  and public.get_public_jobs_count(p_keyword => 'salp188', p_city => null) = 8
  and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
         and proname in ('get_public_jobs','get_public_jobs_count','get_public_job_filter_facets')) = 3,
  'SP188-6 jedna sygnatura każdego RPC, wywołanie nazwane bez jednostki działa');
reset role;

-- SP188-7: granty jak dotąd — anon/authenticated tak, PUBLIC nie.
select pg_temp.assert(
  has_function_privilege('anon', 'public.get_public_jobs(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,integer,integer,text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_public_jobs_count(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text)', 'execute')
  and has_function_privilege('anon', 'public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text)', 'execute')
  and not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('get_public_jobs','get_public_jobs_count','get_public_job_filter_facets')
      and a.grantee = 0),
  'SP188-7 granty anon/authenticated odtworzone, bez PUBLIC');

-- ============================================================================
-- ADM. RPC admina (0081, #420): macierz przejść, STALE_STATE, deleted_at, reopen
-- ============================================================================
reset role; reset app.current_uid;
insert into public.companies(id, name, status) values
  ('f8100000-0000-0000-0000-000000000001', 'Firma ADM pending', 'pending'),
  ('f8100000-0000-0000-0000-000000000002', 'Firma ADM usunięta', 'pending');
update public.companies set deleted_at = now() where id = 'f8100000-0000-0000-0000-000000000002';
insert into public.reports(id, reporter_id, target_type, target_id, reason)
  values ('f8100000-0000-0000-0000-0000000000a1', :'CANDB', 'job', :'JOBA', 'spam');

set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
-- ADM1: nieaktualny widok (admin widział 'unverified', a firma jest 'pending') → STALE_STATE, bez zmian.
select pg_temp.expect_error(
  'select public.admin_set_company_status(''f8100000-0000-0000-0000-000000000001''::uuid, ''verified'', ''unverified'')',
  'STALE_STATE', 'ADM1 nieaktualny widok firmy odrzucony');
-- ADM2: poprawne przejście z oczekiwanym statusem.
select public.admin_set_company_status('f8100000-0000-0000-0000-000000000001'::uuid, 'verified', 'pending');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'verified' and verified_at is not null and verified_by = :'ADMIN'
     from public.companies where id = 'f8100000-0000-0000-0000-000000000001'),
  'ADM2 pending → verified z kontrolą oczekiwanego stanu');
update public.companies set verified_at = '2026-01-01T00:00:00Z'
  where id = 'f8100000-0000-0000-0000-000000000001';

set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
-- ADM3: verified → verified niedozwolone (nie nadpisuje daty weryfikacji).
select pg_temp.expect_error(
  'select public.admin_set_company_status(''f8100000-0000-0000-0000-000000000001''::uuid, ''verified'')',
  'INVALID_TRANSITION', 'ADM3 ponowna weryfikacja zweryfikowanej firmy odrzucona');
-- ADM3b: przejścia spoza macierzy (→ pending/unverified, verified → rejected) odrzucone.
select pg_temp.expect_error(
  'select public.admin_set_company_status(''f8100000-0000-0000-0000-000000000001''::uuid, ''pending'')',
  'INVALID_TRANSITION', 'ADM3b verified → pending odrzucone');
select pg_temp.expect_error(
  'select public.admin_set_company_status(''f8100000-0000-0000-0000-000000000001''::uuid, ''rejected'')',
  'INVALID_TRANSITION', 'ADM3c verified → rejected odrzucone');
-- ADM4: firma usunięta miękko → NOT_FOUND.
select pg_temp.expect_error(
  'select public.admin_set_company_status(''f8100000-0000-0000-0000-000000000002''::uuid, ''verified'')',
  'NOT_FOUND', 'ADM4 status usuniętej firmy nie zmienia się');
-- ADM4b: nieznany status → VALIDATION_FAILED (nie surowy błąd enuma).
select pg_temp.expect_error(
  'select public.admin_set_company_status(''f8100000-0000-0000-0000-000000000001''::uuid, ''hacked'')',
  'VALIDATION_FAILED', 'ADM4b nieznany status firmy');
-- ADM5: verified → suspended → verified dozwolone (macierz), zawieszenie nie rusza verified_at.
select public.admin_set_company_status('f8100000-0000-0000-0000-000000000001'::uuid, 'suspended', 'verified',
                                      'Test zawieszenia ADM5');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'suspended' and verified_at = '2026-01-01T00:00:00Z'
     from public.companies where id = 'f8100000-0000-0000-0000-000000000001'),
  'ADM5 zawieszenie nie nadpisuje daty weryfikacji');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.companies where id = 'f8100000-0000-0000-0000-000000000002') = 'pending',
  'ADM4c usunięta firma bez zmian');

set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
-- ADM6: zgłoszenie — rozstrzygnięcie ustawia resolved_*, ponowne otwarcie je czyści.
select public.admin_resolve_report('f8100000-0000-0000-0000-0000000000a1'::uuid, 'resolved', 'open');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'resolved' and resolved_by = :'ADMIN' and resolved_at is not null
     from public.reports where id = 'f8100000-0000-0000-0000-0000000000a1'),
  'ADM6 rozstrzygnięcie zapisuje resolved_by/resolved_at');
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_resolve_report('f8100000-0000-0000-0000-0000000000a1'::uuid, 'reviewing', 'resolved');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'reviewing' and resolved_by is null and resolved_at is null
     from public.reports where id = 'f8100000-0000-0000-0000-0000000000a1'),
  'ADM6b ponowne otwarcie czyści resolved_by/resolved_at');
select pg_temp.assert(
  (select count(*) from public.audit_logs
     where action = 'report.resolved' and entity_id = 'f8100000-0000-0000-0000-0000000000a1') = 2,
  'ADM6c historia decyzji zostaje w audit_logs');

set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
-- ADM7: kontrola ujemna — nieaktualny widok zgłoszenia, przejście spoza macierzy.
select pg_temp.expect_error(
  'select public.admin_resolve_report(''f8100000-0000-0000-0000-0000000000a1''::uuid, ''dismissed'', ''open'')',
  'STALE_STATE', 'ADM7 nieaktualny widok zgłoszenia odrzucony');
select pg_temp.expect_error(
  'select public.admin_resolve_report(''f8100000-0000-0000-0000-0000000000a1''::uuid, ''open'')',
  'INVALID_TRANSITION', 'ADM7b reviewing → open odrzucone');
select pg_temp.expect_error(
  'select public.admin_resolve_report(''f8100000-0000-0000-0000-0000000000a1''::uuid, ''reviewing'')',
  'INVALID_TRANSITION', 'ADM7c reviewing → reviewing odrzucone');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.reports where id = 'f8100000-0000-0000-0000-0000000000a1') = 'reviewing',
  'ADM7d odrzucone próby nie zmieniły zgłoszenia');

-- ADM8: uprawnienia bez zmian — nie-admin i anon nie wołają nowych sygnatur.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_set_company_status(''f8100000-0000-0000-0000-000000000001''::uuid, ''verified'', ''suspended'')',
  'PERMISSION_DENIED', 'ADM8 nie-admin nie zmienia statusu firmy (nowa sygnatura)');
select pg_temp.expect_error(
  'select public.admin_resolve_report(''f8100000-0000-0000-0000-0000000000a1''::uuid, ''resolved'', ''reviewing'')',
  'PERMISSION_DENIED', 'ADM8b nie-admin nie rozstrzyga zgłoszenia (nowa sygnatura)');
reset role; reset app.current_uid;
select pg_temp.assert(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public'
                 and p.proname in ('admin_set_company_status', 'admin_resolve_report')
                 and p.pronargs = 2),
  'ADM8c stare dwuargumentowe sygnatury usunięte (brak obejścia macierzy)');


-- ============================================================================
-- CO28. Bootstrap firmy po rejestracji bez duplikatów (#28). Callback rejestracji woła
--       `create_first_company` (0072): blokada własnego profilu + ponowne sprawdzenie
--       członkostwa w jednej transakcji. Równoległość: osobne sesje przez dblink (PP).
-- ============================================================================
\set CO28A  'e2800000-0000-0000-0000-0000000000a1'
\set CO28B  'e2800000-0000-0000-0000-0000000000a2'
\set CO28C  'e2800000-0000-0000-0000-0000000000a3'
\set CO28I  'e2800000-0000-0000-0000-0000000000a4'
\set CO28D  'e2800000-0000-0000-0000-0000000000a5'
\set CO28K  'e2800000-0000-0000-0000-0000000000a6'
\set CO28M  'e2800000-0000-0000-0000-0000000000a7'
reset role; reset app.current_uid;

select pg_temp.remote_connect('co_setup');
select dbl.dblink_exec('co_setup', $fx$
  insert into auth.users(id,email,name,raw_user_meta_data) values
    ('e2800000-0000-0000-0000-0000000000a1','co28a@test.be','Ann A','{"role":"employer","locale":"pl"}'),
    ('e2800000-0000-0000-0000-0000000000a2','co28b@test.be','Bram B','{"role":"employer","locale":"nl"}'),
    ('e2800000-0000-0000-0000-0000000000a3','co28c@test.be','Cleo C','{"role":"employer","locale":"fr"}'),
    ('e2800000-0000-0000-0000-0000000000a4','co28i@test.be','Ines I','{"role":"employer","locale":"en"}'),
    ('e2800000-0000-0000-0000-0000000000a5','co28d@test.be','Dirk D','{"role":"employer","locale":"nl"}'),
    ('e2800000-0000-0000-0000-0000000000a6','co28k@test.be','Kaja K','{"role":"candidate","locale":"pl"}'),
    ('e2800000-0000-0000-0000-0000000000a7','co28m@test.be','Mila M','{"role":"employer","locale":"pl"}');
  update public.profiles set is_active = false where id = 'e2800000-0000-0000-0000-0000000000a4';
  update public.profiles set deleted_at = now() where id = 'e2800000-0000-0000-0000-0000000000a5';
  insert into public.companies(id,name,status) values ('e2800000-0000-0000-0000-0000000000f1','Firma CO28','unverified');
  insert into public.company_members(company_id,profile_id,role,is_active) values
    ('e2800000-0000-0000-0000-0000000000f1','e2800000-0000-0000-0000-0000000000a7','recruiter',false);
$fx$);
select dbl.dblink_disconnect('co_setup');

-- CO28-1: dwa RÓWNOCZESNE bootstrapy tego samego pracodawcy — druga transakcja czeka
-- na blokadę profilu i po commicie pierwszej zwraca tę samą firmę (created = false).
select pg_temp.remote_begin('co_a', :'CO28A') as pid_a \gset
select pg_temp.remote_begin('co_b', :'CO28A') as pid_b \gset
select t.v as co1a from dbl.dblink('co_a',
  'select (company_id::text || '':'' || created::text) from public.create_first_company(''Firma A'', ''co28-a-1'', null)')
  as t(v text) \gset
select dbl.dblink_send_query('co_b',
  'select (company_id::text || '':'' || created::text) from public.create_first_company(''Firma A'', ''co28-a-2'', null)');
select pg_temp.wait_blocked(:pid_b, 'CO28-1');
select dbl.dblink_exec('co_a', 'commit');
select pg_temp.remote_result('co_b') as co1b \gset
select dbl.dblink_exec('co_b', 'commit');
select dbl.dblink_disconnect('co_a'); select dbl.dblink_disconnect('co_b');
select pg_temp.assert(:'co1a' like '%:true' and :'co1b' = split_part(:'co1a', ':', 1) || ':false',
  'CO28-1 równoczesny bootstrap zwraca tę samą firmę (druga próba created = false)');
select pg_temp.assert(
  (select count(*) from public.company_members where profile_id = :'CO28A') = 1
  and (select count(*) from public.company_members cm
         where cm.company_id = split_part(:'co1a', ':', 1)::uuid and cm.role = 'owner') = 1
  and not exists (select 1 from public.companies where slug = 'co28-a-2'),
  'CO28-1b jedna nowa firma i jeden owner po dwóch równoczesnych wywołaniach');

-- CO28-2: kontrola ujemna — ta sama funkcja z usuniętą blokadą profilu (kopia ciała
-- z katalogu, jedyna różnica to brak FOR UPDATE) tworzy duplikat w tym samym scenariuszu.
-- Kopię zakłada i usuwa osobna, zatwierdzana sesja: zestaw bywa uruchamiany w BEGIN …
-- ROLLBACK (tests/integration/rate-limit.test.ts), a sesje dblink widzą tylko commit.
do $$
declare v_def text; v_nolock text;
begin
  v_def := pg_get_functiondef('public.create_first_company(text,text,text)'::regprocedure);
  v_nolock := replace(replace(v_def, 'public.create_first_company(', 'co28_neg.create_first_company_nolock('),
                      'where p.id = v_uid for update;', 'where p.id = v_uid;');
  if v_nolock = v_def or v_nolock like '%for update;%'
     or v_nolock not like '%co28_neg.create_first_company_nolock(%' then
    raise exception 'ASSERT FAILED: CO28-2 nie udało się usunąć blokady z kopii funkcji';
  end if;
  perform pg_temp.remote_connect('co_setup');
  perform dbl.dblink_exec('co_setup', 'create schema co28_neg');
  perform dbl.dblink_exec('co_setup', v_nolock);
  perform dbl.dblink_exec('co_setup', 'grant usage on schema co28_neg to authenticated');
  perform dbl.dblink_exec('co_setup',
    'grant execute on function co28_neg.create_first_company_nolock(text, text, text) to authenticated');
  perform dbl.dblink_disconnect('co_setup');
end $$;
select pg_temp.remote_begin('co_a', :'CO28B') as pid_a \gset
select pg_temp.remote_begin('co_b', :'CO28B') as pid_b \gset
select t.v as co2a from dbl.dblink('co_a',
  'select company_id::text from co28_neg.create_first_company_nolock(''Firma B'', ''co28-b-1'', null)')
  as t(v text) \gset
select t.v as co2b from dbl.dblink('co_b',
  'select company_id::text from co28_neg.create_first_company_nolock(''Firma B'', ''co28-b-2'', null)')
  as t(v text) \gset
select dbl.dblink_exec('co_a', 'commit'); select dbl.dblink_exec('co_b', 'commit');
select dbl.dblink_disconnect('co_a'); select dbl.dblink_disconnect('co_b');
select pg_temp.remote_connect('co_setup');
select dbl.dblink_exec('co_setup', 'drop schema co28_neg cascade');
select dbl.dblink_disconnect('co_setup');
select pg_temp.assert(:'co2a' <> :'co2b'
  and (select count(*) from public.company_members where profile_id = :'CO28B' and role = 'owner') = 2,
  'CO28-2 bez blokady profilu równoczesny bootstrap tworzy DWIE firmy (test wykrywa wyścig)');

-- CO28-3: pierwsza próba wycofana (awaria w trakcie) nie zostawia firmy ani członkostwa;
-- czekające ponowienie tworzy dokładnie jedną firmę.
select pg_temp.remote_begin('co_a', :'CO28C') as pid_a \gset
select pg_temp.remote_begin('co_b', :'CO28C') as pid_b \gset
select t.v as co3a from dbl.dblink('co_a',
  'select company_id::text from public.create_first_company(''Firma C'', ''co28-c-1'', null)') as t(v text) \gset
select dbl.dblink_send_query('co_b',
  'select (company_id::text || '':'' || created::text) from public.create_first_company(''Firma C'', ''co28-c-2'', null)');
select pg_temp.wait_blocked(:pid_b, 'CO28-3');
select dbl.dblink_exec('co_a', 'rollback');
select pg_temp.remote_result('co_b') as co3b \gset
select dbl.dblink_exec('co_b', 'commit');
select dbl.dblink_disconnect('co_a'); select dbl.dblink_disconnect('co_b');
select pg_temp.assert(:'co3b' like '%:true' and split_part(:'co3b', ':', 1) <> :'co3a'
  and not exists (select 1 from public.companies where id = :'co3a'::uuid),
  'CO28-3 wycofana próba nie zostawia firmy; ponowienie ją tworzy');
select pg_temp.assert(
  (select count(*) from public.company_members where profile_id = :'CO28C') = 1,
  'CO28-3b po awarii i ponowieniu jedno członkostwo ownera');

-- CO28-4: kandydat, profil nieaktywny, profil usunięty i samo nieaktywne członkostwo
-- nie tworzą firmy.
set role authenticated; set app.current_uid = :'CO28K'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.create_first_company(''Firma K'', ''co28-k'', null)',
  'PERMISSION_DENIED', 'CO28-4 kandydat nie tworzy firmy');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CO28I'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.create_first_company(''Firma I'', ''co28-i'', null)',
  'PERMISSION_DENIED', 'CO28-4b nieaktywny profil pracodawcy nie tworzy firmy');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CO28D'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.create_first_company(''Firma D'', ''co28-d'', null)',
  'PERMISSION_DENIED', 'CO28-4c usunięty profil pracodawcy nie tworzy firmy');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CO28M'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.create_first_company(''Firma M'', ''co28-m'', null)',
  'PERMISSION_DENIED', 'CO28-4d nieaktywne członkostwo nie tworzy firmy zastępczej');
reset role; reset app.current_uid;
select pg_temp.assert(
  not exists (select 1 from public.companies where slug in ('co28-k', 'co28-i', 'co28-d', 'co28-m'))
  and (select count(*) from public.company_members
         where profile_id in (:'CO28K', :'CO28I', :'CO28D')) = 0
  and (select count(*) from public.company_members where profile_id = :'CO28M') = 1,
  'CO28-4e odmowy nie zostawiły firm ani członkostw');

-- CO28-5: świadome tworzenie kolejnej firmy poza automatycznym bootstrapem nadal możliwe,
-- a późniejszy bootstrap nie dokłada firmy.
set role authenticated; set app.current_uid = :'CO28A'; select pg_temp.assert_client_role();
select public.create_company_with_owner('Firma A2', 'co28-a-second') is not null as co5 \gset
select created::text as co5b from public.create_first_company('Firma A', 'co28-a-3', null) \gset
reset role; reset app.current_uid;
select pg_temp.assert(:'co5'::boolean and :'co5b' = 'false'
  and (select count(*) from public.company_members where profile_id = :'CO28A') = 2,
  'CO28-5 druga firma z osobnej akcji, bootstrap po niej nie tworzy trzeciej');

-- ============================================================================
-- AV310. Decyzja admina o firmie (0084, #310): wymagane uzasadnienie, powiadomienie
--        i e-mail do właściciela w JEGO języku (Invariant #1), audyt z uzasadnieniem
-- ============================================================================
\set OWN310 'f8310000-0000-0000-0000-0000000000a1'
\set OWN310B 'f8310000-0000-0000-0000-0000000000a2'
\set REC310 'f8310000-0000-0000-0000-0000000000a3'
\set COMP310 'f8310000-0000-0000-0000-000000000001'
reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'OWN310','own310@test.be','Own 310','{"role":"employer","first_name":"Own","last_name":"310","locale":"pl"}'),
  (:'OWN310B','own310b@test.be','Own 310B','{"role":"employer","first_name":"Old","last_name":"Owner","locale":"pl"}'),
  (:'REC310','rec310@test.be','Rec 310','{"role":"employer","first_name":"Rec","last_name":"310","locale":"pl"}');
-- Właściciel wybrał francuski (preferred_locale), admin ma 'en' — e-mail musi być 'fr'.
update public.profiles set preferred_locale = 'fr' where id = :'OWN310';
insert into public.companies(id, name, status, vat_number) values
  (:'COMP310', 'Firma AV310', 'pending', 'BE0310310310');
insert into public.company_members(company_id, profile_id, role, is_active) values
  (:'COMP310', :'OWN310', 'owner', true),
  (:'COMP310', :'OWN310B', 'owner', true),
  (:'COMP310', :'REC310', 'recruiter', true);
-- Drugi właściciel traci dostęp (nieaktywny) — nie może dostać powiadomienia.
update public.company_members set is_active = false
  where company_id = :'COMP310' and profile_id = :'OWN310B';

-- AV310-1: odrzucenie bez uzasadnienia (brak / same spacje) → REASON_REQUIRED, bez zmian.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_set_company_status(''f8310000-0000-0000-0000-000000000001''::uuid, ''rejected'', ''pending'')',
  'REASON_REQUIRED', 'AV310-1 odrzucenie bez uzasadnienia odrzucone');
select pg_temp.expect_error(
  'select public.admin_set_company_status(''f8310000-0000-0000-0000-000000000001''::uuid, ''rejected'', ''pending'', ''   '')',
  'REASON_REQUIRED', 'AV310-1b uzasadnienie z samych spacji odrzucone');
-- AV310-2: uzasadnienie > 1000 znaków → REASON_TOO_LONG.
select pg_temp.expect_error(
  format('select public.admin_set_company_status(%L::uuid, ''rejected'', ''pending'', %L)',
         'f8310000-0000-0000-0000-000000000001', repeat('x', 1001)),
  'REASON_TOO_LONG', 'AV310-2 za długie uzasadnienie odrzucone');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'pending' and status_reason is null from public.companies where id = :'COMP310')
  and not exists (select 1 from public.notifications where entity_id = :'COMP310')
  and not exists (select 1 from public.email_deliveries where entity_id = :'COMP310'),
  'AV310-2b odrzucone próby bez zmian, powiadomień i e-maili');

-- AV310-3: odrzucenie z uzasadnieniem.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_set_company_status(:'COMP310'::uuid, 'rejected', 'pending', '  Numer VAT nie zgadza się z KBO.  ');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'rejected' and status_reason = 'Numer VAT nie zgadza się z KBO.'
     from public.companies where id = :'COMP310'),
  'AV310-3 status rejected + uzasadnienie (przycięte) zapisane');
select pg_temp.assert(
  (select count(*) from public.audit_logs
     where action = 'company.status_changed' and entity_id = :'COMP310' and actor_id = :'ADMIN'
       and before_data->>'status' = 'pending' and after_data->>'status' = 'rejected'
       and after_data->>'reason' = 'Numer VAT nie zgadza się z KBO.') = 1,
  'AV310-3b audyt: aktor admin, przejście i uzasadnienie');
select pg_temp.assert(
  (select count(*) from public.notifications
     where profile_id = :'OWN310' and entity_type = 'company' and entity_id = :'COMP310'
       and type = 'system' and data->>'kind' = 'company_status' and data->>'status' = 'rejected') = 1,
  'AV310-3c powiadomienie in-app do aktywnego właściciela');
select pg_temp.assert(
  not exists (select 1 from public.notifications
                where entity_id = :'COMP310' and profile_id in (:'OWN310B', :'REC310', :'ADMIN')),
  'AV310-3d brak powiadomienia dla nieaktywnego właściciela, rekrutera i admina');
select pg_temp.assert(
  (select count(*) from public.email_deliveries
     where entity_id = :'COMP310' and template = 'companyRejected' and profile_id = :'OWN310'
       and locale = 'fr' and payload->>'reason' = 'Numer VAT nie zgadza się z KBO.'
       and payload->>'companyName' = 'Firma AV310') = 1,
  'AV310-3e e-mail companyRejected w języku właściciela (fr), nie admina (en)');
select pg_temp.assert(
  (select count(*) from public.email_deliveries where entity_id = :'COMP310') = 1,
  'AV310-3f jeden e-mail na decyzję (tylko aktywny właściciel)');

-- AV310-4: właściciel widzi uzasadnienie pod RLS, ale nie może go zmienić; obca firma nie widzi.
set role authenticated; set app.current_uid = :'OWN310'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select status_reason from public.companies where id = 'f8310000-0000-0000-0000-000000000001')
    = 'Numer VAT nie zgadza się z KBO.',
  'AV310-4 właściciel czyta uzasadnienie swojej firmy');
select pg_temp.expect_error(
  'update public.companies set status_reason = null where id = ''f8310000-0000-0000-0000-000000000001''',
  'PERMISSION_DENIED', 'AV310-4b właściciel nie zmienia uzasadnienia');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.companies where id = 'f8310000-0000-0000-0000-000000000001') = 0,
  'AV310-4c obca firma nie widzi firmy ani uzasadnienia');
reset role; reset app.current_uid;

-- AV310-5: ponowne zgłoszenie przez właściciela (0072) nadal działa.
set role authenticated; set app.current_uid = :'OWN310'; select pg_temp.assert_client_role();
select public.request_company_reverification(:'COMP310'::uuid);
reset role; reset app.current_uid;
select pg_temp.assert((select status::text from public.companies where id = :'COMP310') = 'pending',
  'AV310-5 ponowne zgłoszenie rejected → pending');

-- AV310-6: weryfikacja czyści uzasadnienie, powiadomienie company_verified, e-mail bez powodu.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_set_company_status(:'COMP310'::uuid, 'verified', 'pending', 'ignorowane');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'verified' and status_reason is null from public.companies where id = :'COMP310'),
  'AV310-6 weryfikacja czyści uzasadnienie');
select pg_temp.assert(
  (select count(*) from public.notifications
     where profile_id = :'OWN310' and entity_id = :'COMP310' and type = 'company_verified') = 1,
  'AV310-6b powiadomienie company_verified');
select pg_temp.assert(
  (select count(*) from public.email_deliveries
     where entity_id = :'COMP310' and template = 'companyVerified' and locale = 'fr'
       and not (payload ? 'reason')) = 1,
  'AV310-6c e-mail companyVerified (fr) bez uzasadnienia');
select pg_temp.assert(
  (select after_data from public.audit_logs
     where action = 'company.status_changed' and entity_id = :'COMP310'
       and after_data->>'status' = 'verified') = '{"status": "verified"}'::jsonb,
  'AV310-6d audyt weryfikacji bez uzasadnienia');

-- AV310-7: zawieszenie wymaga uzasadnienia; z uzasadnieniem → companySuspended.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_set_company_status(''f8310000-0000-0000-0000-000000000001''::uuid, ''suspended'', ''verified'')',
  'REASON_REQUIRED', 'AV310-7 zawieszenie bez uzasadnienia odrzucone');
select public.admin_set_company_status(:'COMP310'::uuid, 'suspended', 'verified', 'Zgłoszenia oszustwa.');
-- AV310-7b: ponowienie z nieaktualnym widokiem (podwójne kliknięcie) → STALE_STATE, bez duplikatu.
select pg_temp.expect_error(
  'select public.admin_set_company_status(''f8310000-0000-0000-0000-000000000001''::uuid, ''suspended'', ''verified'', ''Zgłoszenia oszustwa.'')',
  'STALE_STATE', 'AV310-7b powtórzona decyzja odrzucona');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.email_deliveries
     where entity_id = :'COMP310' and template = 'companySuspended' and locale = 'fr'
       and payload->>'reason' = 'Zgłoszenia oszustwa.') = 1
  and (select count(*) from public.email_deliveries where entity_id = :'COMP310') = 3
  and (select count(*) from public.notifications where entity_id = :'COMP310') = 3,
  'AV310-7c zawieszenie: jeden e-mail companySuspended, łącznie 3 decyzje = 3 e-maile i 3 powiadomienia');

-- AV310-8: stara sygnatura bez uzasadnienia usunięta; nie-admin nie woła nowej.
select pg_temp.assert(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'admin_set_company_status'
                 and p.pronargs <> 4),
  'AV310-8 tylko czteroargumentowa sygnatura admin_set_company_status');
set role authenticated; set app.current_uid = :'OWN310'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_set_company_status(''f8310000-0000-0000-0000-000000000001''::uuid, ''verified'', ''suspended'', null)',
  'PERMISSION_DENIED', 'AV310-8b właściciel nie odwiesza własnej firmy');
reset role; reset app.current_uid;

-- ============================================================================
-- WZ192. Zapis kroku kreatora w jednej transakcji (0083, #192): save_job_draft — kolumny,
--        tłumaczenie i relacje razem; błąd w części relacji = brak częściowego zapisu
-- ============================================================================
\set JOBWZ 'e8300000-0000-0000-0000-0000000000b1'
reset role;
insert into public.jobs(id, company_id, created_by, slug, title, category, contract_type, city, region, status, default_locale)
  values (:'JOBWZ', :'COMPA', :'EMPA', 'draft-wz192', '', 'logistics', 'permanent', '', '', 'draft', 'pl');

set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
-- WZ192-1: krok 1 — kolumny oferty i tłumaczenie (tytuł) jednym wywołaniem.
select public.save_job_draft(:'JOBWZ'::uuid,
  '{"job": {"title": "Operator wózka", "category": "warehouse", "occupation": "Operator"}, "translation": {}}'::jsonb);
-- WZ192-2: krok 5 i 7 — tłumaczenie (patch) oraz komplet relacji.
select public.save_job_draft(:'JOBWZ'::uuid,
  '{"translation": {"description": "Praca na magazynie w Antwerpii.", "responsibilities": ["Załadunek"]}}'::jsonb);
select public.save_job_draft(:'JOBWZ'::uuid, $j${
  "job": {"requires_driving_license": false, "no_language_required": false},
  "requirements_optional": ["Wózek widłowy"], "skills_optional": ["Excel"],
  "languages": [{"language": "Angielski", "level": "basic"}], "certificates": ["VCA"]
}$j$::jsonb);
reset role; reset app.current_uid;
select pg_temp.assert(
  (select title = 'Operator wózka' and category::text = 'warehouse' and occupation = 'Operator'
          and status::text = 'draft' from public.jobs where id = :'JOBWZ')
  and (select title = 'Operator wózka' and description = 'Praca na magazynie w Antwerpii.'
              and responsibilities = array['Załadunek']
         from public.job_translations where job_id = :'JOBWZ' and locale = 'pl'),
  'WZ192-1 krok 1 i 5: kolumny i tłumaczenie zapisane, szkic zostaje szkicem');
select pg_temp.assert(
  (select array_agg(content) from public.job_requirements where job_id = :'JOBWZ' and kind = 'optional') = array['Wózek widłowy']
  and (select array_agg(skill_label) from public.job_skills where job_id = :'JOBWZ') = array['Excel']
  and (select array_agg(language_label) from public.job_languages where job_id = :'JOBWZ') = array['Angielski']
  and (select array_agg(certificate_label) from public.job_certificates where job_id = :'JOBWZ') = array['VCA'],
  'WZ192-2 krok 7: wszystkie relacje zapisane');

-- WZ192-3 (kontrola ujemna): zmiana tytułu tłumaczenia nie nadpisuje opisu (patch).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.save_job_draft(:'JOBWZ'::uuid,
  '{"job": {"title": "Operator wózka widłowego", "category": "warehouse", "occupation": "Operator"}, "translation": {}}'::jsonb);
reset role; reset app.current_uid;
select pg_temp.assert(
  (select title = 'Operator wózka widłowego' and description = 'Praca na magazynie w Antwerpii.'
     from public.job_translations where job_id = :'JOBWZ' and locale = 'pl'),
  'WZ192-3 krok bez pól tłumaczenia nie czyści opisu');

-- WZ192-4 (kontrola ujemna atomowości): krok 7 z błędną relacją (nieznany poziom języka)
-- — kolumny oferty, wymagania i umiejętności z tego samego kroku NIE zostają zapisane.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.save_job_draft(%L::uuid, %L::jsonb)', :'JOBWZ', $j${
    "job": {"requires_driving_license": true, "no_language_required": false},
    "requirements_optional": ["Nowe wymaganie"], "skills_optional": ["Nowa umiejętność"],
    "languages": [{"language": "Niemiecki", "level": "nie-ma-takiego"}], "certificates": ["Nowy certyfikat"]
  }$j$),
  'language_level', 'WZ192-4 błędna relacja odrzuca cały krok');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select requires_driving_license from public.jobs where id = :'JOBWZ') = false
  and (select array_agg(content) from public.job_requirements where job_id = :'JOBWZ' and kind = 'optional') = array['Wózek widłowy']
  and (select array_agg(skill_label) from public.job_skills where job_id = :'JOBWZ') = array['Excel']
  and (select array_agg(language_label) from public.job_languages where job_id = :'JOBWZ') = array['Angielski']
  and (select array_agg(certificate_label) from public.job_certificates where job_id = :'JOBWZ') = array['VCA'],
  'WZ192-4b odrzucony krok nie zostawia częściowego zapisu (kolumny i relacje bez zmian)');

-- WZ192-5 (kontrola ujemna): błąd kolumny (CHECK widełek) cofa też relacje tego wywołania.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.save_job_draft(%L::uuid, %L::jsonb)', :'JOBWZ',
    '{"job": {"salary_min": 20, "salary_max": 10}, "certificates": ["Inny"]}'),
  'check constraint', 'WZ192-5 błędne widełki odrzucają cały zapis');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select array_agg(certificate_label) from public.job_certificates where job_id = :'JOBWZ') = array['VCA']
  and (select salary_min is null from public.jobs where id = :'JOBWZ'),
  'WZ192-5b relacje i kolumny bez zmian po błędzie kolumny');

-- WZ192-6: granice — nieznane pole, nie-członek, oferta nie-szkic (edycję robi update_published_job).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.save_job_draft(%L::uuid, %L::jsonb)', :'JOBWZ', '{"job": {"status": "active"}}'),
  'VALIDATION_FAILED', 'WZ192-6 pole spoza listy (status) odrzucone');
select pg_temp.expect_error(
  format('select public.save_job_draft(%L::uuid, %L::jsonb)', :'JOBWZ', '{"translation": {"title": "x"}}'),
  'VALIDATION_FAILED', 'WZ192-6b pole tłumaczenia spoza listy odrzucone');
select pg_temp.expect_error(
  format('select public.save_job_draft(%L::uuid, %L::jsonb)', :'JOBE', '{"job": {"title": "Obejście"}}'),
  'JOB_NOT_DRAFT', 'WZ192-6c opublikowanej oferty nie zapisuje ścieżka szkicu');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.save_job_draft(%L::uuid, %L::jsonb)', :'JOBWZ', '{"job": {"title": "Cudzy"}}'),
  'PERMISSION_DENIED', 'WZ192-6d nie-członek nie zapisze cudzego szkicu');
reset role; reset app.current_uid;
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.save_job_draft(%L::uuid, %L::jsonb)', :'JOBWZ', '{"job": {"title": "Anon"}}'),
  'permission denied', 'WZ192-6e anon nie woła save_job_draft');
reset role;
select pg_temp.assert(
  (select title from public.jobs where id = :'JOBWZ') = 'Operator wózka widłowego'
  and (select status::text <> 'draft' and title <> 'Obejście' from public.jobs where id = :'JOBE'),
  'WZ192-6f odrzucone próby nic nie zmieniły');

-- ============================================================================
-- OB142. Onboarding kandydata: jeden krok = jedna transakcja (0082, #142)
-- Wstrzyknięty błąd w DRUGIEJ części kroku (trigger na relacji) nie zostawia pierwszej.
-- Kontrola ujemna: stara ścieżka (dwa osobne żądania) zostawia częściowy zapis.
-- ============================================================================
\set OBC '0b142000-0000-0000-0000-000000000001'
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'OBC','ob142@test.be','Ola B','{"role":"candidate","first_name":"Ola","last_name":"B","locale":"pl"}');

-- Wstrzykiwacz błędu: aktywny tylko, gdy ustawiono GUC ob142.fail_<tabela> = 'on'.
create function public.ob142_inject_failure() returns trigger language plpgsql as $$
begin
  if current_setting('ob142.fail_' || tg_table_name, true) = 'on' then
    raise exception 'OB142_INJECTED_FAILURE %', tg_table_name;
  end if;
  return new;
end $$;
create trigger ob142_fail before insert on public.candidate_skills
  for each row execute function public.ob142_inject_failure();
create trigger ob142_fail before insert on public.candidate_certificates
  for each row execute function public.ob142_inject_failure();

create function pg_temp.ob142_count(p_table text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I r join public.candidate_profiles cp '
                 'on cp.id = r.candidate_profile_id where cp.profile_id = %L::uuid',
                 p_table, '0b142000-0000-0000-0000-000000000001') into n;
  return n;
end $$;

set role authenticated; set app.current_uid = :'OBC'; select pg_temp.assert_client_role();
-- OB142-1: krok 3 — sukces zapisuje doświadczenie i umiejętności.
select public.save_candidate_onboarding_step3(4, array['Spawanie','Wózek widłowy','Spawanie']);
select public.save_candidate_onboarding_step3(4, array['Spawanie','Wózek widłowy','Spawanie']);
reset role; reset app.current_uid;
select pg_temp.assert(
  (select experience_years from public.candidate_profiles where profile_id = :'OBC') = 4,
  'OB142-1 krok 3 zapisuje experience_years');
select pg_temp.assert(pg_temp.ob142_count('candidate_skills') = 2,
  'OB142-1b krok 3 zapisuje umiejętności; retry bez duplikatów (dedup do 2)');

set role authenticated; set app.current_uid = :'OBC'; select pg_temp.assert_client_role();
-- OB142-2: krok 5 — sukces zapisuje języki i certyfikaty; retry idempotentny.
select public.save_candidate_onboarding_step5(
  '[{"language":"polski","level":"native"},{"language":"niderlandzki","level":"basic"}]'::jsonb,
  '[{"label":"VCA","expires_at":"2030-01-31"},{"label":"HACCP","expires_at":null}]'::jsonb);
select public.save_candidate_onboarding_step5(
  '[{"language":"polski","level":"native"},{"language":"niderlandzki","level":"basic"}]'::jsonb,
  '[{"label":"VCA","expires_at":"2030-01-31"},{"label":"HACCP","expires_at":null}]'::jsonb);
reset role; reset app.current_uid;
select pg_temp.assert(pg_temp.ob142_count('candidate_languages') = 2,
  'OB142-2 krok 5 zapisuje języki; retry bez duplikatów');
select pg_temp.assert(pg_temp.ob142_count('candidate_certificates') = 2,
  'OB142-2b krok 5 zapisuje certyfikaty; retry bez duplikatów');
select pg_temp.assert(
  (select expires_at from public.candidate_certificates cc
     join public.candidate_profiles cp on cp.id = cc.candidate_profile_id
    where cp.profile_id = :'OBC' and cc.certificate_label = 'VCA') = date '2030-01-31',
  'OB142-2c krok 5 zapisuje datę ważności certyfikatu');

-- OB142-3: krok 3 — błąd w zapisie umiejętności cofa też doświadczenie.
set role authenticated; set app.current_uid = :'OBC'; select pg_temp.assert_client_role();
set ob142.fail_candidate_skills = 'on';
select pg_temp.expect_error(
  'select public.save_candidate_onboarding_step3(9, array[''Murarz''])',
  'OB142_INJECTED_FAILURE', 'OB142-3 wstrzyknięty błąd umiejętności zwraca błąd kroku');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select experience_years from public.candidate_profiles where profile_id = :'OBC') = 4,
  'OB142-3b po błędzie umiejętności experience_years bez zmian');
select pg_temp.assert(pg_temp.ob142_count('candidate_skills') = 2
    and not exists (select 1 from public.candidate_skills cs
                      join public.candidate_profiles cp on cp.id = cs.candidate_profile_id
                     where cp.profile_id = :'OBC' and cs.skill_label = 'Murarz'),
  'OB142-3c po błędzie poprzednie umiejętności nietknięte');

-- OB142-4: krok 5 — błąd w zapisie certyfikatów cofa też języki.
set role authenticated; set app.current_uid = :'OBC'; select pg_temp.assert_client_role();
set ob142.fail_candidate_certificates = 'on';
select pg_temp.expect_error(
  'select public.save_candidate_onboarding_step5(''[{"language":"francuski","level":"fluent"}]''::jsonb, ''["ADR"]''::jsonb)',
  'OB142_INJECTED_FAILURE', 'OB142-4 wstrzyknięty błąd certyfikatów zwraca błąd kroku');
reset role; reset app.current_uid;
select pg_temp.assert(pg_temp.ob142_count('candidate_languages') = 2
    and not exists (select 1 from public.candidate_languages cl
                      join public.candidate_profiles cp on cp.id = cl.candidate_profile_id
                     where cp.profile_id = :'OBC' and cl.language_label = 'francuski'),
  'OB142-4b po błędzie certyfikatów języki bez zmian');
select pg_temp.assert(pg_temp.ob142_count('candidate_certificates') = 2,
  'OB142-4c po błędzie poprzednie certyfikaty nietknięte');

-- OB142-5: KONTROLA UJEMNA — stara ścieżka (osobne żądania, każde zatwierdzane samo)
-- przy tym samym wstrzykniętym błędzie zostawia częściowy zapis. Dowodzi, że test wykrywa błąd.
set role authenticated; set app.current_uid = :'OBC'; select pg_temp.assert_client_role();
update public.candidate_profiles set experience_years = 9 where profile_id = :'OBC';
select pg_temp.expect_error('select public.set_candidate_skills(array[''Murarz''])',
  'OB142_INJECTED_FAILURE', 'OB142-5 stara ścieżka: drugie żądanie kroku 3 zawodzi');
select public.set_candidate_languages('[{"language":"francuski","level":"fluent"}]'::jsonb);
select pg_temp.expect_error('select public.set_candidate_certificates(''["ADR"]''::jsonb)',
  'OB142_INJECTED_FAILURE', 'OB142-5b stara ścieżka: drugie żądanie kroku 5 zawodzi');
reset ob142.fail_candidate_skills; reset ob142.fail_candidate_certificates;
reset role; reset app.current_uid;
select pg_temp.assert(
  (select experience_years from public.candidate_profiles where profile_id = :'OBC') = 9,
  'OB142-5c stara ścieżka zostawia nowe experience_years mimo błędu (częściowy zapis)');
select pg_temp.assert(pg_temp.ob142_count('candidate_languages') = 1,
  'OB142-5d stara ścieżka zostawia zastąpione języki mimo błędu (częściowy zapis)');

-- OB142-6: walidacja i uprawnienia nowych funkcji.
set role authenticated; set app.current_uid = :'OBC'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.save_candidate_onboarding_step3(61, array[''x''])',
  'VALIDATION_FAILED', 'OB142-6 doświadczenie > 60 odrzucone');
select pg_temp.expect_error(
  'select public.save_candidate_onboarding_step5(''{"language":"x"}''::jsonb, ''[]''::jsonb)',
  'VALIDATION_FAILED', 'OB142-6b języki nie-tablica odrzucone');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.save_candidate_onboarding_step3(1, array[''x''])',
  'PERMISSION_DENIED', 'OB142-6c pracodawca nie zapisze kroku kandydata');
select pg_temp.expect_error('select public.save_candidate_onboarding_step5(''[]''::jsonb, ''[]''::jsonb)',
  'PERMISSION_DENIED', 'OB142-6d pracodawca nie zapisze kroku 5 kandydata');
reset role; reset app.current_uid;
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.save_candidate_onboarding_step3(1, array[''x''])',
  'permission denied', 'OB142-6e anon bez EXECUTE na kroku 3');
reset role;

drop trigger ob142_fail on public.candidate_skills;
drop trigger ob142_fail on public.candidate_certificates;
drop function public.ob142_inject_failure();

-- ============================================================================
-- EX72. Wygaszanie ofert (0085, #72): expire_due_jobs (granica, kontrole ujemne,
--       dwa równoległe wywołania), publish/resume/reopen po terminie, filtry niezależne
--       od crona (job_is_public/apply_to_job/get_job_match_profile).
-- ============================================================================
\set EXJ1  'e7200000-0000-0000-0000-000000000001'
\set EXJ2  'e7200000-0000-0000-0000-000000000002'
\set EXJ3  'e7200000-0000-0000-0000-000000000003'
\set EXJ4  'e7200000-0000-0000-0000-000000000004'
\set EXJ5  'e7200000-0000-0000-0000-000000000005'
\set EXJ6  'e7200000-0000-0000-0000-000000000006'
\set EXJ7  'e7200000-0000-0000-0000-000000000007'
\set EXJ8  'e7200000-0000-0000-0000-000000000008'
\set EXJ9  'e7200000-0000-0000-0000-000000000009'
\set EXJ10 'e7200000-0000-0000-0000-000000000010'
\set EXJ11 'e7200000-0000-0000-0000-000000000011'
\set EXJ12 'e7200000-0000-0000-0000-000000000012'
reset role; reset app.current_uid;

-- Punkt zerowy: wcześniejsze sekcje mogły zostawić przeterminowane aktywne oferty.
set role service_role; select public.expire_due_jobs(); reset role;

-- EX72-1: granica `expires_at = now()` (ta sama transakcja → identyczne now()) wygasa,
-- data przyszła nie (kontrola ujemna).
begin;
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,expires_at) values
  (:'EXJ1',:'COMPA','ex72-1','Oferta EX1','warehouse','permanent','Antwerpia','Flandria','active','pl', now()),
  (:'EXJ2',:'COMPA','ex72-2','Oferta EX2','warehouse','permanent','Antwerpia','Flandria','active','pl', now() + interval '1 day');
set local role service_role;
select public.expire_due_jobs() as ex_boundary \gset
commit;
reset role;
select pg_temp.assert(:ex_boundary = 1, 'EX72-1 expire_due_jobs zwraca liczbę zmienionych (granica = now())');
select pg_temp.assert(
  (select status::text from public.jobs where id = :'EXJ1') = 'expired', 'EX72-1b expires_at = now() → expired');
select pg_temp.assert(
  (select status::text from public.jobs where id = :'EXJ2') = 'active', 'EX72-1c data przyszła bez zmian');

-- Fixture'y (zatwierdzone): kontrole ujemne i dwie oferty do wywołań równoległych.
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,expires_at) values
  (:'EXJ3',:'COMPA','draft-ex72-3','Oferta EX3','warehouse','permanent','Antwerpia','Flandria','draft','pl', now() - interval '1 hour'),
  (:'EXJ4',:'COMPA','ex72-4','Oferta EX4','warehouse','permanent','Antwerpia','Flandria','paused','pl', now() - interval '1 hour'),
  (:'EXJ5',:'COMPA','ex72-5','Oferta EX5','warehouse','permanent','Antwerpia','Flandria','closed','pl', now() - interval '1 hour'),
  (:'EXJ6',:'COMPA','ex72-6','Oferta EX6','warehouse','permanent','Antwerpia','Flandria','active','pl', null),
  (:'EXJ7',:'COMPA','ex72-7','Oferta EX7','warehouse','permanent','Antwerpia','Flandria','active','pl', now() - interval '2 hours'),
  (:'EXJ8',:'COMPA','ex72-8','Oferta EX8','warehouse','permanent','Antwerpia','Flandria','active','pl', now() - interval '3 hours');
insert into public.job_translations(job_id, locale, title, description, responsibilities) values
  (:'EXJ3', 'pl', 'Oferta EX3', 'Opis oferty magazynowej EX3.', array['Kompletacja']),
  (:'EXJ4', 'pl', 'Oferta EX4', 'Opis oferty magazynowej EX4.', array['Kompletacja']);
insert into public.job_requirements(job_id, locale, kind, position, content) values
  (:'EXJ3', 'pl', 'mandatory', 0, 'Dyspozycyjność'),
  (:'EXJ4', 'pl', 'mandatory', 0, 'Dyspozycyjność');

-- EX72-2: dwa równoległe wywołania. Sesja 1 zmienia i trzyma blokady (bez commit),
-- sesja 2 w tym czasie kończy się bez błędu i bez zmian (SKIP LOCKED), a po commit
-- ponowienie nie zmienia już niczego.
select pg_temp.remote_connect('ex_s1');
select pg_temp.remote_connect('ex_s2');
select dbl.dblink_exec('ex_s1', 'begin');
select dbl.dblink_exec('ex_s1', 'set local role service_role');
select t.v as ex_s1 from dbl.dblink('ex_s1', 'select public.expire_due_jobs()::text') as t(v text) \gset
select dbl.dblink_exec('ex_s2', 'begin');
select dbl.dblink_exec('ex_s2', 'set local role service_role');
select dbl.dblink_exec('ex_s2', 'set local lock_timeout = ''5s''');
select t.v as ex_s2 from dbl.dblink('ex_s2', 'select public.expire_due_jobs()::text') as t(v text) \gset
select dbl.dblink_exec('ex_s2', 'commit');
select dbl.dblink_exec('ex_s1', 'commit');
select dbl.dblink_disconnect('ex_s1');
select dbl.dblink_disconnect('ex_s2');
select pg_temp.assert(:'ex_s1' = '2', 'EX72-2 pierwsza sesja wygasza dokładnie dwie oferty');
select pg_temp.assert(:'ex_s2' = '0', 'EX72-2b równoległa sesja bez błędu i bez podwójnej zmiany');
set role service_role;
select public.expire_due_jobs() as ex_retry \gset
reset role;
select pg_temp.assert(:ex_retry = 0, 'EX72-2c ponowione wywołanie idempotentne (0 zmian)');
select pg_temp.assert(
  (select count(*) from public.jobs where id in (:'EXJ7', :'EXJ8') and status = 'expired') = 2,
  'EX72-2d obie przeterminowane aktywne oferty → expired');
-- EX72-3: kontrole ujemne — szkic, wstrzymana, zamknięta, bez daty nie są zmieniane.
select pg_temp.assert(
  (select string_agg(status::text, ',' order by id) from public.jobs
     where id in (:'EXJ3', :'EXJ4', :'EXJ5', :'EXJ6')) = 'draft,paused,closed,active',
  'EX72-3 draft/paused/closed/bez daty bez zmian');
select pg_temp.assert(
  (select expires_at is not null from public.jobs where id = :'EXJ4'), 'EX72-3b data wstrzymanej bez zmian');

-- EX72-4: tylko service_role woła operację (klient i anon — brak uprawnień).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.expire_due_jobs()', 'permission denied', 'EX72-4 authenticated bez expire_due_jobs');
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.expire_due_jobs()', 'permission denied', 'EX72-4b anon bez expire_due_jobs');
reset role; reset app.current_uid;

-- EX72-5: publikacja szkicu z datą w przeszłości → JOB_EXPIRED (nie „aktywna niewidoczna”).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.publish_job(''e7200000-0000-0000-0000-000000000003''::uuid, ''ex72-3'')',
  'JOB_EXPIRED', 'EX72-5 publikacja szkicu po terminie odrzucona');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.jobs where id = :'EXJ3') = 'draft', 'EX72-5b szkic pozostaje szkicem');
-- EX72-5c: kontrola dodatnia — ta sama oferta z przyszłą datą publikuje się.
update public.jobs set expires_at = now() + interval '7 days' where id = :'EXJ3';
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.publish_job(:'EXJ3'::uuid, 'ex72-3');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'active' and expires_at > now() from public.jobs where id = :'EXJ3'),
  'EX72-5c szkic z przyszłą datą → active, data zachowana');

-- EX72-6: wznowienie wstrzymanej po terminie → JOB_EXPIRED, data NIE jest czyszczona po cichu.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.set_job_status(''e7200000-0000-0000-0000-000000000004''::uuid, ''resume'')',
  'JOB_EXPIRED', 'EX72-6 resume po terminie odrzucone');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'paused' and expires_at <= now() from public.jobs where id = :'EXJ4'),
  'EX72-6b wstrzymana z przeszłą datą bez zmian');
-- EX72-6c: ponowne otwarcie wstrzymanej po terminie → active, przeszła data usunięta.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.assert(public.set_job_status(:'EXJ4'::uuid, 'reopen') = 'active', 'EX72-6c reopen wstrzymanej po terminie');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'active' and expires_at is null from public.jobs where id = :'EXJ4'),
  'EX72-6d reopen usuwa przeszłą datę ważności');

-- EX72-7: ponowne otwarcie wygasłej (expired) — istniejący kontrakt, data usunięta.
insert into public.job_translations(job_id, locale, title, description, responsibilities)
  values (:'EXJ7', 'pl', 'Oferta EX7', 'Opis oferty magazynowej EX7.', array['Kompletacja']);
insert into public.job_requirements(job_id, locale, kind, position, content)
  values (:'EXJ7', 'pl', 'mandatory', 0, 'Dyspozycyjność');
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.assert(public.set_job_status(:'EXJ7'::uuid, 'reopen') = 'active', 'EX72-7 reopen expired');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'active' and expires_at is null from public.jobs where id = :'EXJ7'),
  'EX72-7b reopen expired usuwa przeszłą datę');

-- EX72-8: aktywna po terminie, zanim przeszedł cron — publicznie niedostępna, pauza
-- odrzucona, ponowne otwarcie dozwolone (usuwa datę).
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,expires_at) values
  (:'EXJ9',:'COMPA','ex72-9','Oferta EX9','warehouse','permanent','Antwerpia','Flandria','active','pl', now() - interval '1 minute');
insert into public.job_translations(job_id, locale, title, description, responsibilities)
  values (:'EXJ9', 'pl', 'Oferta EX9', 'Opis oferty magazynowej EX9.', array['Kompletacja']);
insert into public.job_requirements(job_id, locale, kind, position, content)
  values (:'EXJ9', 'pl', 'mandatory', 0, 'Dyspozycyjność');
select pg_temp.assert(not public.job_is_public(:'EXJ9'), 'EX72-8 aktywna po terminie niepubliczna bez crona');
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.apply_to_job(''e7200000-0000-0000-0000-000000000009''::uuid, ''ex72-apply'', null, ''immediate'', null)',
  'JOB_NOT_ACTIVE', 'EX72-8b aplikowanie po terminie odrzucone bez crona');
select pg_temp.assert(
  (select count(*) from public.get_job_match_profile(:'EXJ9')) = 0,
  'EX72-8c get_job_match_profile po terminie → brak wiersza');
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.set_job_status(''e7200000-0000-0000-0000-000000000009''::uuid, ''pause'')',
  'VALIDATION_FAILED', 'EX72-8d pauza aktywnej po terminie odrzucona');
select pg_temp.assert(public.set_job_status(:'EXJ9'::uuid, 'reopen') = 'active', 'EX72-8e reopen aktywnej po terminie');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'active' and expires_at is null from public.jobs where id = :'EXJ9'),
  'EX72-8f reopen usuwa przeszłą datę; oferta znowu publiczna');
select pg_temp.assert(public.job_is_public(:'EXJ9'), 'EX72-8g po reopen oferta publiczna');

-- EX72-9: get_job_match_profile — granica now() → brak; przyszła i brak daty → wiersz.
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,expires_at) values
  (:'EXJ10',:'COMPA','ex72-10','Oferta EX10','warehouse','permanent','Antwerpia','Flandria','active','pl', now() + interval '1 day'),
  (:'EXJ11',:'COMPA','ex72-11','Oferta EX11','warehouse','permanent','Antwerpia','Flandria','active','pl', null),
  (:'EXJ12',:'COMPA','ex72-12','Oferta EX12','warehouse','permanent','Antwerpia','Flandria','active','pl', now() + interval '1 day');
begin;
update public.jobs set expires_at = now() where id = :'EXJ12';
set local role authenticated; set local app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.get_job_match_profile(:'EXJ12')) = 0, 'EX72-9 match profile: expires_at = now() → brak');
select pg_temp.assert(
  (select count(*) from public.get_job_match_profile(:'EXJ10')) = 1, 'EX72-9b match profile: data przyszła → wiersz');
select pg_temp.assert(
  (select count(*) from public.get_job_match_profile(:'EXJ11')) = 1, 'EX72-9c match profile: bez daty → wiersz');
rollback;
reset role; reset app.current_uid;

-- ============================================================================
-- TM403. Zespół firmy i kolejna firma (0086, #403): zaproszenia po e-mailu,
-- hierarchia ról, ostatni owner, izolacja firm, kolejna firma z limitem.
-- ============================================================================
\set TMO 'e8700000-0000-0000-0000-0000000000a1'
\set TMR 'e8700000-0000-0000-0000-0000000000a2'
\set TMM 'e8700000-0000-0000-0000-0000000000a3'
\set TMB 'e8700000-0000-0000-0000-0000000000b1'
\set TMX 'e8700000-0000-0000-0000-0000000000c1'
\set TMCA 'e8700000-0000-0000-0000-0000000000f1'
\set TMCB 'e8700000-0000-0000-0000-0000000000f2'

reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'TMO','tmo@test.be','Olga O','{"role":"employer","first_name":"Olga","last_name":"Owner","locale":"pl"}'),
  (:'TMR','tmr@test.be','Rita R','{"role":"employer","first_name":"Rita","last_name":"Recruiter","locale":"fr"}'),
  (:'TMM','tmm@test.be','Marc M','{"role":"employer","first_name":"Marc","last_name":"Member","locale":"nl"}'),
  (:'TMB','tmb@test.be','Bert B','{"role":"employer","first_name":"Bert","last_name":"B","locale":"en"}'),
  (:'TMX','tmx@test.be','Xena X','{"role":"candidate","first_name":"Xena","last_name":"X","locale":"pl"}');
-- TMR na razie z NIEZWERYFIKOWANYM adresem (TM403-2); reszta zweryfikowana.
update auth.users set email_verified = true where id in (:'TMO', :'TMM', :'TMB', :'TMX');
insert into public.companies(id,name,status) values
  (:'TMCA','Firma TM A','verified'), (:'TMCB','Firma TM B','verified');
insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'TMCA',:'TMO','owner',true), (:'TMCB',:'TMB','owner',true);

-- TM403-1: owner zaprasza rekrutera; e-mail w języku ODBIORCY (fr), nie nadawcy (pl).
set role authenticated; set app.current_uid = :'TMO'; select pg_temp.assert_client_role();
select invitation_id as tminv, created as tmcreated
  from public.invite_company_member(:'TMCA', '  TMR@test.be ', 'recruiter') \gset
select pg_temp.assert(:'tmcreated'::boolean, 'TM403-1 zaproszenie utworzone');
-- Ponowienie: to samo zaproszenie, bez drugiego e-maila.
select invitation_id as tminv2, created as tmcreated2
  from public.invite_company_member(:'TMCA', 'tmr@test.be', 'recruiter') \gset
select pg_temp.assert(:'tminv' = :'tminv2' and not :'tmcreated2'::boolean,
  'TM403-1b ponowienie zwraca to samo zaproszenie');
select pg_temp.assert((select count(*) from public.get_company_invitations(:'TMCA')) = 1,
  'TM403-1c owner widzi jedno oczekujące zaproszenie');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.email_deliveries
     where profile_id = :'TMR' and template = 'teamInvitation') = 1
  and (select locale from public.email_deliveries
     where profile_id = :'TMR' and template = 'teamInvitation') = 'fr',
  'TM403-1d jeden e-mail teamInvitation w języku odbiorcy (fr)');
select pg_temp.assert(
  (select count(*) from public.notifications
     where profile_id = :'TMR' and entity_type = 'company_invitation') = 1,
  'TM403-1e powiadomienie in-app dla zapraszanego');

-- TM403-2: niezweryfikowany adres nie widzi i nie przyjmie zaproszenia.
set role authenticated; set app.current_uid = :'TMR'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.get_my_company_invitations()) = 0,
  'TM403-2 niezweryfikowany e-mail nie widzi zaproszeń');
select pg_temp.expect_error(
  'select public.respond_to_company_invitation(''' || :'tminv' || ''', true)',
  'NOT_FOUND', 'TM403-2b niezweryfikowany e-mail nie przyjmie zaproszenia');
reset role; reset app.current_uid;
update auth.users set email_verified = true where id = :'TMR';

-- TM403-3: obca osoba (firma B) nie przyjmie cudzego zaproszenia.
set role authenticated; set app.current_uid = :'TMB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.respond_to_company_invitation(''' || :'tminv' || ''', true)',
  'NOT_FOUND', 'TM403-3 cudze zaproszenie → NOT_FOUND');
reset role; reset app.current_uid;

-- TM403-4: adresat przyjmuje → aktywny recruiter z prawami recruiter+.
set role authenticated; set app.current_uid = :'TMR'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.get_my_company_invitations()) = 1,
  'TM403-4 adresat widzi zaproszenie');
select pg_temp.assert(public.respond_to_company_invitation(:'tminv', true) = :'TMCA'::uuid,
  'TM403-4b przyjęcie zwraca firmę');
select pg_temp.assert(public.respond_to_company_invitation(:'tminv', true) = :'TMCA'::uuid,
  'TM403-4c ponowienie przyjęcia idempotentne');
select pg_temp.assert(public.can_manage_jobs(:'TMCA'), 'TM403-4d recruiter zarządza ofertami');
select pg_temp.assert(not public.is_company_admin(:'TMCA'), 'TM403-4e recruiter nie jest adminem');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select role::text from public.company_members where company_id = :'TMCA' and profile_id = :'TMR') = 'recruiter',
  'TM403-4f członkostwo recruiter');

-- TM403-5: member — dołącza, ale nie zarządza zespołem ani ofertami (KONTROLE UJEMNE).
set role authenticated; set app.current_uid = :'TMO'; select pg_temp.assert_client_role();
select invitation_id as tminvm from public.invite_company_member(:'TMCA', 'tmm@test.be', 'member') \gset
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'TMM'; select pg_temp.assert_client_role();
select public.respond_to_company_invitation(:'tminvm', true);
reset role; reset app.current_uid;
select id as tmmid from public.company_members where company_id = :'TMCA' and profile_id = :'TMM' \gset
select id as tmrid from public.company_members where company_id = :'TMCA' and profile_id = :'TMR' \gset
select id as tmoid from public.company_members where company_id = :'TMCA' and profile_id = :'TMO' \gset

set role authenticated; set app.current_uid = :'TMM'; select pg_temp.assert_client_role();
select pg_temp.assert(not public.can_manage_jobs(:'TMCA'), 'TM403-5 member bez praw recruiter+');
select pg_temp.expect_error(
  'select public.set_company_member_role(''' || :'tmrid' || ''', ''member'')',
  'NOT_FOUND', 'TM403-5b member nie zmienia ról (RPC)');
select pg_temp.expect_error(
  'select public.set_company_member_active(''' || :'tmrid' || ''', false)',
  'NOT_FOUND', 'TM403-5c member nie dezaktywuje członków');
select pg_temp.expect_error(
  'select * from public.get_company_team(''' || :'TMCA' || ''')',
  'PERMISSION_DENIED', 'TM403-5d member nie widzi listy zespołu (e-maile)');
select pg_temp.expect_error(
  'select * from public.invite_company_member(''' || :'TMCA' || ''', ''x@test.be'', ''member'')',
  'PERMISSION_DENIED', 'TM403-5e member nie zaprasza');
update public.company_members set role = 'owner' where id = :'tmmid';
update public.company_members set role = 'member' where id = :'tmrid';
reset role; reset app.current_uid;
select pg_temp.assert(
  (select role::text from public.company_members where id = :'tmmid') = 'member'
  and (select role::text from public.company_members where id = :'tmrid') = 'recruiter',
  'TM403-5f bezpośredni UPDATE members nie zmienia ról (RLS)');

-- TM403-6: hierarchia — admin zarządza tylko recruiter/member.
set role authenticated; set app.current_uid = :'TMO'; select pg_temp.assert_client_role();
select public.set_company_member_role(:'tmrid', 'admin');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'TMR'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.get_company_team(:'TMCA')) = 3,
  'TM403-6 admin widzi zespół');
select public.set_company_member_role(:'tmmid', 'recruiter');
select pg_temp.expect_error(
  'select public.set_company_member_role(''' || :'tmmid' || ''', ''admin'')',
  'PERMISSION_DENIED', 'TM403-6b admin nie nadaje roli admin');
select pg_temp.expect_error(
  'select public.set_company_member_role(''' || :'tmmid' || ''', ''owner'')',
  'PERMISSION_DENIED', 'TM403-6c admin nie nadaje roli owner');
select pg_temp.expect_error(
  'select public.set_company_member_active(''' || :'tmoid' || ''', false)',
  'PERMISSION_DENIED', 'TM403-6d admin nie dezaktywuje ownera (RPC)');
select pg_temp.expect_error(
  'update public.company_members set is_active = false where id = ''' || :'tmoid' || '''',
  'PERMISSION_DENIED', 'TM403-6e admin nie dezaktywuje ownera (bezpośredni UPDATE)');
select pg_temp.expect_error(
  'delete from public.company_members where id = ''' || :'tmoid' || '''',
  'PERMISSION_DENIED', 'TM403-6f admin nie usuwa ownera (bezpośredni DELETE)');
select pg_temp.expect_error(
  'select public.set_company_member_role(''' || :'tmrid' || ''', ''member'')',
  'VALIDATION_FAILED', 'TM403-6g nikt nie zmienia własnej roli przez RPC');
select pg_temp.expect_error(
  'insert into public.company_members(company_id, profile_id, role) values ('''
  || :'TMCA' || ''', ''' || :'TMX' || ''', ''member'')',
  'permission denied', 'TM403-6h bezpośredni INSERT członkostwa odebrany (tylko zaproszenie)');
reset role; reset app.current_uid;
select pg_temp.assert((select role::text from public.company_members where id = :'tmmid') = 'recruiter',
  'TM403-6i admin zmienił member → recruiter');

-- TM403-7: ostatni owner nie do usunięcia/zdemotowania.
set role authenticated; set app.current_uid = :'TMO'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.set_company_member_active(''' || :'tmoid' || ''', false)',
  'VALIDATION_FAILED', 'TM403-7 owner nie dezaktywuje siebie przez RPC');
select pg_temp.expect_error(
  'update public.company_members set is_active = false where id = ''' || :'tmoid' || '''',
  'VALIDATION_FAILED', 'TM403-7b ostatni owner — dezaktywacja odrzucona');
select pg_temp.expect_error(
  'update public.company_members set role = ''admin'' where id = ''' || :'tmoid' || '''',
  'VALIDATION_FAILED', 'TM403-7c ostatni owner — degradacja odrzucona');
select pg_temp.expect_error(
  'delete from public.company_members where id = ''' || :'tmoid' || '''',
  'VALIDATION_FAILED', 'TM403-7d ostatni owner — usunięcie odrzucone');
-- Dezaktywacja i przywrócenie członka: dostęp znika i wraca.
select public.set_company_member_active(:'tmmid', false);
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'TMM'; select pg_temp.assert_client_role();
select pg_temp.assert(not public.is_company_member(:'TMCA'), 'TM403-7e dezaktywowany traci dostęp');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'TMO'; select pg_temp.assert_client_role();
select public.set_company_member_active(:'tmmid', true);
-- Transfer: owner awansuje admina do owner, nowy owner może zdegradować poprzedniego.
select public.set_company_member_role(:'tmrid', 'owner');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'TMR'; select pg_temp.assert_client_role();
select public.set_company_member_role(:'tmoid', 'admin');
select public.set_company_member_role(:'tmoid', 'owner');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.company_members
     where company_id = :'TMCA' and role = 'owner' and is_active) = 2,
  'TM403-7f transfer własności działa przy zachowaniu inwariantu');

-- TM403-8: firma B nie widzi i nie zmienia zespołu firmy A.
set role authenticated; set app.current_uid = :'TMB'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select * from public.get_company_team(''' || :'TMCA' || ''')',
  'PERMISSION_DENIED', 'TM403-8 obca firma bez listy zespołu');
select pg_temp.expect_error('select * from public.get_company_invitations(''' || :'TMCA' || ''')',
  'PERMISSION_DENIED', 'TM403-8b obca firma bez zaproszeń');
select pg_temp.expect_error(
  'select public.set_company_member_role(''' || :'tmmid' || ''', ''member'')',
  'NOT_FOUND', 'TM403-8c obca firma nie zmienia roli');
select pg_temp.expect_error(
  'select public.set_company_member_active(''' || :'tmmid' || ''', false)',
  'NOT_FOUND', 'TM403-8d obca firma nie dezaktywuje');
select pg_temp.expect_error(
  'select * from public.invite_company_member(''' || :'TMCA' || ''', ''x@test.be'', ''member'')',
  'PERMISSION_DENIED', 'TM403-8e obca firma nie zaprasza do A');
select pg_temp.expect_error('select count(*) from public.company_invitations',
  'permission denied', 'TM403-8f brak bezpośredniego odczytu zaproszeń');
select pg_temp.assert(
  (select count(*) from public.company_members where company_id = :'TMCA') = 0,
  'TM403-8g obca firma nie widzi członkostw A (RLS)');
reset role; reset app.current_uid;

-- TM403-9: konto kandydata nie dołącza do firmy; e-maila do kandydata nie kolejkujemy.
set role authenticated; set app.current_uid = :'TMO'; select pg_temp.assert_client_role();
select invitation_id as tminvx from public.invite_company_member(:'TMCA', 'tmx@test.be', 'member') \gset
select invitation_id as tminvn, created as tmcreatedn
  from public.invite_company_member(:'TMCA', 'nikt@test.be', 'member') \gset
reset role; reset app.current_uid;
select pg_temp.assert(:'tmcreatedn'::boolean, 'TM403-9 zaproszenie adresu bez konta — ta sama odpowiedź');
select pg_temp.assert(
  (select count(*) from public.email_deliveries where profile_id = :'TMX' and template = 'teamInvitation') = 0,
  'TM403-9b brak e-maila zaproszenia do konta kandydata');
set role authenticated; set app.current_uid = :'TMX'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.respond_to_company_invitation(''' || :'tminvx' || ''', true)',
  'PERMISSION_DENIED', 'TM403-9c kandydat nie przyjmie zaproszenia');
reset role; reset app.current_uid;

-- TM403-10: cofnięte i wygasłe zaproszenie nie działa; role spoza listy odrzucone.
set role authenticated; set app.current_uid = :'TMO'; select pg_temp.assert_client_role();
select invitation_id as tminvb from public.invite_company_member(:'TMCA', 'tmb@test.be', 'member') \gset
select public.revoke_company_invitation(:'tminvb');
select pg_temp.expect_error(
  'select * from public.invite_company_member(''' || :'TMCA' || ''', ''y@test.be'', ''owner'')',
  'VALIDATION_FAILED', 'TM403-10 zaproszenie na ownera odrzucone');
select pg_temp.expect_error(
  'select * from public.invite_company_member(''' || :'TMCA' || ''', ''bez-malpy'', ''member'')',
  'VALIDATION_FAILED', 'TM403-10b niepoprawny e-mail odrzucony');
select pg_temp.expect_error(
  'select * from public.invite_company_member(''' || :'TMCA' || ''', ''tmm@test.be'', ''member'')',
  'MEMBER_ALREADY_EXISTS', 'TM403-10c aktywny członek nie jest zapraszany ponownie');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'TMB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.respond_to_company_invitation(''' || :'tminvb' || ''', true)',
  'NOT_FOUND', 'TM403-10d cofnięte zaproszenie nie działa');
reset role; reset app.current_uid;
update public.company_invitations set expires_at = now() - interval '1 minute' where id = :'tminvn';
update public.company_invitations set status = 'pending', expires_at = now() - interval '1 minute'
  where id = :'tminvb';
set role authenticated; set app.current_uid = :'TMB'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.get_my_company_invitations()) = 0,
  'TM403-10e wygasłe zaproszenie niewidoczne');
select pg_temp.expect_error(
  'select public.respond_to_company_invitation(''' || :'tminvb' || ''', true)',
  'NOT_FOUND', 'TM403-10f wygasłe zaproszenie nie działa');
reset role; reset app.current_uid;
select pg_temp.assert(
  not exists (select 1 from public.company_members where company_id = :'TMCA' and profile_id = :'TMB'),
  'TM403-10g firma B nie dołączyła do A');

-- TM403-11: kolejna firma — owner, idempotencja, limit 5, audyt; kandydat odrzucony.
set role authenticated; set app.current_uid = :'TMB'; select pg_temp.assert_client_role();
select company_id as tmnew, created as tmnewc
  from public.create_additional_company('Druga TM', 'druga-tm-1', 'BE0123456789') \gset
select pg_temp.assert(:'tmnewc'::boolean, 'TM403-11 kolejna firma utworzona');
select pg_temp.assert(
  (select company_id from public.create_additional_company('druga tm', 'druga-tm-2')) = :'tmnew'::uuid,
  'TM403-11b podwójne kliknięcie → ta sama firma');
select public.create_additional_company('TM 3', 'tm-3');
select public.create_additional_company('TM 4', 'tm-4');
select public.create_additional_company('TM 5', 'tm-5');
select pg_temp.expect_error('select * from public.create_additional_company(''TM 6'', ''tm-6'')',
  'COMPANY_LIMIT_REACHED', 'TM403-11c limit 5 firm z rolą owner');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.companies where id = :'tmnew') = 'unverified'
  and (select role::text from public.company_members where company_id = :'tmnew' and profile_id = :'TMB') = 'owner'
  and exists (select 1 from public.audit_logs where action = 'company.created' and entity_id = :'tmnew'),
  'TM403-11d firma unverified, owner, wpis audytu');
select pg_temp.assert(
  exists (select 1 from public.audit_logs where action = 'company.member_role_changed'
            and entity_id = :'TMCA' and actor_id = :'TMR'),
  'TM403-11e zmiany ról w audycie z aktorem');
set role authenticated; set app.current_uid = :'TMX'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select * from public.create_additional_company(''Kand'', ''kand-1'')',
  'PERMISSION_DENIED', 'TM403-11f kandydat nie zakłada firmy');
reset role; reset app.current_uid;

-- TM403-12: anon bez EXECUTE.
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error('select * from public.get_my_company_invitations()',
  'permission denied', 'TM403-12 anon bez EXECUTE na zaproszeniach');
select pg_temp.expect_error('select * from public.create_additional_company(''A'', ''a'')',
  'permission denied', 'TM403-12b anon bez EXECUTE na kolejnej firmie');
reset role;

-- ============================================================================
-- UN45 (#45, 0087): wypisanie, ponowna kontrola zgody przy claimie, atomowy budżet.
-- ============================================================================
\set UNA 'e0450000-0000-0000-0000-0000000000a1'
\set UNB 'e0450000-0000-0000-0000-0000000000a2'
\set UNC 'e0450000-0000-0000-0000-0000000000a3'
\set UNE 'e0450000-0000-0000-0000-0000000000e1'
reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'UNA','una@test.be','Un A','{"role":"candidate","first_name":"Un","last_name":"A","locale":"fr"}'),
  (:'UNB','unb@test.be','Un B','{"role":"candidate","first_name":"Un","last_name":"B","locale":"nl"}'),
  (:'UNC','unc@test.be','Un C','{"role":"candidate","first_name":"Un","last_name":"C","locale":"en"}');

-- UN45-1: enqueue → wypisanie → claim NIE zwraca wiersza; wiersz wygaszony, nie usunięty.
select public.enqueue_email(:'UNA', 'statusChanged', 'application', :'UNE', 'un45-status-1',
                            '{"jobTitle":"X","companyName":"Y","status":"viewed"}'::jsonb);
select pg_temp.assert(
  (select locale from public.email_deliveries where idempotency_key = 'un45-status-1') = 'fr',
  'UN45-1 e-mail zakolejkowany w języku odbiorcy');
set role service_role;
select pg_temp.assert(public.email_unsubscribe(:'UNA', 'applications') is true,
  'UN45-1b pierwsze wypisanie zmienia preferencję');
select pg_temp.assert(public.email_unsubscribe(:'UNA', 'applications') is false,
  'UN45-1c ponowne wypisanie jest idempotentne (bez zmiany)');
reset role;
select pg_temp.assert(
  not exists (select 1 from public.claim_email_batch(100000) c where c.idempotency_key = 'un45-status-1'),
  'UN45-1d claim nie zwraca e-maila odbiorcy, który się wypisał');
select pg_temp.assert(
  (select status::text = 'failed' and suppressed_at is not null and error_message = 'suppressed_opt_out'
          and locked_at is null
     from public.email_deliveries where idempotency_key = 'un45-status-1'),
  'UN45-1e wiersz wygaszony (suppressed_at), ślad zostaje');
select pg_temp.assert(
  (select count(*) from public.audit_logs where action = 'email.unsubscribed' and entity_id = :'UNA') = 1,
  'UN45-1f jeden wpis audytu mimo dwóch wywołań');

-- UN45-2: po wypisaniu enqueue tej kategorii nic nie kolejkuje; inna kategoria wychodzi.
select public.enqueue_email(:'UNA', 'applicationViewed', 'application', :'UNE', 'un45-status-2', '{}'::jsonb);
select pg_temp.assert(not exists (select 1 from public.email_deliveries where idempotency_key = 'un45-status-2'),
  'UN45-2 enqueue po wypisaniu nie tworzy wiersza');
select public.enqueue_email(:'UNA', 'jobOffer', 'offer', :'UNE', 'un45-offer-1', '{}'::jsonb);
select pg_temp.assert(
  exists (select 1 from public.claim_email_batch(100000) c where c.idempotency_key = 'un45-offer-1'),
  'UN45-2b inna kategoria (propozycje) nadal wychodzi');

-- UN45-3: marketing tylko po opt-in — brak wiersza preferencji = brak newslettera.
select pg_temp.assert(public.email_allowed(:'UNB', 'newsletter') is false
    and public.email_allowed(:'UNB', 'statusChanged') is true
    and public.email_allowed(:'UNB', 'jobPublished') is true,
  'UN45-3 domyślne zgody: marketing wyłączony, transakcyjne włączone');
select public.enqueue_email(:'UNB', 'newsletter', null, null, 'un45-news-1', '{}'::jsonb);
select pg_temp.assert(not exists (select 1 from public.email_deliveries where idempotency_key = 'un45-news-1'),
  'UN45-3b newsletter bez opt-in nie trafia do kolejki');

-- UN45-4: KONTROLA UJEMNA — claim z 0021 (bez ponownej kontroli) wydałby wiersz osoby wypisanej.
-- Bez BEGIN/ROLLBACK (zestaw bywa uruchamiany w jednej zewnętrznej transakcji): stary claim
-- ogranicza się do wiersza testu, a jego dzierżawę zdejmujemy przed nowym claimem.
create function pg_temp.un45_claim_0021(p_key text) returns setof public.email_deliveries
language sql as $$
  update public.email_deliveries d set locked_at = now()
   where d.id in (select e.id from public.email_deliveries e
                   where e.status = 'queued' and e.next_attempt_at <= now() and e.locked_at is null
                     and e.idempotency_key = p_key
                   for update skip locked)
  returning d.*;
$$;
select public.enqueue_email(:'UNC', 'newMessage', 'conversation', :'UNE', 'un45-msg-1', '{}'::jsonb);
set role service_role; select public.email_unsubscribe(:'UNC', 'messages'); reset role;
select pg_temp.assert(
  exists (select 1 from pg_temp.un45_claim_0021('un45-msg-1')),
  'UN45-4 stary claim wydaje e-mail mimo wypisania (test wykrywa błąd)');
update public.email_deliveries set locked_at = null where idempotency_key = 'un45-msg-1';
select pg_temp.assert(
  not exists (select 1 from public.claim_email_batch(100000) c where c.idempotency_key = 'un45-msg-1'),
  'UN45-4b nowy claim wygasza ten sam wiersz');

-- UN45-5: walidacja i uprawnienia.
set role service_role;
select pg_temp.expect_error('select public.email_unsubscribe(''e0450000-0000-0000-0000-0000000000a1'', ''all'')',
  'VALIDATION_FAILED', 'UN45-5 nieznana kategoria odrzucona');
select pg_temp.assert(public.email_unsubscribe('e0450000-0000-0000-0000-00000000ffff', 'offers') is false,
  'UN45-5b nieistniejący profil: neutralne false, bez błędu');
reset role;
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.email_unsubscribe(''e0450000-0000-0000-0000-0000000000a2'', ''offers'')',
  'permission denied', 'UN45-5c anon nie wypisze nikogo bezpośrednio');
select pg_temp.expect_error('select * from public.take_email_send_budget(''newsletter'')',
  'permission denied', 'UN45-5d anon nie pobiera budżetu');
reset role;
set role authenticated; set app.current_uid = :'UNB'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.email_unsubscribe(''e0450000-0000-0000-0000-0000000000a1'', ''offers'')',
  'permission denied', 'UN45-5e zalogowany nie wypisze innej osoby RPC');
select pg_temp.expect_error('select count(*) from public.email_send_windows',
  'permission denied', 'UN45-5f liczniki budżetu niedostępne dla klienta');
select pg_temp.expect_error('update public.email_send_budget_config set provider_limit = 100000',
  'permission denied', 'UN45-5g konfiguracja budżetu niedostępna dla klienta');
reset role; reset app.current_uid;

-- UN45-6..8: budżet. Konfigurację i liczniki zmieniają WYŁĄCZNIE zatwierdzane sesje dblink
-- (jak sekcja PP): w trybie jednej zewnętrznej transakcji niezatwierdzone wiersze skryptu
-- blokowałyby równoległe sesje, które mają symulować osobne workery.
create function pg_temp.un45_sql(p_sql text) returns text
language plpgsql as $$
declare v_val text;
begin
  perform pg_temp.remote_connect('un45_setup');
  select t.v into v_val from dbl.dblink('un45_setup', p_sql) as t(v text);
  perform dbl.dblink_disconnect('un45_setup');
  return v_val;
end $$;
-- Liczba przyznanych miejsc z n pobrań danej puli (wywołanie w liście SELECT = raz na wiersz).
create function pg_temp.un45_take_n(p_template text, p_n int) returns int
language sql as $$
  select pg_temp.un45_sql(format(
    'select count(*) filter (where g)::text from (select (public.take_email_send_budget(%L)).granted as g
       from generate_series(1, %s)) s', p_template, p_n))::int;
$$;

-- UN45-6: marketing nie zużywa rezerw; transakcyjne nie zużywają rezerwy auth.
select pg_temp.un45_sql('with c as (update public.email_send_budget_config
   set window_seconds = 86400, provider_limit = 10, reserve_auth = 3, reserve_transactional = 3
   returning 1), w as (delete from public.email_send_windows returning 1)
   select ''ok''');
select pg_temp.assert(pg_temp.un45_take_n('newsletter', 6) = 4,
  'UN45-6 newsletter dostaje tylko 10 - 3 - 3 = 4');
select pg_temp.assert(
  pg_temp.un45_sql('select (not granted and retry_at > now())::text from public.take_email_send_budget(''newsletter'')')::boolean,
  'UN45-6b odmowa podaje termin następnego okna');
select pg_temp.assert(pg_temp.un45_take_n('statusChanged', 6) = 3,
  'UN45-6c transakcyjne dobierają do 10 - 3 = 7');
select pg_temp.assert(pg_temp.un45_take_n('passwordReset', 6) = 3,
  'UN45-6d rezerwa auth (3) nietknięta przez newsletter i transakcyjne');
select pg_temp.assert(
  (select auth_used + transactional_used + marketing_used from public.email_send_windows) = 10,
  'UN45-6e suma nie przekracza limitu dostawcy');

-- UN45-7: równoległe workery (dwie sesje dblink) — ostatnie miejsce dostaje tylko jedna.
select pg_temp.un45_sql('with c as (update public.email_send_budget_config
   set provider_limit = 10, reserve_auth = 0, reserve_transactional = 0 returning 1),
   w as (delete from public.email_send_windows returning 1) select ''ok''');
select pg_temp.assert(pg_temp.un45_take_n('statusChanged', 9) = 9, 'UN45-7 przygotowanie: 9 z 10 zajęte');
select pg_temp.remote_connect('un45_a');
select pg_temp.remote_connect('un45_b');
select dbl.dblink_exec('un45_a', 'begin');
select pg_temp.assert(
  (select t.g from dbl.dblink('un45_a', 'select granted from public.take_email_send_budget(''statusChanged'')')
     as t(g boolean)) is true,
  'UN45-7 sesja A bierze ostatnie miejsce (transakcja otwarta)');
select dbl.dblink_send_query('un45_b', 'select granted from public.take_email_send_budget(''statusChanged'')');
select pg_sleep(0.3);
select pg_temp.assert(
  exists (select 1 from pg_stat_activity where wait_event_type = 'Lock' and query like '%take_email_send_budget%'),
  'UN45-7a sesja B czeka na blokadę okna sesji A');
select dbl.dblink_exec('un45_a', 'commit');
select pg_temp.assert(
  (select t.g from dbl.dblink_get_result('un45_b') as t(g boolean)) is false,
  'UN45-7b sesja B czeka na blokadę i dostaje odmowę');
select * from dbl.dblink_get_result('un45_b') as t(g boolean);
select pg_temp.assert(
  (select transactional_used from public.email_send_windows) = 10,
  'UN45-7c równolegle: dokładnie limit, bez przekroczenia');

-- UN45-8: KONTROLA UJEMNA — licznik bez blokady (odczyt → zapis) przekracza limit.
select pg_temp.un45_sql($q$
  create schema un45test;
  create function un45test.naive_take() returns boolean language plpgsql as $f$
  declare v_used int;
  begin
    select transactional_used into v_used from public.email_send_windows;
    if v_used >= 10 then return false; end if;
    update public.email_send_windows set transactional_used = transactional_used + 1;
    return true;
  end $f$;
  update public.email_send_windows set transactional_used = 9;
  select 'ok'$q$);
select dbl.dblink_exec('un45_a', 'begin');
select pg_temp.assert(
  (select t.g from dbl.dblink('un45_a', 'select un45test.naive_take()') as t(g boolean)) is true,
  'UN45-8 naiwna sesja A bierze ostatnie miejsce');
select dbl.dblink_send_query('un45_b', 'select un45test.naive_take()');
select pg_sleep(0.3);
select dbl.dblink_exec('un45_a', 'commit');
select pg_temp.assert(
  (select t.g from dbl.dblink_get_result('un45_b') as t(g boolean)) is true,
  'UN45-8b naiwna sesja B też dostaje zgodę');
select * from dbl.dblink_get_result('un45_b') as t(g boolean);
select pg_temp.assert((select transactional_used from public.email_send_windows) = 11,
  'UN45-8c naiwny licznik przekracza limit (test wykrywa błąd)');
select dbl.dblink_disconnect('un45_a');
select dbl.dblink_disconnect('un45_b');

-- Sprzątanie (zatwierdzane): domyślna konfiguracja budżetu, bez liczników i schematu testu.
select pg_temp.un45_sql('drop schema un45test cascade; select ''ok''');
select pg_temp.un45_sql('with c as (update public.email_send_budget_config
   set window_seconds = 60, provider_limit = 100, reserve_auth = 20, reserve_transactional = 30
   returning 1), w as (delete from public.email_send_windows returning 1) select ''ok''');

-- ============================================================================
-- VI92. Weryfikacja VAT w VIES jako informacja dla admina (0088, #92)
-- Zapis tylko wyników rozstrzygających (valid/invalid); awaria/limit VIES nigdy nie
-- staje się „nieważny” i nie nadpisuje poprzedniego wyniku. Status firmy bez zmian.
-- ============================================================================
select status as vi92_status_before from public.companies where id = :'COMPA' \gset

set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
-- VI92-1: admin zapisuje wynik ważny z nazwą z rejestru.
select public.admin_record_vies_check(:'COMPA', '0417497106', 'valid', '  NV FIRMA A  ', date '2026-09-24');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select result = 'valid' and vies_name = 'NV FIRMA A' and vat_number = '0417497106'
          and checked_by = :'ADMIN'::uuid and request_date = date '2026-09-24'
     from public.company_vies_checks where company_id = :'COMPA'),
  'VI92-1 wynik ważny zapisany z nazwą, datą i adminem');
select pg_temp.assert(
  (select status from public.companies where id = :'COMPA') = :'vi92_status_before',
  'VI92-1b zapis wyniku nie zmienia statusu firmy');
select pg_temp.assert(
  (select after_data = '{"result":"valid"}'::jsonb and actor_id = :'ADMIN'::uuid
     from public.audit_logs
    where entity_id = :'COMPA' and action = 'company.vies_checked'
    order by created_at desc limit 1),
  'VI92-1c audyt company.vies_checked tylko z wynikiem (bez nazwy i numeru)');

-- VI92-2: KONTROLA UJEMNA — stany nierozstrzygające są odrzucane i nie nadpisują wyniku.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_record_vies_check(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''0417497106'', ''unavailable'')',
  'RESULT_NOT_PERSISTABLE', 'VI92-2 niedostępność VIES nie jest zapisywana');
select pg_temp.expect_error(
  'select public.admin_record_vies_check(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''0417497106'', ''rate_limited'')',
  'RESULT_NOT_PERSISTABLE', 'VI92-2b limit VIES nie jest zapisywany');
select pg_temp.expect_error(
  'select public.admin_record_vies_check(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''0417497106'', null)',
  'RESULT_NOT_PERSISTABLE', 'VI92-2c brak wyniku nie jest zapisywany');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select result from public.company_vies_checks where company_id = :'COMPA') = 'valid',
  'VI92-2d po awarii poprzedni wynik ważny zostaje (brak negatywnego cache)');
select pg_temp.expect_error(
  'insert into public.company_vies_checks(company_id, vat_number, result) values (''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'', ''0417497106'', ''unavailable'')',
  'company_vies_checks_result', 'VI92-2e CHECK tabeli odrzuca stan awarii nawet z pominięciem RPC');

-- VI92-3: wynik nieważny zastępuje ważny, bez nazwy; firma NIE jest odrzucana automatycznie.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_record_vies_check(:'COMPA', '0417497106', 'invalid', 'ignorowana', null);
reset role; reset app.current_uid;
select pg_temp.assert(
  (select result = 'invalid' and vies_name is null
     from public.company_vies_checks where company_id = :'COMPA'),
  'VI92-3 wynik nieważny zapisany bez nazwy');
select pg_temp.assert(
  (select status from public.companies where id = :'COMPA') = :'vi92_status_before',
  'VI92-3b nieważny numer nie zmienia statusu firmy (bez automatycznego odrzucania)');
select pg_temp.assert(
  (select count(*) from public.company_vies_checks where company_id = :'COMPA') = 1,
  'VI92-3c jeden wiersz na firmę');

-- VI92-4: walidacja numeru i firmy.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_record_vies_check(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''0123456789'', ''valid'')',
  'VAT_FORMAT', 'VI92-4 zła suma kontrolna odrzucona');
select pg_temp.expect_error(
  'select public.admin_record_vies_check(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''BE0417497106'', ''valid'')',
  'VAT_FORMAT', 'VI92-4b numer z prefiksem (nieznormalizowany) odrzucony');
select pg_temp.expect_error(
  'select public.admin_record_vies_check(''00000000-0000-0000-0000-00000000092f'', ''0417497106'', ''valid'')',
  'NOT_FOUND', 'VI92-4c nieistniejąca firma → NOT_FOUND');
reset role; reset app.current_uid;

-- VI92-5: pracodawca i anon bez dostępu do zapisu i odczytu.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_record_vies_check(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''0417497106'', ''valid'')',
  'PERMISSION_DENIED', 'VI92-5 pracodawca nie zapisze wyniku VIES własnej firmy');
select pg_temp.expect_error('select * from public.company_vies_checks',
  'permission denied', 'VI92-5b pracodawca nie czyta tabeli wyników VIES');
reset role; reset app.current_uid;
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_record_vies_check(''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'', ''0417497106'', ''valid'')',
  'permission denied', 'VI92-5c anon bez EXECUTE');
select pg_temp.expect_error('select * from public.company_vies_checks',
  'permission denied', 'VI92-5d anon nie czyta tabeli wyników VIES');
reset role;

-- ============================================================================
-- ML44 (#44, 0098): zdarzenia doręczeń dostawcy, blokady adresów (suppression),
-- ręczne zdjęcie blokady przez admina. Kontrole ujemne: bezpośredni DML klienta,
-- zapis blokady tylko service_role, enqueue na zablokowany adres, replay webhooka.
-- ============================================================================
\set MLA 'e0440000-0000-0000-0000-0000000000a1'
\set MLB 'e0440000-0000-0000-0000-0000000000a2'
\set MLC 'e0440000-0000-0000-0000-0000000000a3'
\set MLE 'e0440000-0000-0000-0000-0000000000e1'
reset role; reset app.current_uid;
-- Stały czas zdarzeń: dostawca ponawia ten sam payload z tym samym `created_at`.
select now() as ml44_t \gset
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'MLA','mla@test.be','Ml A','{"role":"candidate","first_name":"Ml","last_name":"A","locale":"pl"}'),
  (:'MLB','mlb@test.be','Ml B','{"role":"candidate","first_name":"Ml","last_name":"B","locale":"nl"}'),
  (:'MLC','mlc@test.be','Ml C','{"role":"candidate","first_name":"Ml","last_name":"C","locale":"fr"}');

-- Wysłana wiadomość z identyfikatorem dostawcy (jak po udanej wysyłce workera).
select public.enqueue_email(:'MLA', 'jobOffer', 'offer', :'MLE', 'ml44-a-1', '{}'::jsonb);
update public.email_deliveries set status = 'sent', sent_at = now(), provider_message_id = 'ml44-msg-a1'
 where idempotency_key = 'ml44-a-1';

-- ML44-1: delivered → status delivered, czas zapisany; ponowienie nie zmienia wiersza.
set role service_role;
select pg_temp.assert(
  public.record_email_event('resend', 'ml44-msg-a1', 'delivered', :'ml44_t'::timestamptz - interval '5 minutes', null, null) = 'applied',
  'ML44-1 delivered zapisany');
reset role;
select updated_at as ml44_upd from public.email_deliveries where idempotency_key = 'ml44-a-1' \gset
select pg_temp.assert(
  (select status::text = 'delivered' and delivered_at is not null
     from public.email_deliveries where idempotency_key = 'ml44-a-1'),
  'ML44-1b status delivered i delivered_at');
set role service_role;
select pg_temp.assert(
  public.record_email_event('resend', 'ml44-msg-a1', 'delivered', :'ml44_t'::timestamptz - interval '5 minutes', null, null) = 'unchanged',
  'ML44-1c powtórzone zdarzenie → unchanged');
reset role;
select pg_temp.assert(
  (select updated_at from public.email_deliveries where idempotency_key = 'ml44-a-1') = :'ml44_upd'::timestamptz,
  'ML44-1d powtórzone zdarzenie nie dotyka wiersza');

-- ML44-2: skarga → complained + blokada adresu; spóźnione delivered nie cofa stanu.
set role service_role;
select pg_temp.assert(
  public.record_email_event('resend', 'ml44-msg-a1', 'complained', :'ml44_t'::timestamptz - interval '1 minute', null, null) = 'applied',
  'ML44-2 complained zapisany');
select pg_temp.assert(
  public.record_email_event('resend', 'ml44-msg-a1', 'delivered', :'ml44_t'::timestamptz - interval '10 minutes', null, null) = 'unchanged',
  'ML44-2b spóźnione delivered → unchanged');
reset role;
select pg_temp.assert(
  (select status::text = 'complained' and complained_at is not null
     from public.email_deliveries where idempotency_key = 'ml44-a-1'),
  'ML44-2c status zostaje complained (bez cofania nowszego stanu)');
select pg_temp.assert(
  (select count(*) = 1 and bool_and(reason = 'complaint' and lifted_at is null)
     from public.email_suppressions where email = 'mla@test.be'),
  'ML44-2d jedna aktywna blokada (complaint)');
select pg_temp.assert(
  (select count(*) from public.audit_logs a join public.email_suppressions s on s.id = a.entity_id
    where a.action = 'email.suppressed' and s.email = 'mla@test.be'
      and a.after_data = '{"status":"complaint"}'::jsonb) = 1,
  'ML44-2e audyt blokady bez adresu e-mail');

-- ML44-3: enqueue na zablokowany adres nic nie kolejkuje.
select public.enqueue_email(:'MLA', 'statusChanged', 'application', :'MLE', 'ml44-a-2', '{}'::jsonb);
select pg_temp.assert(not exists (select 1 from public.email_deliveries where idempotency_key = 'ml44-a-2'),
  'ML44-3 enqueue na adres z blokadą nie tworzy wiersza');

-- ML44-4: wiersz zakolejkowany PRZED blokadą — claim go wygasza (mechanizm z #45).
-- Trwałe odbicie wiadomości spoza kolejki (np. Auth): blokada po adresie z webhooka.
select public.enqueue_email(:'MLB', 'newMessage', 'conversation', :'MLE', 'ml44-b-1', '{}'::jsonb);
set role service_role;
select pg_temp.assert(
  public.record_email_event('resend', 'ml44-msg-auth-b', 'bounced', now(), 'MLB@test.be', 'Permanent') = 'applied',
  'ML44-4 trwałe odbicie nieznanej wiadomości zakłada blokadę adresu');
select pg_temp.assert(public.email_address_suppressed('mlb@test.be') is true,
  'ML44-4b adres zablokowany (bez względu na wielkość liter)');
reset role;
-- KONTROLA UJEMNA: claim z 0087 (tylko zgoda) wydałby wiersz na zablokowany adres.
create function pg_temp.ml44_claim_0087(p_key text) returns setof public.email_deliveries
language sql as $$
  update public.email_deliveries d set locked_at = now()
   where d.id in (select e.id from public.email_deliveries e
                   where e.status = 'queued' and e.next_attempt_at <= now() and e.locked_at is null
                     and e.idempotency_key = p_key
                     and public.email_allowed(e.profile_id, e.template)
                   for update skip locked)
  returning d.*;
$$;
select pg_temp.assert(exists (select 1 from pg_temp.ml44_claim_0087('ml44-b-1')),
  'ML44-4c stary claim wydaje e-mail na zablokowany adres (test wykrywa błąd)');
update public.email_deliveries set locked_at = null where idempotency_key = 'ml44-b-1';
select pg_temp.assert(
  not exists (select 1 from public.claim_email_batch(100000) c where c.idempotency_key = 'ml44-b-1'),
  'ML44-4d nowy claim nie wydaje e-maila na zablokowany adres');
select pg_temp.assert(
  (select status::text = 'failed' and suppressed_at is not null and error_message = 'suppressed_address'
     from public.email_deliveries where idempotency_key = 'ml44-b-1'),
  'ML44-4e wiersz wygaszony z powodem suppressed_address');

-- ML44-5: odbicie przejściowe i opóźnienie — bez blokady i bez zmiany statusu.
select public.enqueue_email(:'MLC', 'jobOffer', 'offer', :'MLE', 'ml44-c-1', '{}'::jsonb);
update public.email_deliveries set status = 'sent', sent_at = now(), provider_message_id = 'ml44-msg-c1'
 where idempotency_key = 'ml44-c-1';
set role service_role;
select public.record_email_event('resend', 'ml44-msg-c1', 'delivery_delayed', now(), null, null);
select public.record_email_event('resend', 'ml44-msg-c1', 'bounced', now(), null, 'Transient');
reset role;
select pg_temp.assert(
  (select status::text = 'sent' and delayed_at is not null and bounce_type = 'transient'
     from public.email_deliveries where idempotency_key = 'ml44-c-1'),
  'ML44-5 przejściowe odbicie i opóźnienie nie zmieniają statusu');
select pg_temp.assert(public.email_address_suppressed('mlc@test.be') is false,
  'ML44-5b odbicie przejściowe nie blokuje adresu');

-- ML44-6: walidacja zdarzenia.
set role service_role;
select pg_temp.expect_error(
  'select public.record_email_event(''resend'', ''ml44-msg-c1'', ''opened'', now(), null, null)',
  'VALIDATION_FAILED', 'ML44-6 nieobsługiwane zdarzenie odrzucone');
select pg_temp.expect_error(
  'select public.record_email_event(''resend'', null, ''delivered'', now(), null, null)',
  'VALIDATION_FAILED', 'ML44-6b brak identyfikatora wiadomości odrzucony');
reset role;

select id as ml44_supp from public.email_suppressions where email = 'mla@test.be' and lifted_at is null \gset
-- ML44-7: KONTROLE UJEMNE uprawnień — klient nie czyta, nie pisze i nie woła RPC dostawcy.
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error('select count(*) from public.email_suppressions',
  'permission denied', 'ML44-7 anon nie czyta blokad');
select pg_temp.expect_error(
  'select public.record_email_event(''resend'', ''ml44-msg-c1'', ''complained'', now(), null, null)',
  'permission denied', 'ML44-7b anon nie zapisze zdarzenia dostawcy');
reset role;
set role authenticated; set app.current_uid = :'MLC'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select count(*) from public.email_suppressions',
  'permission denied', 'ML44-7c zalogowany nie czyta blokad');
select pg_temp.expect_error(
  'insert into public.email_suppressions(email, reason) values (''x@test.be'', ''complaint'')',
  'permission denied', 'ML44-7d zalogowany nie wstawi blokady bezpośrednio');
select pg_temp.expect_error(
  'update public.email_suppressions set lifted_at = now(), lift_reason = ''x''',
  'permission denied', 'ML44-7e zalogowany nie zdejmie blokady bezpośrednio');
select pg_temp.expect_error('delete from public.email_suppressions',
  'permission denied', 'ML44-7f zalogowany nie usunie blokady');
select pg_temp.expect_error(
  'select public.record_email_event(''resend'', ''ml44-msg-c1'', ''complained'', now(), null, null)',
  'permission denied', 'ML44-7g zalogowany nie zapisze zdarzenia dostawcy');
select pg_temp.expect_error('select public.email_address_suppressed(''mla@test.be'')',
  'permission denied', 'ML44-7h zalogowany nie sprawdzi blokady cudzego adresu');
select pg_temp.expect_error(
  format('select public.admin_lift_email_suppression(%L, ''prośba'')', :'ml44_supp'),
  'PERMISSION_DENIED', 'ML44-7i kandydat nie zdejmie blokady przez RPC');
reset role; reset app.current_uid;
select pg_temp.assert(public.email_address_suppressed('mlc@test.be') is false
    and (select status::text from public.email_deliveries where idempotency_key = 'ml44-c-1') = 'sent',
  'ML44-7j odrzucone próby klienta niczego nie zmieniły');

-- ML44-8: replay webhooka — inbox pomija zdarzenie już zakończone.
set role service_role;
select pg_temp.assert(public.claim_webhook('resend:ml44-evt-1', 'resend-email-events', 300) = 'claimed',
  'ML44-8 pierwsza dostawa zdarzenia przejęta');
select public.record_email_event('resend', 'ml44-msg-c1', 'delivered', now(), null, null);
select pg_temp.assert(public.complete_webhook('resend:ml44-evt-1'), 'ML44-8b zdarzenie zakończone');
select pg_temp.assert(public.claim_webhook('resend:ml44-evt-1', 'resend-email-events', 300) = 'duplicate',
  'ML44-8c replay tego samego zdarzenia → duplicate');
reset role;

-- ML44-9: admin zdejmuje blokadę (uzasadnienie wymagane, audyt, STALE_STATE przy powtórce).
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(format('select public.admin_lift_email_suppression(%L, ''   '')', :'ml44_supp'),
  'REASON_REQUIRED', 'ML44-9 zdjęcie bez uzasadnienia odrzucone');
select pg_temp.expect_error(
  format('select public.admin_lift_email_suppression(%L, %L)', :'ml44_supp', repeat('x', 1001)),
  'REASON_TOO_LONG', 'ML44-9b za długie uzasadnienie odrzucone');
select public.admin_lift_email_suppression(:'ml44_supp', 'Użytkownik potwierdził adres');
select pg_temp.expect_error(format('select public.admin_lift_email_suppression(%L, ''ponownie'')', :'ml44_supp'),
  'STALE_STATE', 'ML44-9c ponowne zdjęcie → STALE_STATE');
select pg_temp.expect_error(
  'select public.admin_lift_email_suppression(''e0440000-0000-0000-0000-00000000ffff'', ''x'')',
  'NOT_FOUND', 'ML44-9d nieistniejąca blokada → NOT_FOUND');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select lifted_at is not null and lifted_by = :'ADMIN'::uuid and lift_reason = 'Użytkownik potwierdził adres'
     from public.email_suppressions where id = :'ml44_supp'),
  'ML44-9e blokada zdjęta z adminem i uzasadnieniem');
select pg_temp.assert(
  (select actor_id = :'ADMIN'::uuid and after_data->>'reason' = 'Użytkownik potwierdził adres'
     from public.audit_logs where action = 'email.suppression_lifted' and entity_id = :'ml44_supp'),
  'ML44-9f audyt zdjęcia blokady z aktorem');
select public.enqueue_email(:'MLA', 'statusChanged', 'application', :'MLE', 'ml44-a-3', '{}'::jsonb);
select pg_temp.assert(exists (select 1 from public.email_deliveries where idempotency_key = 'ml44-a-3'),
  'ML44-9g po zdjęciu blokady adres znowu dostaje e-maile');
set role service_role;
select public.record_email_event('resend', 'ml44-msg-a3', 'complained', now(), 'mla@test.be', null);
reset role;
select pg_temp.assert(
  (select count(*) = 2 and count(*) filter (where lifted_at is null) = 1
     from public.email_suppressions where email = 'mla@test.be'),
  'ML44-9h nowa skarga zakłada nową blokadę, historia zostaje');

-- ============================================================================
-- FN99. Serwerowy lejek ofert bez śledzenia (0089, #99): agregat per oferta i dzień,
--       deduplikacja po nonce, tylko oferty publiczne, odczyt recruiter+ własnej firmy
-- ============================================================================
\set FNEA  'f9900000-0000-0000-0000-0000000000a1'
\set FNEB  'f9900000-0000-0000-0000-0000000000a2'
\set FNMEM 'f9900000-0000-0000-0000-0000000000a3'
\set FNCAN 'f9900000-0000-0000-0000-0000000000a4'
\set FNCA  'f9900000-0000-0000-0000-000000000001'
\set FNCB  'f9900000-0000-0000-0000-000000000002'
\set FNCC  'f9900000-0000-0000-0000-000000000003'
\set FNJA  'f9900000-0000-0000-0000-0000000000b1'
\set FNJB  'f9900000-0000-0000-0000-0000000000b2'
\set FNJC  'f9900000-0000-0000-0000-0000000000b3'
\set FNJD  'f9900000-0000-0000-0000-0000000000b4'
\set FNN1  'f9900000-0000-0000-0000-0000000000c1'
\set FNN2  'f9900000-0000-0000-0000-0000000000c2'
\set FNN3  'f9900000-0000-0000-0000-0000000000c3'
\set FNN4  'f9900000-0000-0000-0000-0000000000c4'
reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'FNEA','fnea@test.be','Fn A','{"role":"employer","first_name":"Fn","last_name":"A","locale":"pl"}'),
  (:'FNEB','fneb@test.be','Fn B','{"role":"employer","first_name":"Fn","last_name":"B","locale":"nl"}'),
  (:'FNMEM','fnmem@test.be','Fn M','{"role":"employer","first_name":"Fn","last_name":"M","locale":"pl"}'),
  (:'FNCAN','fncan@test.be','Fn C','{"role":"candidate","first_name":"Fn","last_name":"C","locale":"pl"}');
insert into public.companies(id, name, status) values
  (:'FNCA', 'Firma FN A', 'verified'), (:'FNCB', 'Firma FN B', 'verified'), (:'FNCC', 'Firma FN C', 'unverified');
insert into public.company_members(company_id, profile_id, role, is_active) values
  (:'FNCA', :'FNEA', 'owner', true), (:'FNCB', :'FNEB', 'owner', true), (:'FNCA', :'FNMEM', 'member', true);
insert into public.jobs(id, company_id, slug, title, category, contract_type, city, region, status, default_locale) values
  (:'FNJA', :'FNCA', 'fn99-a', 'Magazynier FN', 'warehouse', 'permanent', 'Antwerpia', 'Flandria', 'active', 'pl'),
  (:'FNJB', :'FNCB', 'fn99-b', 'Kierowca FN', 'transport', 'permanent', 'Gandawa', 'Flandria', 'active', 'pl'),
  (:'FNJC', :'FNCC', 'fn99-c', 'Oferta firmy niezweryfikowanej', 'warehouse', 'permanent', 'Gent', 'Flandria', 'active', 'pl'),
  (:'FNJD', :'FNCA', 'fn99-d', 'Szkic FN', 'warehouse', 'permanent', 'Antwerpia', 'Flandria', 'draft', 'pl');
-- Dwie złożone aplikacje dziś, jeden szkic (nie liczy się) i jedna sprzed 40 dni (poza zakresem).
insert into public.applications(job_id, candidate_id, company_id, status, submitted_at) values
  (:'FNJA', :'FNCAN', :'FNCA', 'submitted', now());
insert into public.applications(job_id, candidate_id, company_id, status, submitted_at) values
  (:'FNJB', :'FNCAN', :'FNCB', 'submitted', now() - interval '40 days');

-- Lejek liczy dni w Europe/Brussels (zapis i odczyt). `current_date` w asercjach musi być tym
-- samym dniem — inaczej między 22:00 a 24:00 UTC (CEST) zakres kończy się „wczoraj” i FN99-8 pada.
set timezone = 'Europe/Brussels';

-- FN99-1: bez bramki serwera anon nie zapisze zdarzenia (np. wywołanie z pominięciem endpointu).
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.record_job_funnel_event(''detail_view'', ''f9900000-0000-0000-0000-0000000000c1''::uuid, array[''f9900000-0000-0000-0000-0000000000b1''::uuid])',
  'PERMISSION_DENIED', 'FN99-1 zapis bez bramki endpointu odrzucony');

-- FN99-2: zapis przez endpoint (anon + bramka); ponowienie z tym samym nonce = brak drugiego zliczenia.
select set_config('pracujbe.funnel_writer', 'on', false);
select public.record_job_funnel_event('detail_view', :'FNN1'::uuid, array[:'FNJA'::uuid]) as fn2a \gset
select public.record_job_funnel_event('detail_view', :'FNN1'::uuid, array[:'FNJA'::uuid]) as fn2b \gset
select pg_temp.assert(:'fn2a'::int = 1 and :'fn2b'::int = 0, 'FN99-2 retry z tym samym nonce nie dubluje zliczenia');
-- FN99-3: odświeżenie (nowy nonce) liczy się ponownie; apply_started z tym samym nonce co wyświetlenie osobno.
select public.record_job_funnel_event('detail_view', :'FNN2'::uuid, array[:'FNJA'::uuid]);
select public.record_job_funnel_event('apply_started', :'FNN2'::uuid, array[:'FNJA'::uuid]);
select public.record_job_funnel_event('apply_started', :'FNN2'::uuid, array[:'FNJA'::uuid]);
-- FN99-4: wyniki listy — duplikat liczony raz, firma niezweryfikowana i szkic pominięte.
select public.record_job_funnel_event('search_appearance', :'FNN3'::uuid,
  array[:'FNJA'::uuid, :'FNJA'::uuid, :'FNJB'::uuid, :'FNJC'::uuid, :'FNJD'::uuid]) as fn4 \gset
select pg_temp.assert(:'fn4'::int = 2, 'FN99-4 liczone tylko oferty publiczne zweryfikowanych firm');
-- FN99-5: walidacja wejścia.
select pg_temp.expect_error(
  format('select public.record_job_funnel_event(''detail_view'', %L::uuid, array[%L::uuid, %L::uuid])',
         'f9900000-0000-0000-0000-0000000000c9', 'f9900000-0000-0000-0000-0000000000b1', 'f9900000-0000-0000-0000-0000000000b2'),
  'VALIDATION_FAILED', 'FN99-5 wyświetlenie szczegółu dotyczy jednej oferty');
select pg_temp.expect_error(
  format('select public.record_job_funnel_event(''search_appearance'', %L::uuid, (select array_agg(gen_random_uuid()) from generate_series(1, 51)))',
         'f9900000-0000-0000-0000-0000000000c8'),
  'VALIDATION_FAILED', 'FN99-5b wyniki listy ≤ 50 ofert');
select pg_temp.expect_error(
  format('select public.record_job_funnel_event(''click'', %L::uuid, array[%L::uuid])',
         'f9900000-0000-0000-0000-0000000000c7', 'f9900000-0000-0000-0000-0000000000b1'),
  'VALIDATION_FAILED', 'FN99-5c nieznane zdarzenie odrzucone');
-- FN99-6: anon nie czyta agregatu, pokwitowań ani lejka firmy.
select pg_temp.expect_error('select count(*) from public.job_funnel_daily', 'permission denied',
  'FN99-6 anon nie czyta agregatu');
select pg_temp.expect_error('select count(*) from public.job_funnel_receipts', 'permission denied',
  'FN99-6b anon nie czyta pokwitowań');
select pg_temp.expect_error(
  'select * from public.get_company_job_funnel(''f9900000-0000-0000-0000-000000000001''::uuid, current_date - 29, current_date)',
  'permission denied', 'FN99-6c anon bez EXECUTE na odczycie lejka');
reset pracujbe.funnel_writer;
reset role;

-- FN99-7: agregat nie przechowuje danych osób — wyłącznie oferta, dzień i liczniki.
select pg_temp.assert(
  (select array_agg(column_name::text order by column_name::text) from information_schema.columns
    where table_schema = 'public' and table_name = 'job_funnel_daily')
  = array['apply_started','day','detail_views','job_id','search_appearances','updated_at']
  and (select array_agg(column_name::text order by column_name::text) from information_schema.columns
    where table_schema = 'public' and table_name = 'job_funnel_receipts')
  = array['created_at','event','nonce'],
  'FN99-7 brak kolumn z IP, użytkownikiem, zapytaniem lub profilem');
select pg_temp.assert(
  (select detail_views = 2 and apply_started = 1 and search_appearances = 1
     from public.job_funnel_daily where job_id = :'FNJA' and day = (now() at time zone 'Europe/Brussels')::date)
  and (select search_appearances = 1 and detail_views = 0 from public.job_funnel_daily where job_id = :'FNJB')
  and not exists (select 1 from public.job_funnel_daily where job_id in (:'FNJC', :'FNJD')),
  'FN99-7b agregat dzienny: 2 wyświetlenia, 1 rozpoczęcie, 1 pojawienie w wynikach');

-- FN99-8: rekruter firmy A czyta swój lejek; submitted = stan domenowy w zakresie.
set role authenticated; set app.current_uid = :'FNEA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select search_appearances = 1 and detail_views = 2 and apply_started = 1 and applications_submitted = 1
     from public.get_company_job_funnel(:'FNCA'::uuid, current_date - 29, current_date) where job_id = :'FNJA')
  and not exists (select 1 from public.get_company_job_funnel(:'FNCA'::uuid, current_date - 29, current_date)
                   where job_id in (:'FNJB', :'FNJD')),
  'FN99-8 lejek firmy A: liczniki i złożone aplikacje, bez ofert innych firm i szkiców');
-- FN99-8b: kontrola ujemna — firma A nie widzi lejka firmy B.
select pg_temp.expect_error(
  'select * from public.get_company_job_funnel(''f9900000-0000-0000-0000-000000000002''::uuid, current_date - 29, current_date)',
  'PERMISSION_DENIED', 'FN99-8b firma A nie czyta lejka firmy B');
select pg_temp.expect_error('select count(*) from public.job_funnel_daily', 'permission denied',
  'FN99-8c zalogowany pracodawca nie czyta agregatu bezpośrednio');
select pg_temp.expect_error(
  'select * from public.get_company_job_funnel(''f9900000-0000-0000-0000-000000000001''::uuid, current_date, current_date - 1)',
  'VALIDATION_FAILED', 'FN99-8d odwrócony zakres dat odrzucony');
reset role; reset app.current_uid;
-- FN99-9: firma B widzi aplikację sprzed 40 dni tylko w zakresie, który ją obejmuje.
set role authenticated; set app.current_uid = :'FNEB'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select applications_submitted = 0 and search_appearances = 1
     from public.get_company_job_funnel(:'FNCB'::uuid, current_date - 29, current_date) where job_id = :'FNJB')
  and (select applications_submitted = 1 and search_appearances = 0
     from public.get_company_job_funnel(:'FNCB'::uuid, current_date - 59, current_date - 30) where job_id = :'FNJB'),
  'FN99-9 aplikacja poza zakresem nie wlicza się; zakres historyczny ją obejmuje');
reset role; reset app.current_uid;
-- FN99-10: zwykły członek (member) i kandydat nie czytają lejka.
set role authenticated; set app.current_uid = :'FNMEM'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.get_company_job_funnel(''f9900000-0000-0000-0000-000000000001''::uuid, current_date - 29, current_date)',
  'PERMISSION_DENIED', 'FN99-10 member bez prawa do lejka');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'FNCAN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.get_company_job_funnel(''f9900000-0000-0000-0000-000000000001''::uuid, current_date - 29, current_date)',
  'PERMISSION_DENIED', 'FN99-10b kandydat bez prawa do lejka');
reset role; reset app.current_uid;

-- FN99-11: pokwitowania poza oknem deduplikacji są usuwane przy kolejnym zapisie.
insert into public.job_funnel_receipts(nonce, event, created_at)
  values ('f9900000-0000-0000-0000-0000000000cf', 'detail_view', now() - interval '3 days');
set role anon; select pg_temp.assert_client_role();
select set_config('pracujbe.funnel_writer', 'on', false);
select public.record_job_funnel_event('detail_view', :'FNN4'::uuid, array[:'FNJB'::uuid]);
reset pracujbe.funnel_writer;
reset role;
select pg_temp.assert(
  not exists (select 1 from public.job_funnel_receipts where nonce = 'f9900000-0000-0000-0000-0000000000cf')
  and exists (select 1 from public.job_funnel_receipts where nonce = :'FNN4'),
  'FN99-11 stare pokwitowania usunięte, bieżące zachowane');

-- FN99-12: kontrola ujemna asercji — gdyby anon dostał SELECT, FN99-6 wykryłby odczyt.
grant select on public.job_funnel_daily to anon;
set role anon; select pg_temp.assert_client_role();
select count(*) >= 0 as fn12 from public.job_funnel_daily \gset
reset role;
revoke select on public.job_funnel_daily from anon;
select pg_temp.assert(:'fn12'::boolean, 'FN99-12 kontrola ujemna: z grantem anon czyta agregat (test FN99-6 by to wykrył)');
reset timezone;

-- ============================================================================
-- BL97. Blokada firmy w wynikach listy ofert (0090, #97): get_public_jobs / _count /
--       get_public_job_filter_facets pomijają oferty firm zablokowanych przez wywołującego.
--       Dwie firmy × dwóch kandydatów; kontrole ujemne: gość, pracodawca, cudzy kandydat,
--       bezpośredni DML blokad. Identyfikatory e9100….
-- ============================================================================
reset role; reset app.current_uid;
\set B97C1 'e9100000-0000-0000-0000-0000000000c1'
\set B97C2 'e9100000-0000-0000-0000-0000000000c2'
\set B97E1 'e9100000-0000-0000-0000-0000000000e1'
\set B97E2 'e9100000-0000-0000-0000-0000000000e2'
\set B97F1 'e9100000-0000-0000-0000-0000000000f1'
\set B97F2 'e9100000-0000-0000-0000-0000000000f2'
\set B97J1 'e9100000-0000-0000-0000-0000000000b1'
\set B97J2 'e9100000-0000-0000-0000-0000000000b2'
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'B97C1','b97c1@test.be','B97 C1','{"role":"candidate","first_name":"Lista","last_name":"Jeden","locale":"pl"}'),
  (:'B97C2','b97c2@test.be','B97 C2','{"role":"candidate","first_name":"Lista","last_name":"Dwa","locale":"fr"}'),
  (:'B97E1','b97e1@test.be','B97 E1','{"role":"employer","first_name":"Rek","last_name":"Jeden","locale":"pl"}'),
  (:'B97E2','b97e2@test.be','B97 E2','{"role":"employer","first_name":"Rek","last_name":"Dwa","locale":"nl"}');
insert into public.companies(id,name,status) values
  (:'B97F1','Firma Lista 1','verified'), (:'B97F2','Firma Lista 2','verified');
insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'B97F1',:'B97E1','owner',true), (:'B97F2',:'B97E2','owner',true);
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'B97J1',:'B97F1','job-bl97-1','Kierowca bl97lista','transport','permanent','Gent','Flandria','active','pl'),
  (:'B97J2',:'B97F2','job-bl97-2','Kierowca bl97lista','transport','permanent','Gent','Flandria','active','pl');

-- Liczba ofert z listy / licznika / facetów dla bieżącego wywołującego (unikalne słowo kluczowe).
create or replace function pg_temp.bl97_list() returns uuid[] language sql as $$
  select coalesce(array_agg(id order by id), '{}')
  from public.get_public_jobs('pl', 'bl97lista', null, null, null, null, null, null,
                              null, null, null, null, 'newest', 20, 0);
$$;
create or replace function pg_temp.bl97_count() returns bigint language sql as $$
  select public.get_public_jobs_count('pl', 'bl97lista');
$$;
create or replace function pg_temp.bl97_facet() returns bigint language sql as $$
  select total from public.get_public_job_filter_facets('pl', 'bl97lista')
  where dimension = 'total' and key = 'all';
$$;

-- BL97-0: przed blokadą kandydat widzi obie oferty (punkt odniesienia).
set role authenticated; set app.current_uid = :'B97C1'; select pg_temp.assert_client_role();
select pg_temp.assert(
  pg_temp.bl97_list() = array[:'B97J1', :'B97J2']::uuid[]
  and pg_temp.bl97_count() = 2 and pg_temp.bl97_facet() = 2,
  'BL97-0 przed blokadą lista/licznik/facety z obiema ofertami');

-- BL97-1: C1 blokuje F1 → lista, licznik i facety bez oferty F1.
select public.set_company_block(:'B97F1'::uuid, true);
select pg_temp.assert(
  pg_temp.bl97_list() = array[:'B97J2']::uuid[]
  and pg_temp.bl97_count() = 1 and pg_temp.bl97_facet() = 1,
  'BL97-1 lista/licznik/facety kandydata pomijają firmę zablokowaną');
select pg_temp.assert(
  (select count(*) from public.get_public_job('job-bl97-1', 'pl')) = 1
  and (select blocked from public.get_job_company_block(:'B97J1'::uuid)),
  'BL97-1b publiczny URL oferty zablokowanej firmy dostępny (z opcją odblokowania)');
select pg_temp.assert(
  public.get_public_jobs_count('pl', 'bl97lista', null, array['transport'], array['Gent'],
                               array['permanent']) = 1,
  'BL97-1c ten sam filtr blokady przy pozostałych filtrach listy');

-- BL97-2: bezpośredni DML blokad odrzucony (kandydat pisze tylko przez RPC).
select pg_temp.expect_error(
  format('insert into public.candidate_company_blocks(candidate_id, company_id) values (%L, %L)',
         :'B97C1', :'B97F2'),
  'permission denied', 'BL97-2 bezpośredni INSERT blokady odrzucony');
select pg_temp.expect_error(
  format('delete from public.candidate_company_blocks where candidate_id = %L', :'B97C1'),
  'permission denied', 'BL97-2b bezpośredni DELETE blokady odrzucony');
select pg_temp.expect_error(
  format('update public.candidate_company_blocks set company_id = %L where candidate_id = %L',
         :'B97F2', :'B97C1'),
  'permission denied', 'BL97-2c bezpośredni UPDATE blokady odrzucony');
reset role;

-- BL97-3: cudzy kandydat — blokada C1 go nie dotyczy, a jego „odblokowanie” nie usuwa blokady C1.
set role authenticated; set app.current_uid = :'B97C2'; select pg_temp.assert_client_role();
select pg_temp.assert(
  pg_temp.bl97_list() = array[:'B97J1', :'B97J2']::uuid[]
  and pg_temp.bl97_count() = 2 and pg_temp.bl97_facet() = 2,
  'BL97-3 kontrola ujemna: drugi kandydat widzi obie oferty');
select public.set_company_block(:'B97F1'::uuid, false);
select public.set_company_block(:'B97F2'::uuid, true);
select pg_temp.assert(
  pg_temp.bl97_list() = array[:'B97J1']::uuid[],
  'BL97-3b blokada drugiego kandydata działa tylko dla niego');
reset role;
select pg_temp.assert(
  (select count(*) from public.candidate_company_blocks
   where candidate_id = :'B97C1' and company_id = :'B97F1') = 1,
  'BL97-3c cudzy kandydat nie odblokuje cudzej blokady');

-- BL97-4: gość i pracodawcy (także firmy zablokowanej) — wynik publiczny bez zmian,
-- bez informacji o blokadzie.
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.assert(
  pg_temp.bl97_list() = array[:'B97J1', :'B97J2']::uuid[]
  and pg_temp.bl97_count() = 2 and pg_temp.bl97_facet() = 2,
  'BL97-4 gość widzi obie oferty');
reset role;
set role authenticated; set app.current_uid = :'B97E1'; select pg_temp.assert_client_role();
select pg_temp.assert(
  pg_temp.bl97_list() = array[:'B97J1', :'B97J2']::uuid[]
  and pg_temp.bl97_count() = 2
  and (select count(*) from public.candidate_company_blocks) = 0,
  'BL97-4b firma zablokowana widzi pełną listę i nie odczyta blokad');
reset role;
set role authenticated; set app.current_uid = :'B97E2'; select pg_temp.assert_client_role();
select pg_temp.assert(
  pg_temp.bl97_list() = array[:'B97J1', :'B97J2']::uuid[] and pg_temp.bl97_count() = 2,
  'BL97-4c inna firma bez zmian');
reset role;

-- BL97-5: odblokowanie przywraca ofertę na liście, w liczniku i facetach.
set role authenticated; set app.current_uid = :'B97C1'; select pg_temp.assert_client_role();
select public.set_company_block(:'B97F1'::uuid, false);
select pg_temp.assert(
  pg_temp.bl97_list() = array[:'B97J1', :'B97J2']::uuid[]
  and pg_temp.bl97_count() = 2 and pg_temp.bl97_facet() = 2,
  'BL97-5 po odblokowaniu oferta wraca na listę');
reset role; reset app.current_uid;

-- BL97-6: historia propozycji po blokadzie — get_offered_jobs_display zwraca ofertę własnej
-- propozycji (bez aplikacji do tej oferty) mimo blokady; cudzy kandydat i firma nic nie dostają.
insert into public.candidate_profiles(profile_id, is_searchable, profile_completed) values
  (:'B97C1', true, true);
set role authenticated; set app.current_uid = :'B97E1'; select pg_temp.assert_client_role();
select public.send_offer(:'B97J1'::uuid, :'B97C1'::uuid, 'bl97-offer-1') as b97offer \gset
reset role;
set role authenticated; set app.current_uid = :'B97C1'; select pg_temp.assert_client_role();
select public.set_company_block(:'B97F1'::uuid, true);
select pg_temp.assert(
  (select count(*) from public.applications where job_id = :'B97J1') = 0
  and not (:'B97J1'::uuid = any(pg_temp.bl97_list()))
  and (select array_agg(job_id) from public.get_offered_jobs_display('pl')) = array[:'B97J1']::uuid[]
  and (select title from public.get_offered_jobs_display('pl')) = 'Kierowca bl97lista',
  'BL97-6 propozycja firmy zablokowanej zachowuje dane oferty w historii');
reset role;
set role authenticated; set app.current_uid = :'B97C2'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.get_offered_jobs_display('pl')) = 0,
  'BL97-6b cudzy kandydat nie widzi danych cudzych propozycji');
reset role;
set role authenticated; set app.current_uid = :'B97E1'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.get_offered_jobs_display('pl')) = 0,
  'BL97-6c firma nie dostaje nic z RPC kandydata');
reset role;
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.expect_error('select * from public.get_offered_jobs_display(''pl'')',
  'permission denied', 'BL97-6d gość bez EXECUTE');
reset role; reset app.current_uid;
-- =============================================================================
-- OPS47 — czujki operacyjne (0096): ops_metrics tylko dla pracujbe_ops/service_role,
-- same liczby (bez PII), poprawne zaległości/dzierżawy/webhooki/maintenance,
-- indeks trigramowy miasta używany przez filtr `city ilike`.
-- =============================================================================
\echo '--- OPS47 ops_metrics ---'
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.ops_metrics()', 'permission denied', 'OPS47-1 anon bez EXECUTE');
reset role;
set role authenticated; set app.current_uid = :'TMX'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.ops_metrics()', 'permission denied', 'OPS47-1b authenticated bez EXECUTE');
reset role; reset app.current_uid;

select pg_temp.assert(
  (select not rolcanlogin and not rolinherit and not rolsuper and not rolbypassrls
     from pg_roles where rolname = 'pracujbe_ops')
  and not exists (select 1 from pg_auth_members where member = 'pracujbe_ops'::regrole),
  'OPS47-2 rola pracujbe_ops bez atrybutów i członkostw');

set role pracujbe_ops;
select pg_temp.expect_error('select count(*) from public.email_deliveries', 'permission denied',
  'OPS47-2b pracujbe_ops nie czyta tabel');
select pg_temp.expect_error('select count(*) from public.jobs', 'permission denied',
  'OPS47-2c pracujbe_ops nie czyta ofert');
select pg_temp.expect_error('select public.expire_due_jobs()', 'permission denied',
  'OPS47-2d pracujbe_ops nie wykonuje zadań maintenance');
select pg_temp.assert(
  (select public.ops_metrics() ?& array['email', 'authEmail', 'webhooks', 'maintenance', 'connections']),
  'OPS47-2e pracujbe_ops czyta metryki');
reset role;

select public.ops_metrics() as ops_base \gset
begin;
insert into public.email_deliveries(to_email, template, status, next_attempt_at, locked_at, updated_at) values
  ('ops47-ready@test.invalid', 'newMessage', 'queued', now() - interval '20 minutes', null, now()),
  ('ops47-lease@test.invalid', 'newMessage', 'queued', now() - interval '1 minute', now() - interval '10 minutes', now()),
  ('ops47-future@test.invalid', 'newMessage', 'queued', now() + interval '1 hour', null, now()),
  ('ops47-failed@test.invalid', 'newMessage', 'failed', now(), null, now());
insert into public.processed_webhooks(id, source, status, seen_at, updated_at) values
  ('ops47-stuck', 'stripe', 'processing', now() - interval '1 hour', now() - interval '1 hour'),
  ('ops47-fresh', 'stripe', 'processing', now(), now());
set local session_replication_role = replica;
update public.jobs set status = 'active', expires_at = now() - interval '3 hours'
  where id = (select id from public.jobs where deleted_at is null order by id limit 1);
set local session_replication_role = origin;
set local role pracujbe_ops;
select public.ops_metrics() as ops_now \gset
reset role;
select pg_temp.assert(
  ((:'ops_now')::jsonb #>> '{email,ready}')::int = ((:'ops_base')::jsonb #>> '{email,ready}')::int + 2
  and ((:'ops_now')::jsonb #>> '{email,oldestReadyAgeSeconds}')::int >= 1200
  and ((:'ops_now')::jsonb #>> '{email,abandonedLeases}')::int = ((:'ops_base')::jsonb #>> '{email,abandonedLeases}')::int + 1
  and ((:'ops_now')::jsonb #>> '{email,failedLast24h}')::int = ((:'ops_base')::jsonb #>> '{email,failedLast24h}')::int + 1,
  'OPS47-3 kolejka e-mail: gotowe, wiek najstarszego, porzucona dzierżawa, nieudane (przyszłe pomijane)');
select pg_temp.assert(
  ((:'ops_now')::jsonb #>> '{webhooks,stuckProcessing}')::int = ((:'ops_base')::jsonb #>> '{webhooks,stuckProcessing}')::int + 1,
  'OPS47-4 webhook zawieszony > 15 min liczony, świeży nie');
select pg_temp.assert(
  ((:'ops_now')::jsonb #>> '{maintenance,overdueActiveJobs}')::int >= 1,
  'OPS47-5 aktywna oferta > 2 h po terminie = opóźnienie maintenance');
select pg_temp.assert(
  ((:'ops_now')::jsonb #>> '{connections,used}')::int >= 1
  and ((:'ops_now')::jsonb #>> '{connections,max}')::int > 0
  and ((:'ops_now')::jsonb ? 'authEmail') and jsonb_typeof((:'ops_now')::jsonb -> 'authEmail') = 'object',
  'OPS47-6 połączenia i kolejka auth (0061) raportowane');
select pg_temp.assert(
  position('ops47' in (:'ops_now')) = 0 and position('@' in (:'ops_now')) = 0,
  'OPS47-7 metryki bez adresów i identyfikatorów');
rollback;

-- Kontrola ujemna: bez GRANT dla pracujbe_ops wywołanie jest odrzucane (grant jest jedyną ścieżką).
begin;
revoke execute on function public.ops_metrics() from pracujbe_ops;
set local role pracujbe_ops;
select pg_temp.expect_error('select public.ops_metrics()', 'permission denied',
  'OPS47-8 kontrola ujemna: bez GRANT odmowa');
rollback;

-- Użycie indeksu przy realnej liczbie ofert mierzy scripts/db/search-benchmark.sh (EXPLAIN
-- przed/po); tu — definicja zgodna z predykatem get_public_jobs (status/deleted_at, trigram).
-- Od 0110 indeks miasta jest wyrażeniowy na search_fold(city) (idx_jobs_city_trgm usunięty).
select pg_temp.assert(
  (select pg_get_indexdef('public.idx_jobs_city_fold_trgm'::regclass))
    like '%USING gin (search_fold(city) gin_trgm_ops) WHERE ((status = ''active''::job_status) AND (deleted_at IS NULL))%',
  'OPS47-9 idx_jobs_city_fold_trgm: GIN trigram na search_fold(city), częściowy jak predykat listy ofert');

-- ============================================================================
-- SS100. Zapisane wyszukiwania i alerty o nowych ofertach (0092, #100): kanoniczne
-- filtry bez duplikatów, izolacja właściciela, RPC-only DML, worker przez
-- get_public_jobs, idempotencja per wyszukiwanie+oferta, opt-out, blokada firmy.
-- ============================================================================
\set SSA 'e9300000-0000-0000-0000-0000000000a1'
\set SSB 'e9300000-0000-0000-0000-0000000000a2'
\set SSE 'e9300000-0000-0000-0000-0000000000b1'
\set SSC 'e9300000-0000-0000-0000-0000000000c1'
\set SSC2 'e9300000-0000-0000-0000-0000000000c2'
\set SSJ1 'e9300000-0000-0000-0000-0000000000d1'
\set SSJ2 'e9300000-0000-0000-0000-0000000000d2'
\set SSJ3 'e9300000-0000-0000-0000-0000000000d3'
\set SSJ4 'e9300000-0000-0000-0000-0000000000d4'
\set SSJ5 'e9300000-0000-0000-0000-0000000000d5'
\set SSJ6 'e9300000-0000-0000-0000-0000000000d6'
\set SSJ7 'e9300000-0000-0000-0000-0000000000d7'

reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'SSA','ssa@test.be','Sara A','{"role":"candidate","first_name":"Sara","last_name":"A","locale":"fr"}'),
  (:'SSB','ssb@test.be','Seb B','{"role":"candidate","first_name":"Seb","last_name":"B","locale":"nl"}'),
  (:'SSE','sse@test.be','Emil E','{"role":"employer","first_name":"Emil","last_name":"E","locale":"pl"}');
insert into public.companies(id,name,status) values
  (:'SSC','Firma SS','verified'), (:'SSC2','Firma SS Blok','verified');
insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'SSC',:'SSE','owner',true);

-- SS100-1: zapis + kanonizacja (kolejność, wielkość liter, spacje) → brak duplikatu.
set role authenticated; set app.current_uid = :'SSA'; select pg_temp.assert_client_role();
select saved_search_id as ss1, created as ss1c from public.save_saved_search(
  'Magazyn Liège', 'pl',
  '{"keyword":" Magazynier SS ","categories":["warehouse","production","warehouse"],"immediate":false}',
  '?keyword=Magazynier+SS&category=warehouse,production') \gset
select pg_temp.assert(:'ss1c'::boolean, 'SS100-1 wyszukiwanie zapisane');
select saved_search_id as ss1b, created as ss1bc from public.save_saved_search(
  'Inna nazwa', 'pl', '{"categories":["production","warehouse"],"keyword":"magazynier ss"}') \gset
select pg_temp.assert(:'ss1' = :'ss1b' and not :'ss1bc'::boolean,
  'SS100-1b identyczne filtry → to samo wyszukiwanie, bez duplikatu');
select pg_temp.assert(
  (select filters from public.saved_searches where id = :'ss1')
    = '{"keyword":"magazynier ss","categories":["production","warehouse"],"locale":"pl"}'::jsonb,
  'SS100-1c filtry kanoniczne (posortowane, bez fałszywych flag, locale przy słowie kluczowym)');
select pg_temp.assert((select filters_version from public.saved_searches where id = :'ss1') = 1,
  'SS100-1d wersja filtrów = 1');
select pg_temp.expect_error(
  'select * from public.save_saved_search(''X'', ''pl'', ''{"since":"2020-01-01"}'')',
  'VALIDATION_FAILED', 'SS100-1e nieznany klucz filtra odrzucony');
select pg_temp.expect_error(
  'select * from public.save_saved_search(''X'', ''pl'', ''{"categories":["nie-ma"]}'')',
  'VALIDATION_FAILED', 'SS100-1f nieznana kategoria odrzucona');
select pg_temp.expect_error(
  'select * from public.save_saved_search(''X'', ''pl'', ''{"salaryMin":3000,"salaryMax":1000}'')',
  'VALIDATION_FAILED', 'SS100-1g minimum powyżej maksimum odrzucone');
select pg_temp.expect_error(
  'select * from public.save_saved_search(''  '', ''pl'', ''{}'')',
  'VALIDATION_FAILED', 'SS100-1h pusta nazwa odrzucona');
select pg_temp.expect_error(
  'select * from public.save_saved_search(''X'', ''de'', ''{}'')',
  'VALIDATION_FAILED', 'SS100-1i nieobsługiwany język odrzucony');
select pg_temp.expect_error(
  'select * from public.save_saved_search(''X'', ''pl'', ''{"immediate":false,"keyword":"  "}'')',
  'VALIDATION_FAILED', 'SS100-1j brak realnego filtra (same puste/fałszywe) odrzucony');
-- Drugie wyszukiwanie SSA: kategoria transport (do kontroli, że worker nie myli filtrów).
select saved_search_id as ss2 from public.save_saved_search('Kierowca', 'fr',
  '{"categories":["transport"]}', '?category=transport', 'weekly') \gset
reset role; reset app.current_uid;

-- SS100-2 (KONTROLE UJEMNE): cudze wyszukiwania niewidoczne i nietykalne.
set role authenticated; set app.current_uid = :'SSB'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.saved_searches) = 0,
  'SS100-2 obcy kandydat nie widzi cudzych wyszukiwań (RLS)');
select pg_temp.expect_error(
  'select public.set_saved_search_alerts(''' || :'ss1' || ''', false)',
  'NOT_FOUND', 'SS100-2b obcy nie wyłączy cudzego alertu');
select pg_temp.expect_error(
  'select public.delete_saved_search(''' || :'ss1' || ''')',
  'NOT_FOUND', 'SS100-2c obcy nie usunie cudzego wyszukiwania');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select alerts_enabled from public.saved_searches where id = :'ss1'),
  'SS100-2d cudzy alert nadal włączony');

-- SS100-3 (KONTROLE UJEMNE): bezpośredni DML odebrany; tabela alertów bez ścieżki klienta.
set role authenticated; set app.current_uid = :'SSA'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.saved_searches) = 2,
  'SS100-3 właściciel widzi swoje wyszukiwania');
select pg_temp.expect_error(
  'insert into public.saved_searches(profile_id,name,locale,filters,filters_hash) values ('''
  || :'SSA' || ''', ''x'', ''pl'', ''{}'', md5(''x''))',
  'permission denied', 'SS100-3b bezpośredni INSERT odrzucony');
select pg_temp.expect_error(
  'update public.saved_searches set next_run_at = now() where id = ''' || :'ss1' || '''',
  'permission denied', 'SS100-3c bezpośredni UPDATE odrzucony');
select pg_temp.expect_error(
  'delete from public.saved_searches where id = ''' || :'ss1' || '''',
  'permission denied', 'SS100-3d bezpośredni DELETE odrzucony');
select pg_temp.expect_error('select count(*) from public.saved_search_alerts',
  'permission denied', 'SS100-3e brak odczytu tabeli alertów');
select pg_temp.expect_error('select public.process_saved_search_alerts(10)',
  'permission denied', 'SS100-3f klient nie uruchomi workera');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'SSE'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.save_saved_search(''X'', ''pl'', ''{}'')',
  'PERMISSION_DENIED', 'SS100-3g pracodawca nie zapisuje wyszukiwań');
reset role; reset app.current_uid;
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error('select * from public.save_saved_search(''X'', ''pl'', ''{}'')',
  'permission denied', 'SS100-3h anon bez EXECUTE');
reset role;

-- SS100-4: worker — nowa pasująca oferta → jeden alert, jedno in-app, jeden e-mail
-- jobMatch w języku ODBIORCY (fr), z tytułem tłumaczenia fr.
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,published_at) values
  (:'SSJ1',:'SSC','ss-j1','Magazynier SS nocny','warehouse','permanent','Liège','Wallonie','active','pl', now()),
  (:'SSJ2',:'SSC','ss-j2','Magazynier SS stary','warehouse','permanent','Liège','Wallonie','active','pl', now() - interval '3 days'),
  (:'SSJ3',:'SSC','ss-j3','Kucharz SS','hospitality','permanent','Liège','Wallonie','active','pl', now());
insert into public.job_translations(job_id, locale, title, description)
  values (:'SSJ1', 'pl', 'Magazynier SS nocny', 'Opis'),
         (:'SSJ1', 'fr', 'Magasinier SS de nuit', 'Description');
update public.saved_searches set next_run_at = now() - interval '1 minute',
  last_checked_at = now() - interval '1 day', alerts_since = now() - interval '2 days' where id in (:'ss1', :'ss2');
set role service_role;
select pg_temp.assert(public.process_saved_search_alerts(100) = 1,
  'SS100-4 jeden digest (drugie wyszukiwanie bez nowych ofert)');
reset role;
select pg_temp.assert(
  (select array_agg(job_id) from public.saved_search_alerts where saved_search_id = :'ss1')
    = array[:'SSJ1'::uuid],
  'SS100-4b tylko nowa oferta pasująca do filtrów (stara i spoza kategorii pominięte)');
select pg_temp.assert(
  (select count(*) from public.email_deliveries where profile_id = :'SSA' and template = 'jobMatch') = 1
  and (select locale from public.email_deliveries where profile_id = :'SSA' and template = 'jobMatch') = 'fr'
  and (select payload -> 'jobs' -> 0 ->> 'title' from public.email_deliveries
         where profile_id = :'SSA' and template = 'jobMatch') = 'Magasinier SS de nuit',
  'SS100-4c jeden e-mail jobMatch w języku odbiorcy (fr) z tytułem fr');
select pg_temp.assert(
  (select count(*) from public.notifications
     where profile_id = :'SSA' and type = 'job_match' and entity_type = 'saved_search'
       and entity_id = :'ss1') = 1,
  'SS100-4d jedno powiadomienie in-app');
select pg_temp.assert(
  (select next_run_at > now() + interval '23 hours' from public.saved_searches where id = :'ss1')
  and (select next_run_at > now() + interval '6 days' from public.saved_searches where id = :'ss2'),
  'SS100-4e limit częstotliwości: kolejny przebieg za dobę / tydzień');

-- SS100-5: ponowny przebieg (wymuszony) nie wysyła tej samej oferty drugi raz.
update public.saved_searches set next_run_at = now() - interval '1 minute' where id = :'ss1';
set role service_role;
select pg_temp.assert(public.process_saved_search_alerts(100) = 0, 'SS100-5 brak nowego digestu');
reset role;
select pg_temp.assert(
  (select count(*) from public.email_deliveries where profile_id = :'SSA' and template = 'jobMatch') = 1,
  'SS100-5b ta sama oferta nie trafia drugi raz (idempotencja wyszukiwanie+oferta)');
-- Kontrola ujemna: bez wpisu w saved_search_alerts ta sama oferta poszłaby ponownie —
-- to PK (wyszukiwanie, oferta) odcina duplikat, nie przypadek.
delete from public.saved_search_alerts where saved_search_id = :'ss1';
update public.saved_searches set next_run_at = now() - interval '1 minute',
  last_checked_at = now() - interval '1 day' where id = :'ss1';
set role service_role;
select pg_temp.assert(public.process_saved_search_alerts(100) = 1,
  'SS100-5c kontrola ujemna: bez rejestru alertów oferta wraca');
reset role;
select pg_temp.assert(
  (select count(*) from public.email_deliveries where profile_id = :'SSA' and template = 'jobMatch') = 2,
  'SS100-5d kontrola ujemna: drugi e-mail pojawia się tylko po usunięciu rejestru');

-- SS100-6 (KONTROLE UJEMNE): opt-out e-mail / in-app → alert zarejestrowany, bez wysyłki.
update public.notification_preferences
  set email_job_matches = false, in_app_enabled = false where profile_id = :'SSA';
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,published_at) values
  (:'SSJ4',:'SSC','ss-j4','Magazynier SS dzienny','warehouse','permanent','Liège','Wallonie','active','pl', now());
update public.saved_searches set next_run_at = now() - interval '1 minute' where id = :'ss1';
set role service_role;
select public.process_saved_search_alerts(100);
reset role;
select pg_temp.assert(
  exists (select 1 from public.saved_search_alerts where saved_search_id = :'ss1' and job_id = :'SSJ4'),
  'SS100-6 oferta zarejestrowana (po ponownym włączeniu nie wróci)');
select pg_temp.assert(
  (select count(*) from public.email_deliveries where profile_id = :'SSA' and template = 'jobMatch') = 2,
  'SS100-6b opt-out email_job_matches → brak e-maila');
select pg_temp.assert(
  (select count(*) from public.notifications where profile_id = :'SSA' and type = 'job_match') = 2,
  'SS100-6c opt-out in_app_enabled → brak powiadomienia');
update public.notification_preferences
  set email_job_matches = true, in_app_enabled = true where profile_id = :'SSA';

-- SS100-7: wyłączony alert nie jest przetwarzany; ponowne włączenie przesuwa watermark.
set role authenticated; set app.current_uid = :'SSA'; select pg_temp.assert_client_role();
select pg_temp.assert(public.set_saved_search_alerts(:'ss1', false) = false, 'SS100-7 alert wyłączony');
reset role; reset app.current_uid;
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,published_at) values
  (:'SSJ5',:'SSC','ss-j5','Magazynier SS weekend','warehouse','permanent','Liège','Wallonie','active','pl', now() - interval '1 minute');
update public.saved_searches set next_run_at = now() - interval '1 minute' where id = :'ss1';
set role service_role;
select pg_temp.assert(public.process_saved_search_alerts(100) = 0, 'SS100-7b wyłączony alert pominięty');
reset role;
select pg_temp.assert(
  not exists (select 1 from public.saved_search_alerts where job_id = :'SSJ5'),
  'SS100-7c brak alertu przy wyłączonym wyszukiwaniu');
set role authenticated; set app.current_uid = :'SSA'; select pg_temp.assert_client_role();
select public.set_saved_search_alerts(:'ss1', true, 'weekly');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select last_checked_at >= now() - interval '5 seconds' and frequency = 'weekly'
     and next_run_at > now() + interval '6 days' from public.saved_searches where id = :'ss1'),
  'SS100-7d ponowne włączenie: watermark = teraz, częstotliwość tygodniowa');

-- SS100-8: oferta firmy zablokowanej przez kandydata nie trafia do alertu.
insert into public.candidate_company_blocks(candidate_id, company_id) values (:'SSA', :'SSC2');
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,published_at) values
  (:'SSJ6',:'SSC2','ss-j6','Magazynier SS blok','warehouse','permanent','Liège','Wallonie','active','pl', now() + interval '1 second'),
  (:'SSJ7',:'SSC','ss-j7','Magazynier SS rano','warehouse','permanent','Liège','Wallonie','active','pl', now() + interval '1 second');
update public.saved_searches set next_run_at = now() - interval '1 minute' where id = :'ss1';
set role service_role;
select public.process_saved_search_alerts(100);
reset role;
select pg_temp.assert(
  not exists (select 1 from public.saved_search_alerts where job_id = :'SSJ6'),
  'SS100-8 oferta zablokowanej firmy pominięta');
select pg_temp.assert(
  exists (select 1 from public.saved_search_alerts where job_id = :'SSJ7'),
  'SS100-8b kontrola: oferta niezablokowanej firmy w tym samym przebiegu trafia do alertu');
select pg_temp.assert(
  not exists (select 1 from public.saved_search_alerts where job_id = :'SSJ5'),
  'SS100-8c oferta opublikowana przy wyłączonym alercie nie wraca po włączeniu');

-- SS100-9: usunięcie własnego wyszukiwania kasuje rejestr alertów.
set role authenticated; set app.current_uid = :'SSA'; select pg_temp.assert_client_role();
select public.delete_saved_search(:'ss1');
select pg_temp.assert((select count(*) from public.saved_searches) = 1, 'SS100-9 wyszukiwanie usunięte');
reset role; reset app.current_uid;
select pg_temp.assert(
  not exists (select 1 from public.saved_search_alerts where saved_search_id = :'ss1'),
  'SS100-9b rejestr alertów usunięty kaskadowo');

-- SS100-10: jednostka widełek (0091) — wyszukiwanie „do 30 EUR/godz.” przekazuje
-- p_salary_unit='hour' do get_public_jobs: stawka 50/godz. odpada, 20/godz. zostaje.
-- Kontrola ujemna: te same kwoty w domyślnej jednostce (month) nie porównują stawek
-- godzinowych, więc 50/godz. by przeszła — różnica dowodzi, że jednostka dociera do SQL.
set role authenticated; set app.current_uid = :'SSB'; select pg_temp.assert_client_role();
select saved_search_id as ss10 from public.save_saved_search('Sprzątanie godzinowe', 'nl',
  '{"categories":["cleaning"],"salaryMin":15,"salaryMax":30,"salaryUnit":"hour"}') \gset
select saved_search_id as ss10m from public.save_saved_search('Sprzątanie miesięczne', 'nl',
  '{"categories":["cleaning"],"salaryMin":15,"salaryMax":30}') \gset
select pg_temp.expect_error(
  'select * from public.save_saved_search(''X'', ''nl'', ''{"categories":["cleaning"],"salaryUnit":"day"}'')',
  'VALIDATION_FAILED', 'SS100-10 nieznana jednostka odrzucona');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select filters ->> 'salaryUnit' from public.saved_searches where id = :'ss10') = 'hour'
  and not (select filters ? 'salaryUnit' from public.saved_searches where id = :'ss10m'),
  'SS100-10b jednostka godzinowa w filtrach kanonicznych, domyślna pominięta');
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,
                        published_at,salary_min,salary_max,salary_period) values
  ('e9300000-0000-0000-0000-0000000000e1',:'SSC','ss-h20','Sprzątanie SS 20','cleaning','permanent',
   'Liège','Wallonie','active','pl', now(), 20, 20, 'hour'),
  ('e9300000-0000-0000-0000-0000000000e2',:'SSC','ss-h50','Sprzątanie SS 50','cleaning','permanent',
   'Liège','Wallonie','active','pl', now(), 50, 50, 'hour');
update public.saved_searches set next_run_at = now() - interval '1 minute' where id in (:'ss10', :'ss10m');
set role service_role;
select public.process_saved_search_alerts(100);
reset role;
select pg_temp.assert(
  (select array_agg(job_id order by job_id) from public.saved_search_alerts where saved_search_id = :'ss10')
    = array['e9300000-0000-0000-0000-0000000000e1'::uuid],
  'SS100-10c jednostka godzinowa: 20/godz. w alercie, 50/godz. odpada');
select pg_temp.assert(
  exists (select 1 from public.saved_search_alerts
            where saved_search_id = :'ss10m' and job_id = 'e9300000-0000-0000-0000-0000000000e2'),
  'SS100-10d kontrola ujemna: bez jednostki stawka godzinowa nie jest porównywana (50/godz. przechodzi)');
reset role; reset app.current_uid;

-- ============================================================================
-- SQ101. Pytania screeningowe (0093, #101): zapis w szkicu (recruiter+, atomowo z krokiem),
--        odpowiedzi walidowane w bazie razem z aplikacją, niezmienny snapshot, RLS odczytu.
-- ============================================================================
\set SQJOB  'f1010000-0000-0000-0000-0000000000a1'
\set SQJOB2 'f1010000-0000-0000-0000-0000000000a2'
\set SQMEM  'f1010000-0000-0000-0000-0000000000c1'
\set SQCAND 'f1010000-0000-0000-0000-0000000000c2'
\set SQCAND2 'f1010000-0000-0000-0000-0000000000c3'
reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'SQMEM','sqmem@test.be','Sq Mem','{"role":"employer","first_name":"Sq","last_name":"Mem","locale":"pl"}'),
  (:'SQCAND','sqcand@test.be','Sq Cand','{"role":"candidate","first_name":"Sq","last_name":"Cand","locale":"fr"}'),
  (:'SQCAND2','sqcand2@test.be','Sq Cand2','{"role":"candidate","first_name":"Sq","last_name":"Cand2","locale":"nl"}');
insert into public.company_members(company_id, profile_id, role, is_active) values (:'COMPA', :'SQMEM', 'member', true);
insert into public.jobs(id, company_id, created_by, slug, title, category, contract_type, city, region, status, default_locale) values
  (:'SQJOB', :'COMPA', :'EMPA', 'draft-sq101', 'Kierowca C+E', 'transport', 'permanent', 'Gandawa', 'Flandria', 'draft', 'pl'),
  (:'SQJOB2', :'COMPA', :'EMPA', 'draft-sq101-2', 'Magazynier', 'warehouse', 'permanent', 'Gandawa', 'Flandria', 'draft', 'pl');

-- SQ101-1: recruiter+ zapisuje pytania krokiem kreatora (razem z inną relacją kroku).
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.save_job_draft(:'SQJOB'::uuid, $j${
  "certificates": ["VCA"],
  "screening_questions": [
    {"type": "yes_no", "required": true, "prompt": {"pl": "  Masz prawo jazdy C+E? ", "fr": "Permis C+E ?", "en": ""}},
    {"type": "single_choice", "required": true, "prompt": {"pl": "Jak dojedziesz?"},
     "options": [{"label": {"pl": "Własny samochód", "nl": "Eigen auto"}}, {"label": {"pl": "Komunikacja"}}]},
    {"type": "date", "required": false, "prompt": {"pl": "Od kiedy możesz zacząć?"}},
    {"type": "short_text", "prompt": {"pl": "Doświadczenie z tachografem?"}}
  ]
}$j$::jsonb);
select count(*) = 4 as ok from public.job_screening_questions where job_id = :'SQJOB' \gset sq1_
select pg_temp.assert(:'sq1_ok'::boolean, 'SQ101-1 członek recruiter+ czyta 4 zapisane pytania');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select prompt = '{"pl": "Masz prawo jazdy C+E?", "fr": "Permis C+E ?"}'::jsonb and required and type = 'yes_no'
     from public.job_screening_questions where job_id = :'SQJOB' and position = 0)
  and (select options = '[{"id": "o1", "label": {"pl": "Własny samochód", "nl": "Eigen auto"}},
                          {"id": "o2", "label": {"pl": "Komunikacja"}}]'::jsonb
         from public.job_screening_questions where job_id = :'SQJOB' and position = 1)
  and (select not required from public.job_screening_questions where job_id = :'SQJOB' and position = 3)
  and (select array_agg(certificate_label) from public.job_certificates where job_id = :'SQJOB') = array['VCA'],
  'SQ101-1b treść przycięta, pusty język pominięty, id opcji nadane przez bazę, krok zapisany w całości');

-- SQ101-2 (kontrola ujemna): member bez recruiter+ i inna firma nie zapisują pytań.
set role authenticated; set app.current_uid = :'SQMEM'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.set_job_screening_questions(%L::uuid, %L::jsonb)', :'SQJOB', '[]'),
  'PERMISSION_DENIED', 'SQ101-2 member nie ustala pytań');
select pg_temp.expect_error(
  format('select public.save_job_draft(%L::uuid, %L::jsonb)', :'SQJOB', '{"screening_questions": []}'),
  'PERMISSION_DENIED', 'SQ101-2b member nie zapisuje pytań krokiem kreatora');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.set_job_screening_questions(%L::uuid, %L::jsonb)', :'SQJOB', '[]'),
  'PERMISSION_DENIED', 'SQ101-2c inna firma nie ustala pytań');
select count(*) = 0 as ok from public.job_screening_questions where job_id = :'SQJOB' \gset sq2_
select pg_temp.assert(:'sq2_ok'::boolean, 'SQ101-2d inna firma nie czyta pytań szkicu');
reset role; reset app.current_uid;

-- SQ101-3 (kontrola ujemna): walidacja w bazie — limity, typy, język oferty; błąd cofa cały krok.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.set_job_screening_questions(%L::uuid, %L::jsonb)', :'SQJOB',
    (select jsonb_agg(jsonb_build_object('type', 'yes_no', 'prompt', jsonb_build_object('pl', 'P' || g)))
       from generate_series(1, 11) g)),
  'VALIDATION_FAILED', 'SQ101-3 więcej niż 10 pytań odrzucone');
select pg_temp.expect_error(
  format('select public.set_job_screening_questions(%L::uuid, %L::jsonb)', :'SQJOB',
    '[{"type": "single_choice", "prompt": {"pl": "X"}, "options": [{"label": {"pl": "Jedna"}}]}]'),
  'VALIDATION_FAILED', 'SQ101-3b wybór z jedną opcją odrzucony');
select pg_temp.expect_error(
  format('select public.set_job_screening_questions(%L::uuid, %L::jsonb)', :'SQJOB',
    '[{"type": "yes_no", "prompt": {"fr": "Seulement FR"}}]'),
  'VALIDATION_FAILED', 'SQ101-3c brak treści w języku oferty odrzucony');
select pg_temp.expect_error(
  format('select public.set_job_screening_questions(%L::uuid, %L::jsonb)', :'SQJOB',
    '[{"type": "yes_no", "prompt": {"pl": "X", "xx": "Y"}}]'),
  'VALIDATION_FAILED', 'SQ101-3d nieobsługiwany język odrzucony');
select pg_temp.expect_error(
  format('select public.set_job_screening_questions(%L::uuid, %L::jsonb)', :'SQJOB',
    jsonb_build_array(jsonb_build_object('type', 'short_text', 'prompt', jsonb_build_object('pl', repeat('x', 301))))),
  'VALIDATION_FAILED', 'SQ101-3e za długa treść odrzucona (bez cichego obcinania)');
select pg_temp.expect_error(
  format('select public.set_job_screening_questions(%L::uuid, %L::jsonb)', :'SQJOB',
    '[{"type": "yes_no", "prompt": {"pl": "X"}, "options": [{"label": {"pl": "A"}}]}]'),
  'VALIDATION_FAILED', 'SQ101-3f opcje przy pytaniu tak/nie odrzucone');
select pg_temp.expect_error(
  format('select public.set_job_screening_questions(%L::uuid, %L::jsonb)', :'SQJOB',
    '[{"type": "number", "prompt": {"pl": "X"}}]'),
  'VALIDATION_FAILED', 'SQ101-3g nieznany typ odrzucony');
select pg_temp.expect_error(
  format('select public.save_job_draft(%L::uuid, %L::jsonb)', :'SQJOB',
    '{"certificates": ["Inny"], "screening_questions": [{"type": "yes_no", "prompt": {}}]}'),
  'VALIDATION_FAILED', 'SQ101-3h błędne pytanie odrzuca cały krok');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.job_screening_questions where job_id = :'SQJOB') = 4
  and (select array_agg(certificate_label) from public.job_certificates where job_id = :'SQJOB') = array['VCA'],
  'SQ101-3i odrzucone zapisy nie zmieniły pytań ani relacji kroku');

-- SQ101-4 (kontrola ujemna): bezpośredni DML na pytaniach odebrany klientom.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('insert into public.job_screening_questions(job_id, position, type, prompt) values (%L, 5, %L, %L)',
         :'SQJOB', 'yes_no', '{"pl": "Obejście"}'),
  'permission denied', 'SQ101-4 bezpośredni INSERT pytań odrzucony');
select pg_temp.expect_error(
  format('update public.job_screening_questions set required = false where job_id = %L', :'SQJOB'),
  'permission denied', 'SQ101-4b bezpośredni UPDATE pytań odrzucony');
select pg_temp.expect_error(
  format('delete from public.job_screening_questions where job_id = %L', :'SQJOB'),
  'permission denied', 'SQ101-4c bezpośredni DELETE pytań odrzucony');
reset role; reset app.current_uid;

-- SQ101-5: szkic nie jest publiczny — anon nie widzi jego pytań; tabela bez dostępu dla anon.
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select count(*) = 0 as ok from public.get_public_job_screening_questions(:'SQJOB') \gset sq5_
select pg_temp.assert(:'sq5_ok'::boolean, 'SQ101-5 pytania szkicu niepubliczne');
select pg_temp.expect_error('select count(*) from public.job_screening_questions',
  'permission denied', 'SQ101-5b anon bez dostępu do tabeli pytań');
select pg_temp.expect_error(
  format('select public.set_job_screening_questions(%L::uuid, %L::jsonb)', :'SQJOB', '[]'),
  'permission denied', 'SQ101-5c anon nie woła set_job_screening_questions');
reset role;

-- Publikacja (superuser — kompletność publish_job testują sekcje P/Y).
update public.jobs set status = 'active', published_at = now(), slug = 'sq101-kierowca' where id = :'SQJOB';
select id as sq_yes from public.job_screening_questions where job_id = :'SQJOB' and position = 0 \gset
select id as sq_choice from public.job_screening_questions where job_id = :'SQJOB' and position = 1 \gset
select id as sq_date from public.job_screening_questions where job_id = :'SQJOB' and position = 2 \gset
select id as sq_text from public.job_screening_questions where job_id = :'SQJOB' and position = 3 \gset

-- SQ101-6 (kontrola ujemna): po publikacji pytań nie zmienia żadna ścieżka.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.set_job_screening_questions(%L::uuid, %L::jsonb)', :'SQJOB', '[]'),
  'JOB_NOT_DRAFT', 'SQ101-6 opublikowana oferta: pytań nie zmienia RPC');
select pg_temp.expect_error(
  format('select public.save_job_draft(%L::uuid, %L::jsonb)', :'SQJOB', '{"screening_questions": []}'),
  'JOB_NOT_DRAFT', 'SQ101-6b opublikowana oferta: pytań nie zmienia krok kreatora');
reset role; reset app.current_uid;
select pg_temp.expect_error(
  format('update public.job_screening_questions set required = false where id = %L', :'sq_yes'),
  'JOB_NOT_DRAFT', 'SQ101-6c strażnik blokuje zmianę pytań opublikowanej oferty także poza RPC');
select pg_temp.expect_error(
  format('insert into public.job_screening_questions(job_id, position, type, prompt) values (%L, 7, %L, %L)',
         :'SQJOB', 'yes_no', '{"pl": "Nowe"}'),
  'JOB_NOT_DRAFT', 'SQ101-6d strażnik blokuje dodanie pytania do opublikowanej oferty');

-- SQ101-7: oferta publiczna — gość widzi pytania w kolejności.
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select (array_agg(type order by position) = array['yes_no', 'single_choice', 'date', 'short_text']) as ok
  from public.get_public_job_screening_questions(:'SQJOB') \gset sq7_
select pg_temp.assert(:'sq7_ok'::boolean, 'SQ101-7 pytania publicznej oferty w kolejności');
select pg_temp.expect_error(
  format('select public.apply_to_job(%L::uuid, %L)', :'SQJOB', 'sq-anon'),
  'permission denied', 'SQ101-7b anon nie aplikuje');
reset role;

-- SQ101-8 (kontrola ujemna): brak odpowiedzi na pytanie wymagane → błąd w bazie, brak aplikacji.
set role authenticated; set app.current_uid = :'SQCAND'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.apply_to_job(%L::uuid, %L, null, null, null, null)', :'SQJOB', 'sq-k0'),
  'SCREENING_ANSWER_REQUIRED', 'SQ101-8 brak odpowiedzi na wymagane pytania');
select pg_temp.expect_error(
  format('select public.apply_to_job(%L::uuid, %L, null, null, null, %L::jsonb)', :'SQJOB', 'sq-k0',
         jsonb_build_object(:'sq_yes', true, :'sq_choice', '  ')),
  'SCREENING_ANSWER_REQUIRED: ' || :'sq_choice', 'SQ101-8b pusty tekst = brak odpowiedzi (id pytania w błędzie)');
-- Złe typy/wartości → VALIDATION_FAILED.
select pg_temp.expect_error(
  format('select public.apply_to_job(%L::uuid, %L, null, null, null, %L::jsonb)', :'SQJOB', 'sq-k0',
         jsonb_build_object(:'sq_yes', 'tak', :'sq_choice', 'o1')),
  'VALIDATION_FAILED', 'SQ101-8c tak/nie jako tekst odrzucone');
select pg_temp.expect_error(
  format('select public.apply_to_job(%L::uuid, %L, null, null, null, %L::jsonb)', :'SQJOB', 'sq-k0',
         jsonb_build_object(:'sq_yes', true, :'sq_choice', 'o9')),
  'VALIDATION_FAILED', 'SQ101-8d nieznana opcja odrzucona');
select pg_temp.expect_error(
  format('select public.apply_to_job(%L::uuid, %L, null, null, null, %L::jsonb)', :'SQJOB', 'sq-k0',
         jsonb_build_object(:'sq_yes', true, :'sq_choice', 'o1', :'sq_date', '2026-02-30')),
  'VALIDATION_FAILED', 'SQ101-8e nieistniejąca data odrzucona');
select pg_temp.expect_error(
  format('select public.apply_to_job(%L::uuid, %L, null, null, null, %L::jsonb)', :'SQJOB', 'sq-k0',
         jsonb_build_object(:'sq_yes', true, :'sq_choice', 'o1', :'sq_text', repeat('x', 501))),
  'VALIDATION_FAILED', 'SQ101-8f za długa odpowiedź odrzucona');
select pg_temp.expect_error(
  format('select public.apply_to_job(%L::uuid, %L, null, null, null, %L::jsonb)', :'SQJOB', 'sq-k0',
         jsonb_build_object(:'sq_yes', true, :'sq_choice', 'o1', 'f1010000-0000-0000-0000-00000000dead', true)),
  'VALIDATION_FAILED', 'SQ101-8g odpowiedź na pytanie spoza oferty odrzucona');
reset role; reset app.current_uid;
select pg_temp.assert(
  not exists (select 1 from public.applications where job_id = :'SQJOB')
  and not exists (select 1 from public.email_deliveries e join public.applications a on a.id = e.entity_id where a.job_id = :'SQJOB'),
  'SQ101-8h odrzucone próby nie zostawiły aplikacji ani e-maili');

-- SQ101-9: poprawna aplikacja zapisuje snapshot odpowiedzi; retry = ta sama aplikacja bez zmian.
set role authenticated; set app.current_uid = :'SQCAND'; select pg_temp.assert_client_role();
select public.apply_to_job(:'SQJOB'::uuid, 'sq-k1', null, 'immediate', null,
  jsonb_build_object(:'sq_yes', true, :'sq_choice', 'o2', :'sq_date', '2026-10-01')) as sqapp \gset
select public.apply_to_job(:'SQJOB'::uuid, 'sq-k1', null, 'immediate', null,
  jsonb_build_object(:'sq_yes', false, :'sq_choice', 'o1', :'sq_text', 'Inna odpowiedź')) = :'sqapp'::uuid as ok \gset sq9_
select pg_temp.assert(:'sq9_ok'::boolean, 'SQ101-9 retry z tym samym kluczem = ta sama aplikacja');
select pg_temp.expect_error(
  format('select public.apply_to_job(%L::uuid, %L, null, null, null, %L::jsonb)', :'SQJOB', 'sq-k2',
         jsonb_build_object(:'sq_yes', true, :'sq_choice', 'o1')),
  'APPLICATION_ALREADY_EXISTS', 'SQ101-9b inny klucz = istniejąca aplikacja');
select (count(*) = 4
        and bool_and(case position
              when 0 then answer_boolean is true and prompt->>'pl' = 'Masz prawo jazdy C+E?'
              when 1 then answer_text = 'o2' and options->1->'label'->>'pl' = 'Komunikacja'
              when 2 then answer_date = date '2026-10-01'
              else answer_text is null and answer_boolean is null and not required end)) as ok
  from public.application_screening_answers where application_id = :'sqapp' \gset sq9c_
select pg_temp.assert(:'sq9c_ok'::boolean,
  'SQ101-9c kandydat widzi własne odpowiedzi; retry ich nie nadpisał; pytanie opcjonalne bez odpowiedzi zachowane');
-- SQ101-10 (kontrola ujemna): odpowiedzi niezmienne i bez DML dla klienta.
select pg_temp.expect_error(
  format('update public.application_screening_answers set answer_boolean = false where application_id = %L', :'sqapp'),
  'permission denied', 'SQ101-10 kandydat nie zmienia odpowiedzi');
select pg_temp.expect_error(
  format('insert into public.application_screening_answers(application_id, position, type, required, prompt) values (%L, 9, %L, false, %L)',
         :'sqapp', 'short_text', '{"pl": "x"}'),
  'permission denied', 'SQ101-10b kandydat nie dopisuje odpowiedzi');
select pg_temp.expect_error(
  format('delete from public.application_screening_answers where application_id = %L', :'sqapp'),
  'permission denied', 'SQ101-10c kandydat nie usuwa odpowiedzi');
reset role; reset app.current_uid;
select pg_temp.expect_error(
  format('update public.application_screening_answers set answer_boolean = false where application_id = %L', :'sqapp'),
  'niezmienne', 'SQ101-10d odpowiedzi niezmienne także poza rolą klienta');
select pg_temp.expect_error(
  format('insert into public.application_screening_answers(application_id, position, type, required, prompt) values (%L, 9, %L, true, %L)',
         :'sqapp', 'yes_no', '{"pl": "x"}'),
  'application_screening_answers_required', 'SQ101-10e wymagane pytanie bez odpowiedzi odrzuca CHECK w bazie');

-- SQ101-11: odczyt — recruiter+ firmy oferty tak; member, inna firma i inny kandydat nie.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select count(*) = 4 as ok from public.application_screening_answers where application_id = :'sqapp' \gset sq11_
select pg_temp.assert(:'sq11_ok'::boolean, 'SQ101-11 recruiter+ firmy oferty czyta odpowiedzi');
select pg_temp.expect_error(
  format('update public.application_screening_answers set answer_text = %L where application_id = %L', 'x', :'sqapp'),
  'permission denied', 'SQ101-11b pracodawca nie zmienia odpowiedzi');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'SQMEM'; select pg_temp.assert_client_role();
select count(*) = 0 as ok from public.application_screening_answers where application_id = :'sqapp' \gset sq11c_
select pg_temp.assert(:'sq11c_ok'::boolean, 'SQ101-11c member bez recruiter+ nie czyta odpowiedzi');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select count(*) = 0 as ok from public.application_screening_answers \gset sq11d_
select pg_temp.assert(:'sq11d_ok'::boolean, 'SQ101-11d inna firma nie czyta odpowiedzi');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'SQCAND2'; select pg_temp.assert_client_role();
select count(*) = 0 as ok from public.application_screening_answers \gset sq11e_
select pg_temp.assert(:'sq11e_ok'::boolean, 'SQ101-11e inny kandydat nie czyta cudzych odpowiedzi');
reset role; reset app.current_uid;

-- SQ101-12: zmiana pytania po złożeniu aplikacji (ręczna, z pominięciem strażnika) nie zmienia
-- historycznej treści w zgłoszeniu — snapshot jest niezależny od pytania.
set session_replication_role = replica;
update public.job_screening_questions set prompt = '{"pl": "Zmienione pytanie"}', required = false where id = :'sq_yes';
delete from public.job_screening_questions where id = :'sq_choice';
set session_replication_role = origin;
select pg_temp.assert(
  (select prompt->>'pl' = 'Masz prawo jazdy C+E?' and required and question_id = :'sq_yes'::uuid
     from public.application_screening_answers where application_id = :'sqapp' and position = 0)
  and (select answer_text = 'o2' and jsonb_array_length(options) = 2 and prompt->>'pl' = 'Jak dojedziesz?'
         from public.application_screening_answers where application_id = :'sqapp' and position = 1),
  'SQ101-12 snapshot zachowuje treść pytania i opcje po zmianie/usunięciu pytania');

-- SQ101-13: oferta bez pytań — aplikacja bez odpowiedzi jak dotąd; odpowiedź do nieistniejącego pytania odrzucona.
update public.jobs set status = 'active', published_at = now(), slug = 'sq101-magazynier' where id = :'SQJOB2';
set role authenticated; set app.current_uid = :'SQCAND2'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.apply_to_job(%L::uuid, %L, null, null, null, %L::jsonb)', :'SQJOB2', 'sq2-k0',
         jsonb_build_object(:'sq_date', '2026-10-01')),
  'VALIDATION_FAILED', 'SQ101-13 odpowiedź na pytanie innej oferty odrzucona');
select public.apply_to_job(:'SQJOB2'::uuid, 'sq2-k1', null, null, null) is not null as ok \gset sq13_
select pg_temp.assert(:'sq13_ok'::boolean, 'SQ101-13b oferta bez pytań: aplikacja jak dotąd');
reset role; reset app.current_uid;

-- ============================================================================
-- DSA41. Publiczne zgłoszenia treści i trwały model sprawy (0094, #41):
-- RPC tylko service_role, idempotencja (także wyścig), tylko treść publiczna, izolacja
-- spraw, niezmienny zapis i dowód, historia statusów, limit, e-mail w języku zgłaszającego.
-- ============================================================================
\set DSAK1 'e9500000-0000-0000-0000-0000000000a1'
\set DSAK2 'e9500000-0000-0000-0000-0000000000a2'
\set DSAK3 'e9500000-0000-0000-0000-0000000000a3'
\set DSAKR 'e9500000-0000-0000-0000-0000000000a4'
\set DSACODE 'ABCDEFGHIJKLMNOPQRSTUVWX'
\set DSACODE2 'ZZZZZZZZZZZZZZZZZZZZZZZZ'
\set DSADRAFT 'e9500000-0000-0000-0000-0000000000d1'
\set DSAJA 'e9500000-0000-0000-0000-0000000000b1'
\set DSAJB 'e9500000-0000-0000-0000-0000000000b2'
reset role; reset app.current_uid;
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'DSAJA',:'COMPA','dsa-job-a','Magazynier A','warehouse','permanent','Antwerpia','Flandria','active','pl'),
  (:'DSAJB',:'COMPB','dsa-job-b','Kierowca B','transport','permanent','Gandawa','Flandria','active','pl'),
  (:'DSADRAFT',:'COMPA','dsa-draft','Szkic prywatny','warehouse','permanent','Antwerpia','Flandria','draft','pl');
insert into public.job_translations(job_id, locale, title, description)
  values (:'DSAJA', 'pl', 'Magazynier A', 'Opis oferty A w chwili zgłoszenia');

-- DSA41-1: klient nie woła RPC ani nie pisze bezpośrednio (Turnstile i limiter są w aplikacji).
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.submit_content_report(null, gen_random_uuid(), ''ABCDEFGHIJKLMNOPQRSTUVWX'', ''job'', '''
  || :'DSAJA' || ''', ''fraud'', ''Opis zgłoszenia dłuższy niż dwadzieścia'', null, null, ''a@test.be'', ''pl'', true)',
  'permission denied', 'DSA41-1 anon bez EXECUTE submit_content_report');
select pg_temp.expect_error('select public.get_report_case(''DSA-1'', ''ABCDEFGHIJKLMNOPQRSTUVWX'')',
  'permission denied', 'DSA41-1b anon bez EXECUTE get_report_case');
select pg_temp.expect_error(
  'insert into public.reports(target_type, target_id, reason) values (''job'', ''' || :'DSAJA' || ''', ''spam'')',
  'permission denied', 'DSA41-1c anon bez bezpośredniego INSERT');
reset role;
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select * from public.submit_content_report(''' || :'CANDA' || ''', gen_random_uuid(), ''ABCDEFGHIJKLMNOPQRSTUVWX'', ''job'', '''
  || :'DSAJA' || ''', ''fraud'', ''Opis zgłoszenia dłuższy niż dwadzieścia'', null, null, ''a@test.be'', ''pl'', true)',
  'permission denied', 'DSA41-1d authenticated bez EXECUTE submit_content_report');
select pg_temp.expect_error(
  'insert into public.reports(reporter_id, target_type, target_id, reason, kind) values ('''
  || :'CANDA' || ''', ''job'', ''' || :'DSAJA' || ''', ''spam'', ''dsa_notice'')',
  'permission denied', 'DSA41-1e authenticated bez bezpośredniego INSERT (także sfałszowanej sprawy)');
select pg_temp.expect_error('select public.enqueue_email_to_address(''x@test.be'', ''pl'', null, ''reportReceived'', ''report'', null, ''k'', ''{}'')',
  'permission denied', 'DSA41-1f klient nie kolejkuje e-maili na dowolny adres');
reset role; reset app.current_uid;

-- DSA41-2: gość zgłasza publiczną ofertę → sprawa, numer, historia, dowód, e-mail w jego języku.
set role service_role;
select report_id as dsa1, case_number as dsacase1, created as dsacreated1
  from public.submit_content_report(null, :'DSAK1', :'DSACODE', 'job', :'DSAJA', 'fraud',
    '  Oferta wymaga opłaty za rekrutację z góry.  ', 'https://pracuj.be/fr/oferty-pracy/job-a',
    'Jan Gość', '  Gosc@Test.be ', 'fr', true) \gset
reset role;
select pg_temp.assert(:'dsacreated1'::boolean, 'DSA41-2 sprawa utworzona');
select pg_temp.assert(:'dsacase1' ~ '^DSA-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$',
  'DSA41-2b numer sprawy w formacie DSA-XXXX-XXXX-XXXX-XXXX');
select pg_temp.assert(
  (select kind = 'dsa_notice' and status = 'open' and reporter_id is null and target_id = :'DSAJA'::uuid
          and reporter_email = 'gosc@test.be' and reporter_locale = 'fr'
          and details = 'Oferta wymaga opłaty za rekrutację z góry.'
          and access_code_hash <> :'DSACODE' and due_at > created_at
     from public.reports where id = :'dsa1'),
  'DSA41-2c zapis sprawy (e-mail znormalizowany, kod tylko jako skrót, termin)');
select pg_temp.assert(
  (select target_snapshot #>> '{job,title}' = 'Magazynier A'
          and target_snapshot #>> '{company,name}' = (select name from public.companies where id = :'COMPA')
          and target_snapshot #>> '{job,translations,0,description}' = 'Opis oferty A w chwili zgłoszenia'
     from public.reports where id = :'dsa1'),
  'DSA41-2d dowód z bazy: tytuł, firma i treść oferty w chwili zgłoszenia');
select pg_temp.assert(
  (select count(*) from public.report_events where report_id = :'dsa1' and event_type = 'submitted') = 1,
  'DSA41-2e zdarzenie submitted w historii');
select pg_temp.assert(
  (select count(*) from public.email_deliveries
     where entity_id = :'dsa1' and template = 'reportReceived' and to_email = 'gosc@test.be'
       and locale = 'fr' and status = 'queued' and payload->>'caseNumber' = :'dsacase1') = 1,
  'DSA41-2f jedno potwierdzenie reportReceived w języku zgłaszającego (fr) w outboxie');

-- DSA41-3: to samo wysłanie ponownie → ta sama sprawa, bez drugiego e-maila; inny kod → odmowa.
set role service_role;
select report_id as dsa1b, case_number as dsacase1b, created as dsacreated1b
  from public.submit_content_report(null, :'DSAK1', :'DSACODE', 'job', :'DSAJA', 'fraud',
    'Oferta wymaga opłaty za rekrutację z góry.', null, 'Jan Gość', 'gosc@test.be', 'fr', true) \gset
select pg_temp.expect_error(
  'select * from public.submit_content_report(null, ''' || :'DSAK1' || ''', ''' || :'DSACODE2' || ''', ''job'', '''
  || :'DSAJA' || ''', ''fraud'', ''Oferta wymaga opłaty za rekrutację z góry.'', null, null, ''gosc@test.be'', ''fr'', true)',
  'VALIDATION_FAILED', 'DSA41-3c cudzy klucz z innym kodem nie zwraca cudzej sprawy');
reset role;
select pg_temp.assert(:'dsa1b' = :'dsa1' and :'dsacase1b' = :'dsacase1' and not :'dsacreated1b'::boolean,
  'DSA41-3 ponowienie zwraca tę samą sprawę');
select pg_temp.assert(
  (select count(*) from public.reports where idempotency_key = :'DSAK1') = 1
  and (select count(*) from public.email_deliveries where entity_id = :'dsa1') = 1,
  'DSA41-3b jedna sprawa i jeden e-mail po ponowieniu');

-- DSA41-4: wyścig — dwie równoległe sesje z tym samym kluczem tworzą jedną sprawę.
create function pg_temp.dsa_remote_begin(p_conn text) returns int
language plpgsql as $$
declare v_pid int;
begin
  perform pg_temp.remote_connect(p_conn);
  perform dbl.dblink_exec(p_conn, 'begin');
  perform dbl.dblink_exec(p_conn, 'set local lock_timeout = ''15s''');
  perform dbl.dblink_exec(p_conn, 'set local role service_role');
  select t.pid into v_pid from dbl.dblink(p_conn, 'select pg_backend_pid()') as t(pid int);
  return v_pid;
end $$;
select 'select report_id::text from public.submit_content_report(null, ''' || :'DSAKR' || ''', ''' || :'DSACODE'
  || ''', ''company'', ''' || :'DSAJB' || ''', ''impersonation'', ''Firma podszywa się pod znanego pracodawcę.'', null, null, ''race@test.be'', ''nl'', true)'
  as dsa_race_sql \gset
select pg_temp.dsa_remote_begin('dsa_a') as dsa_pid_a \gset
select pg_temp.dsa_remote_begin('dsa_b') as dsa_pid_b \gset
select t.v as dsar_a from dbl.dblink('dsa_a', :'dsa_race_sql') as t(v text) \gset
select dbl.dblink_send_query('dsa_b', :'dsa_race_sql');
select pg_temp.wait_blocked(:dsa_pid_b, 'DSA41-4');
select dbl.dblink_exec('dsa_a', 'commit');
select pg_temp.remote_result('dsa_b') as dsar_b \gset
select dbl.dblink_exec('dsa_b', 'commit');
select dbl.dblink_disconnect('dsa_a'); select dbl.dblink_disconnect('dsa_b');
select pg_temp.assert(:'dsar_a' = :'dsar_b', 'DSA41-4 równoległe wysłanie zwraca tę samą sprawę');
select pg_temp.assert(
  (select count(*) from public.reports where idempotency_key = :'DSAKR') = 1
  and (select count(*) from public.email_deliveries where entity_id = :'dsar_a'::uuid) = 1,
  'DSA41-4b jedna sprawa i jeden e-mail po wyścigu');
select pg_temp.assert(
  (select target_type::text = 'company' and target_id = :'COMPB'::uuid from public.reports where id = :'dsar_a'),
  'DSA41-4c zgłoszenie firmy wskazuje firmę oferty');

-- DSA41-5: treść prywatna i obcy identyfikator → ten sam NOT_FOUND; walidacja pól.
set role service_role;
select pg_temp.expect_error(
  'select * from public.submit_content_report(null, gen_random_uuid(), ''ABCDEFGHIJKLMNOPQRSTUVWX'', ''job'', '''
  || :'DSADRAFT' || ''', ''fraud'', ''Opis zgłoszenia dłuższy niż dwadzieścia'', null, null, ''p@test.be'', ''pl'', true)',
  'NOT_FOUND', 'DSA41-5 szkic (treść prywatna) → NOT_FOUND');
select pg_temp.expect_error(
  'select * from public.submit_content_report(null, gen_random_uuid(), ''ABCDEFGHIJKLMNOPQRSTUVWX'', ''company'', '''
  || gen_random_uuid() || ''', ''fraud'', ''Opis zgłoszenia dłuższy niż dwadzieścia'', null, null, ''p@test.be'', ''pl'', true)',
  'NOT_FOUND', 'DSA41-5b nieistniejący identyfikator → NOT_FOUND');
select pg_temp.expect_error(
  'select * from public.submit_content_report(null, gen_random_uuid(), ''ABCDEFGHIJKLMNOPQRSTUVWX'', ''job'', '''
  || :'DSAJA' || ''', ''fraud'', ''Opis zgłoszenia dłuższy niż dwadzieścia'', null, null, ''p@test.be'', ''pl'', false)',
  'VALIDATION_FAILED', 'DSA41-5c bez oświadczenia odrzucone');
select pg_temp.expect_error(
  'select * from public.submit_content_report(null, gen_random_uuid(), ''ABCDEFGHIJKLMNOPQRSTUVWX'', ''job'', '''
  || :'DSAJA' || ''', ''fraud'', ''za krótko'', null, null, ''p@test.be'', ''pl'', true)',
  'VALIDATION_FAILED', 'DSA41-5d za krótki opis odrzucony');
select pg_temp.expect_error(
  'select * from public.submit_content_report(null, gen_random_uuid(), ''ABCDEFGHIJKLMNOPQRSTUVWX'', ''job'', '''
  || :'DSAJA' || ''', ''spam'', ''Opis zgłoszenia dłuższy niż dwadzieścia'', null, null, ''p@test.be'', ''pl'', true)',
  'VALIDATION_FAILED', 'DSA41-5e kategoria spoza katalogu odrzucona');
select pg_temp.expect_error(
  'select * from public.submit_content_report(null, gen_random_uuid(), ''ABCDEFGHIJKLMNOPQRSTUVWX'', ''job'', '''
  || :'DSAJA' || ''', ''fraud'', ''Opis zgłoszenia dłuższy niż dwadzieścia'', ''javascript:alert(1)'', null, ''p@test.be'', ''pl'', true)',
  'VALIDATION_FAILED', 'DSA41-5f adres treści tylko http(s)');
select pg_temp.expect_error(
  'select * from public.submit_content_report(null, gen_random_uuid(), ''abc'', ''job'', '''
  || :'DSAJA' || ''', ''fraud'', ''Opis zgłoszenia dłuższy niż dwadzieścia'', null, null, ''p@test.be'', ''pl'', true)',
  'VALIDATION_FAILED', 'DSA41-5g słaby kod dostępu odrzucony');
select pg_temp.expect_error(
  'select * from public.submit_content_report(null, gen_random_uuid(), ''ABCDEFGHIJKLMNOPQRSTUVWX'', ''job'', '''
  || :'DSAJA' || ''', ''fraud'', ''Opis zgłoszenia dłuższy niż dwadzieścia'', null, null, ''bez-malpy'', ''pl'', true)',
  'VALIDATION_FAILED', 'DSA41-5h zły e-mail odrzucony');
reset role;

-- DSA41-6: zalogowany zgłaszający — język wg Invariantu #1 (profil pl, formularz en).
set role service_role;
select report_id as dsa2, case_number as dsacase2
  from public.submit_content_report(:'CANDA', :'DSAK2', :'DSACODE2', 'company', :'DSAJA', 'discrimination',
    'Firma odrzuca kandydatów ze względu na pochodzenie.', null, 'Anna K', 'canda@test.be', 'en', true) \gset
reset role;
select pg_temp.assert(
  (select reporter_id = :'CANDA'::uuid and reporter_locale = 'pl' from public.reports where id = :'dsa2')
  and (select locale from public.email_deliveries where entity_id = :'dsa2') = 'pl',
  'DSA41-6 zalogowany: reporter_id z serwera, język e-maila = język odbiorcy (pl), nie formularza');

-- DSA41-7: zgłaszający widzi tylko swoje sprawy; autor treści nie widzi zgłoszeń ani zgłaszającego.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.reports where kind = 'dsa_notice') = 1
  and (select id from public.reports where kind = 'dsa_notice') = :'dsa2'::uuid,
  'DSA41-7 zgłaszający widzi tylko własną sprawę');
select pg_temp.assert((select count(*) from public.report_events where report_id = :'dsa2') = 1
  and (select count(*) from public.report_events where report_id = :'dsa1') = 0,
  'DSA41-7b historia tylko własnych spraw');
select pg_temp.expect_error('select actor_id from public.report_events',
  'permission denied', 'DSA41-7c bez odczytu tożsamości moderatora (actor_id)');
select pg_temp.expect_error(
  'update public.reports set details = ''zmiana'' where id = ''' || :'dsa2' || '''',
  'permission denied', 'DSA41-7d zgłaszający nie edytuje sprawy');
select pg_temp.expect_error('delete from public.reports where id = ''' || :'dsa2' || '''',
  'permission denied', 'DSA41-7e zgłaszający nie usuwa sprawy');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CANDB'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.reports where kind = 'dsa_notice') = 0
  and (select count(*) from public.report_events
         where report_id in (:'dsa1'::uuid, :'dsa2'::uuid, :'dsar_a'::uuid)) = 0,
  'DSA41-7f inny użytkownik nie widzi cudzych spraw');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.reports where target_id in (:'DSAJA'::uuid, :'COMPA'::uuid, :'DSAJB'::uuid, :'COMPB'::uuid)) = 0,
  'DSA41-7g autor treści (firma A) nie widzi zgłoszeń ani danych zgłaszającego');
reset role; reset app.current_uid;
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error('select count(*) from public.reports', 'permission denied',
  'DSA41-7h anon bez odczytu spraw');
select pg_temp.expect_error('select count(*) from public.report_events', 'permission denied',
  'DSA41-7i anon bez odczytu historii');
reset role;

-- DSA41-8: zapis zgłoszenia i historia niezmienne dla każdej roli (także service_role/właściciela).
select pg_temp.expect_error(
  'update public.reports set details = ''podmiana'' where id = ''' || :'dsa1' || '''',
  'niezmienna', 'DSA41-8 właściciel tabel nie zmieni treści zgłoszenia');
select pg_temp.expect_error(
  'update public.reports set target_snapshot = ''{}'' where id = ''' || :'dsa1' || '''',
  'niezmienna', 'DSA41-8b dowód niezmienny');
select pg_temp.expect_error(
  'update public.reports set reporter_email = ''inny@test.be'' where id = ''' || :'dsa1' || '''',
  'niezmienna', 'DSA41-8c kontakt zgłaszającego niezmienny');
select pg_temp.expect_error(
  'update public.reports set kind = ''quality'' where id = ''' || :'dsa1' || '''',
  'niezmienna', 'DSA41-8d rodzaj sprawy niezmienny');
select pg_temp.expect_error(
  'update public.reports set reporter_id = ''' || :'CANDB' || ''' where id = ''' || :'dsa2' || '''',
  'niezmienna', 'DSA41-8e zgłaszający nie do podmiany');
select pg_temp.expect_error('delete from public.reports where id = ''' || :'dsa1' || '''',
  'nie można usunąć', 'DSA41-8f sprawy nie można usunąć');
select pg_temp.expect_error('update public.report_events set to_status = ''resolved'' where report_id = ''' || :'dsa1' || '''',
  'tylko do dopisywania', 'DSA41-8g historia bez edycji');
select pg_temp.expect_error('delete from public.report_events where report_id = ''' || :'dsa1' || '''',
  'tylko do dopisywania', 'DSA41-8h historia bez usuwania');
set role service_role;
select pg_temp.expect_error(
  'update public.reports set case_number = ''DSA-0000-0000-0000-0000'' where id = ''' || :'dsa1' || '''',
  'niezmienna', 'DSA41-8i service_role nie zmieni numeru sprawy');
reset role;
select pg_temp.expect_error(
  'insert into public.reports(target_type, target_id, reason, kind) values (''job'', ''' || :'DSAJA' || ''', ''fraud'', ''dsa_notice'')',
  'reports_dsa_notice_complete', 'DSA41-8j niekompletna sprawa DSA odrzucona także poza RPC');
-- Kontrola ujemna: zwykłe zgłoszenie jakościowe (poza DSA) nadal edytowalne przez właściciela.
insert into public.reports(id, target_type, target_id, reason) values
  ('e9500000-0000-0000-0000-0000000000e1', 'job', :'DSAJA', 'spam');
update public.reports set details = 'uzupełnienie' where id = 'e9500000-0000-0000-0000-0000000000e1';
select pg_temp.assert((select details from public.reports where id = 'e9500000-0000-0000-0000-0000000000e1') = 'uzupełnienie',
  'DSA41-8k kontrola ujemna: strażnik obejmuje tylko sprawy DSA');

-- DSA41-9: zmiana/usunięcie oferty nie usuwa dowodu.
update public.jobs set title = 'Zmieniony tytuł' where id = :'DSAJA';
select pg_temp.assert(
  (select target_snapshot #>> '{job,title}' from public.reports where id = :'dsa1') = 'Magazynier A',
  'DSA41-9 zmiana oferty nie zmienia dowodu');
update public.jobs set title = 'Magazynier A' where id = :'DSAJA';

-- DSA41-10: status przez istniejący panel admina → historia z aktorem; sprawdzenie sprawy.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_resolve_report(:'dsa1', 'reviewing', 'open');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.report_events
     where report_id = :'dsa1' and event_type = 'status_changed'
       and from_status = 'open' and to_status = 'reviewing' and actor_id = :'ADMIN'::uuid) = 1,
  'DSA41-10 zmiana statusu zapisana w historii z aktorem');
set role service_role;
select public.get_report_case(:'dsacase1', :'DSACODE') as dsa_lookup \gset
select public.get_report_case(:'dsacase1', :'DSACODE2') is null as dsa_wrong_code \gset
select public.get_report_case('DSA-0000-0000-0000-0000', :'DSACODE') is null as dsa_wrong_case \gset
select public.get_report_case(lower(:'dsacase1'), :'DSACODE') is not null as dsa_lower_case \gset
reset role;
select pg_temp.assert((:'dsa_lookup'::jsonb)->>'status' = 'reviewing'
  and jsonb_array_length((:'dsa_lookup'::jsonb)->'events') = 2,
  'DSA41-10b zgłaszający sprawdza status i historię po numerze i kodzie');
select pg_temp.assert(not ((:'dsa_lookup'::jsonb) ? 'details') and not ((:'dsa_lookup'::jsonb) ? 'reporterEmail')
  and position('gosc@test.be' in :'dsa_lookup') = 0 and position(:'ADMIN' in :'dsa_lookup') = 0,
  'DSA41-10c wynik bez treści zgłoszenia, kontaktu i tożsamości moderatora');
select pg_temp.assert(:'dsa_wrong_code'::boolean and :'dsa_wrong_case'::boolean and :'dsa_lower_case'::boolean,
  'DSA41-10d zły kod i obcy numer → brak wyniku (ta sama odpowiedź)');

-- DSA41-11: awaria poczty nie zmienia sprawy (outbox ponawia niezależnie).
update public.email_deliveries set status = 'failed', attempts = 5, error_message = 'provider down'
  where entity_id = :'dsa1';
select pg_temp.assert(
  (select status::text from public.reports where id = :'dsa1') = 'reviewing'
  and (select count(*) from public.report_events where report_id = :'dsa1') = 2,
  'DSA41-11 nieudana wysyłka nie cofa ani nie zmienia sprawy');

-- DSA41-12: limit w bazie — jedna otwarta sprawa na adres i treść; 5 spraw na adres / 24 h.
set role service_role;
select pg_temp.expect_error(
  'select * from public.submit_content_report(null, gen_random_uuid(), ''ABCDEFGHIJKLMNOPQRSTUVWX'', ''job'', '''
  || :'DSAJA' || ''', ''other'', ''Kolejne zgłoszenie tej samej oferty.'', null, null, ''gosc@test.be'', ''pl'', true)',
  'RATE_LIMITED', 'DSA41-12 druga otwarta sprawa tego samego adresu dla tej samej treści');
reset role;
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale)
select ('e9500000-0000-0000-0000-00000000010' || g)::uuid, :'COMPA', 'dsa-lim-' || g, 'Limit ' || g,
       'warehouse', 'permanent', 'Antwerpia', 'Flandria', 'active', 'pl'
  from generate_series(1, 6) g;
set role service_role;
select count(*) as dsa_lim_ok from generate_series(1, 5) g,
  lateral public.submit_content_report(null, gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX', 'job',
    ('e9500000-0000-0000-0000-00000000010' || g)::uuid, 'other', 'Zgłoszenie w ramach testu limitu.',
    null, null, 'limit@test.be', 'en', true) \gset
select pg_temp.expect_error(
  'select * from public.submit_content_report(null, gen_random_uuid(), ''ABCDEFGHIJKLMNOPQRSTUVWX'', ''job'', '
  || '''e9500000-0000-0000-0000-000000000106'', ''other'', ''Szóste zgłoszenie w ciągu doby.'', null, null, ''LIMIT@test.be'', ''en'', true)',
  'RATE_LIMITED', 'DSA41-12b szósta sprawa adresu w 24 h odrzucona (bez względu na wielkość liter)');
select report_id is not null as dsa_other_email from public.submit_content_report(null, gen_random_uuid(),
  'ABCDEFGHIJKLMNOPQRSTUVWX', 'job', 'e9500000-0000-0000-0000-000000000106', 'other',
  'Inny zgłaszający tej samej oferty.', null, null, 'inny@test.be', 'nl', true) \gset
reset role;
select pg_temp.assert(:dsa_lim_ok = 5, 'DSA41-12c pięć spraw w limicie');
select pg_temp.assert(:'dsa_other_email'::boolean, 'DSA41-12d kontrola ujemna: limit jest per adres');

-- ============================================================================
-- GA98. Jednorazowa aplikacja bez konta (0095, #98): zgłoszenie → potwierdzenie
-- e-mailem → aplikacja widoczna dla firmy → przejęcie przez konto o tym samym adresie.
-- Kontrole ujemne: bezpośredni DML/odczyt, niepotwierdzony adres nie trafia do firmy,
-- cudza firma/sesja nie widzi ani nie przejmie, duplikat, wygasłe tokeny, retencja.
-- ============================================================================
\set GAO 'e9800000-0000-0000-0000-0000000000a1'
\set GAB 'e9800000-0000-0000-0000-0000000000a2'
\set GAR 'e9800000-0000-0000-0000-0000000000a3'
\set GAX 'e9800000-0000-0000-0000-0000000000a4'
\set GAC 'e9800000-0000-0000-0000-0000000000c1'
\set GACB 'e9800000-0000-0000-0000-0000000000c2'
\set GAJ 'e9800000-0000-0000-0000-0000000000d1'
\set GAJ2 'e9800000-0000-0000-0000-0000000000d2'
\set GAJ3 'e9800000-0000-0000-0000-0000000000d3'
\set GAPV 'e9800000-0000-0000-0000-0000000000f1'

reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'GAO','gao@test.be','Olaf O','{"role":"employer","first_name":"Olaf","last_name":"Owner","locale":"fr"}'),
  (:'GAB','gab@test.be','Bram B','{"role":"employer","first_name":"Bram","last_name":"B","locale":"nl"}'),
  -- GAR: konto kandydata na adres gościa, na razie NIEZWERYFIKOWANE (GA98-10).
  (:'GAR','ga-guest@test.be','Gosia G','{"role":"candidate","first_name":"Gosia","last_name":"G","locale":"pl"}'),
  (:'GAX','gax@test.be','Xavier X','{"role":"candidate","first_name":"Xavier","last_name":"X","locale":"en"}');
update auth.users set email_verified = true where id in (:'GAO', :'GAB', :'GAX');
insert into public.companies(id,name,status) values
  (:'GAC','Firma GA','verified'), (:'GACB','Firma GA B','verified');
insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'GAC',:'GAO','owner',true), (:'GACB',:'GAB','owner',true);
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'GAJ',:'GAC','ga-job','Magazynier GA','warehouse','permanent','Gent','Flandria','active','pl'),
  (:'GAJ2',:'GAC','ga-job-2','Kierowca GA','transport','permanent','Gent','Flandria','active','pl'),
  (:'GAJ3',:'GAC','ga-job-3','Sprzątanie GA','cleaning','permanent','Gent','Flandria','active','pl');
insert into public.consent_versions(id, document, version, locale, is_current, published_at)
  values (:'GAPV', 'privacy', 'ga-1', 'nl', true, now());

-- GA98-1: klient nie woła RPC gościa i nie czyta zgłoszeń.
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.submit_guest_application(''' || :'GAJ' || ''', ''a@b.be'', ''A'', null, null, null, ''pl'', ''idem-ga-anon'', repeat(''n'',32), repeat(''a'',64))',
  'permission denied', 'GA98-1 anon bez EXECUTE submit_guest_application');
select pg_temp.expect_error('select public.confirm_guest_application(repeat(''a'',64), repeat(''n'',32), repeat(''b'',64))',
  'permission denied', 'GA98-1b anon bez EXECUTE confirm_guest_application');
select pg_temp.expect_error('select count(*) from public.guest_application_requests',
  'permission denied', 'GA98-1c anon nie czyta zgłoszeń gościa');
reset role;
set role authenticated; set app.current_uid = :'GAX'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select count(*) from public.guest_application_requests',
  'permission denied', 'GA98-1d zalogowany nie czyta zgłoszeń gościa');
select pg_temp.expect_error('select public.purge_guest_application_requests()',
  'permission denied', 'GA98-1e klient nie woła retencji');
reset role; reset app.current_uid;

-- GA98-2: zgłoszenie (service_role) — pending, e-mail do gościa w jego języku, snapshot zgody.
set role service_role;
select public.submit_guest_application(:'GAJ', ' GA-Guest@test.be ', 'Gosia Gość', '+32470123456',
  'immediate', 'Mogę od zaraz', 'nl', 'idem-ga-0001', 'nonce-ga-0001-aaaaaaaa',
  encode(sha256('tok-ga-1'::bytea), 'hex'), '203.0.113.7', 'UA test') as gareq \gset
select public.submit_guest_application(:'GAJ', 'ga-guest@test.be', 'Gosia Gość', '+32470123456',
  'immediate', 'Mogę od zaraz', 'nl', 'idem-ga-0001', 'nonce-ga-0001-aaaaaaaa',
  encode(sha256('tok-ga-1'::bytea), 'hex')) as gareq2 \gset
reset role;
select pg_temp.assert(:'gareq' = :'gareq2', 'GA98-2 ponowienie tym samym kluczem → to samo zgłoszenie');
select pg_temp.assert(
  (select status = 'pending' and email = 'ga-guest@test.be' and consent_version_id = :'GAPV'
          and consent_document_version = 'ga-1' and consent_ip = '203.0.113.7'::inet
          and consent_accepted_at is not null and confirm_expires_at > now() + interval '47 hours'
     from public.guest_application_requests where id = :'gareq'),
  'GA98-2b pending ze snapshotem zgody (wersja polityki, IP, czas)');
select pg_temp.assert(
  (select count(*) from public.email_deliveries
     where template = 'guestApplicationConfirm' and entity_id = :'gareq') = 1
  and (select locale = 'nl' and profile_id is null and to_email = 'ga-guest@test.be'
              and payload ? 'nonce' and payload::text not like '%' || encode(sha256('tok-ga-1'::bytea), 'hex') || '%'
         from public.email_deliveries where template = 'guestApplicationConfirm' and entity_id = :'gareq'),
  'GA98-2c jeden e-mail potwierdzenia w języku gościa (nl), bez tokenu ani hasha w bazie');
-- Nowe wysłanie (inny klucz) na ten sam adres i ofertę zastępuje oczekujące zgłoszenie.
set role service_role;
select public.submit_guest_application(:'GAJ', 'ga-guest@test.be', 'Gosia Gość', '+32470123456',
  'immediate', 'Mogę od zaraz', 'nl', 'idem-ga-0002', 'nonce-ga-0002-aaaaaaaa',
  encode(sha256('tok-ga-2'::bytea), 'hex')) as gareq3 \gset
select pg_temp.expect_error(
  'select public.submit_guest_application(''' || :'GAJ2' || ''', ''ga-guest@test.be'', ''G'', null, null, null, ''nl'', ''idem-ga-0002'', repeat(''n'',32), repeat(''c'',64))',
  'VALIDATION_FAILED', 'GA98-2d klucz idempotencji z innego zgłoszenia → odrzucony');
select pg_temp.expect_error(
  'select public.submit_guest_application(''' || :'GAJ' || ''', ''zly-adres'', ''G'', null, null, null, ''nl'', ''idem-ga-bad1'', repeat(''n'',32), repeat(''c'',64))',
  'VALIDATION_FAILED', 'GA98-2e niepoprawny e-mail → VALIDATION_FAILED');
reset role;
select pg_temp.assert(:'gareq3' = :'gareq'
  and (select count(*) from public.guest_application_requests where job_id = :'GAJ') = 1
  and (select count(*) from public.email_deliveries where template = 'guestApplicationConfirm' and entity_id = :'gareq') = 2,
  'GA98-2f jedno oczekujące zgłoszenie na (oferta, e-mail); nowy link wysłany');

-- GA98-3: niepotwierdzony adres NIE trafia do firmy.
select pg_temp.assert(
  not exists (select 1 from public.applications where job_id = :'GAJ')
  and not exists (select 1 from public.notifications where profile_id = :'GAO')
  and not exists (select 1 from public.email_deliveries where profile_id = :'GAO' and template = 'newApplication'),
  'GA98-3 przed potwierdzeniem: brak aplikacji, powiadomienia i e-maila do firmy');
set role authenticated; set app.current_uid = :'GAO'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.applications where job_id = :'GAJ') = 0,
  'GA98-3b firma nie widzi niepotwierdzonego zgłoszenia');
reset role; reset app.current_uid;

-- GA98-4: potwierdzenie — stary token nieważny, nowy tworzy aplikację gościa.
set role service_role;
select pg_temp.assert(
  (select outcome from public.confirm_guest_application(encode(sha256('tok-ga-1'::bytea), 'hex'),
     'nonce-claim-ga-00001', encode(sha256('claim-ga-x'::bytea), 'hex'))) = 'invalid',
  'GA98-4 zastąpiony token → invalid');
select pg_temp.assert(
  (select outcome = 'confirmed' and locale = 'nl' and job_slug = 'ga-job'
     from public.confirm_guest_application(encode(sha256('tok-ga-2'::bytea), 'hex'),
       'nonce-claim-ga-00001', encode(sha256('claim-ga-1'::bytea), 'hex'))),
  'GA98-4b poprawny token → confirmed');
select pg_temp.assert(
  (select outcome from public.confirm_guest_application(encode(sha256('tok-ga-2'::bytea), 'hex'),
     'nonce-claim-ga-00002', encode(sha256('claim-ga-2'::bytea), 'hex'))) = 'already_confirmed',
  'GA98-4c ponowne kliknięcie → already_confirmed');
reset role;
select id as gaapp from public.applications where job_id = :'GAJ' \gset
select pg_temp.assert(
  (select count(*) from public.applications where job_id = :'GAJ') = 1
  and (select candidate_id is null and guest_email = 'ga-guest@test.be' and guest_name = 'Gosia Gość'
              and phone = '+32470123456' and status = 'submitted' and company_id = :'GAC'
              and guest_request_id = :'gareq'
         from public.applications where id = :'gaapp')
  and (select phone is null and message is null and status = 'confirmed' and application_id = :'gaapp'
              and claim_token_hash = encode(sha256('claim-ga-1'::bytea), 'hex')
         from public.guest_application_requests where id = :'gareq'),
  'GA98-4d jedna aplikacja gościa ze snapshotem; zgłoszenie bez telefonu/wiadomości');
select pg_temp.assert(
  (select count(*) from public.notifications where profile_id = :'GAO' and entity_id = :'gaapp') = 1
  and (select locale from public.email_deliveries where profile_id = :'GAO' and template = 'newApplication'
         and entity_id = :'gaapp') = 'fr'
  and (select count(*) from public.email_deliveries where template = 'guestApplicationSent' and entity_id = :'gareq') = 1
  and (select locale from public.email_deliveries where template = 'guestApplicationSent' and entity_id = :'gareq') = 'nl',
  'GA98-4e firma: powiadomienie + newApplication (fr, odbiorca); gość: guestApplicationSent (nl)');

-- GA98-5: firma widzi jak zwykłą aplikację; cudza firma i obcy kandydat nie widzą.
set role authenticated; set app.current_uid = :'GAO'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select guest_name from public.applications where id = :'gaapp') = 'Gosia Gość',
  'GA98-5 firma widzi aplikację gościa z oznaczeniem (guest_name)');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'GAB'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.applications where id = :'gaapp') = 0,
  'GA98-5b cudza firma nie widzi aplikacji gościa');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'GAX'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.applications where id = :'gaapp') = 0,
  'GA98-5c obcy kandydat nie widzi aplikacji gościa');

-- GA98-7: bezpośredni DML odrzucony (aplikacje i zgłoszenia).
select pg_temp.expect_error(
  'insert into public.applications(job_id, guest_name, guest_email) values (''' || :'GAJ3' || ''', ''X'', ''x@y.be'')',
  'permission denied', 'GA98-7 bezpośredni INSERT aplikacji gościa odrzucony');
select pg_temp.expect_error(
  'update public.applications set candidate_id = auth.uid() where id = ''' || :'gaapp' || '''',
  'permission denied', 'GA98-7b bezpośrednie przejęcie (UPDATE) odrzucone');
select pg_temp.expect_error(
  'insert into public.guest_application_requests(job_id) values (''' || :'GAJ3' || ''')',
  'permission denied', 'GA98-7c bezpośredni INSERT zgłoszenia odrzucony');
reset role; reset app.current_uid;
-- Trigger integralności (defense-in-depth): zmiana kandydata poza claim_guest_application.
set app.current_uid = :'GAX';
select pg_temp.expect_error(
  'update public.applications set candidate_id = ''' || :'GAX' || ''' where id = ''' || :'gaapp' || '''',
  'PERMISSION_DENIED', 'GA98-7d trigger blokuje zmianę kandydata bez przejęcia');
select pg_temp.expect_error(
  'update public.applications set guest_email = ''inny@test.be'' where id = ''' || :'gaapp' || '''',
  'PERMISSION_DENIED', 'GA98-7e snapshot gościa niezmienny');
reset app.current_uid;

-- GA98-8: zmiana statusu przez firmę — historia jest, brak powiadomienia bez odbiorcy.
set role authenticated; set app.current_uid = :'GAO'; select pg_temp.assert_client_role();
select public.transition_application(:'gaapp', 'viewed');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.applications where id = :'gaapp') = 'viewed'
  and (select count(*) from public.application_status_history where application_id = :'gaapp' and to_status = 'viewed') = 1
  and not exists (select 1 from public.email_deliveries where entity_id = :'gaapp'
                    and template in ('applicationViewed', 'statusChanged')),
  'GA98-8 status gościa zmieniony, historia zapisana, bez e-maila do kandydata');

-- GA98-9: rozmowa wymaga konta kandydata.
set role authenticated; set app.current_uid = :'GAO'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.get_or_create_conversation(''' || :'gaapp' || ''', null)',
  'GUEST_APPLICATION', 'GA98-9 rozmowa z aplikacji gościa → kontrolowany błąd');
reset role; reset app.current_uid;

-- GA98-6: duplikat (ten sam adres, ta sama oferta) i wygasły link.
set role service_role;
select public.submit_guest_application(:'GAJ', 'ga-guest@test.be', 'Gosia', null, null, null, 'pl',
  'idem-ga-0003', 'nonce-ga-0003-aaaaaaaa', encode(sha256('tok-ga-3'::bytea), 'hex')) as gadup \gset
select pg_temp.assert(
  (select outcome from public.confirm_guest_application(encode(sha256('tok-ga-3'::bytea), 'hex'),
     'nonce-claim-ga-00003', encode(sha256('claim-ga-3'::bytea), 'hex'))) = 'duplicate',
  'GA98-6 drugi raz na tę samą ofertę → duplicate');
select public.submit_guest_application(:'GAJ2', 'late@test.be', 'Late L', null, null, null, 'fr',
  'idem-ga-0004', 'nonce-ga-0004-aaaaaaaa', encode(sha256('tok-ga-4'::bytea), 'hex')) as galate \gset
reset role;
update public.guest_application_requests set confirm_expires_at = now() - interval '1 minute' where id = :'galate';
set role service_role;
select pg_temp.assert(
  (select outcome from public.confirm_guest_application(encode(sha256('tok-ga-4'::bytea), 'hex'),
     'nonce-claim-ga-00004', encode(sha256('claim-ga-4'::bytea), 'hex'))) = 'expired',
  'GA98-6b wygasły link → expired');
reset role;
select pg_temp.assert(
  (select count(*) from public.applications where job_id = :'GAJ') = 1
  and not exists (select 1 from public.applications where job_id = :'GAJ2'),
  'GA98-6c duplikat i wygasły link nie tworzą aplikacji');
-- Adres, który aplikował z konta (GAX), jako gość na tę samą ofertę → duplicate.
set role authenticated; set app.current_uid = :'GAX'; select pg_temp.assert_client_role();
select public.apply_to_job(:'GAJ3', 'idem-ga-gax-3');
reset role; reset app.current_uid;
set role service_role;
select public.submit_guest_application(:'GAJ3', 'gax@test.be', 'Xavier', null, null, null, 'en',
  'idem-ga-0005', 'nonce-ga-0005-aaaaaaaa', encode(sha256('tok-ga-5'::bytea), 'hex')) as gaacct \gset
select pg_temp.assert(
  (select outcome from public.confirm_guest_application(encode(sha256('tok-ga-5'::bytea), 'hex'),
     'nonce-claim-ga-00005', encode(sha256('claim-ga-5'::bytea), 'hex'))) = 'duplicate',
  'GA98-6d adres z kontem, które już aplikowało → duplicate');
reset role;
select pg_temp.assert(
  (select count(*) from public.applications where job_id = :'GAJ3') = 1
  and (select guest_email is null and candidate_id = :'GAX' from public.applications where job_id = :'GAJ3'),
  'GA98-6e zwykła aplikacja z konta bez pól gościa (ścieżka zalogowanego bez regresji)');

-- GA98-10: przejęcie — obca sesja, niezweryfikowany adres, właściciel adresu, ponowienie.
set role authenticated; set app.current_uid = :'GAX'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.claim_guest_application(''' || encode(sha256('claim-ga-1'::bytea), 'hex') || ''')',
  'NOT_FOUND', 'GA98-10 obca sesja (inny adres) nie przejmie aplikacji');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'GAR'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.claim_guest_application(''' || encode(sha256('claim-ga-1'::bytea), 'hex') || ''')',
  'EMAIL_NOT_VERIFIED', 'GA98-10b niezweryfikowany adres nie przejmie aplikacji');
select pg_temp.expect_error(
  'select public.claim_guest_application(''' || encode(sha256('tok-ga-2'::bytea), 'hex') || ''')',
  'EMAIL_NOT_VERIFIED', 'GA98-10c token potwierdzenia nie jest tokenem przejęcia (najpierw weryfikacja)');
reset role; reset app.current_uid;
update auth.users set email_verified = true where id = :'GAR';
set role authenticated; set app.current_uid = :'GAR'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.claim_guest_application(''' || encode(sha256('tok-ga-2'::bytea), 'hex') || ''')',
  'NOT_FOUND', 'GA98-10d token potwierdzenia nie przejmuje aplikacji');
select public.claim_guest_application(encode(sha256('claim-ga-1'::bytea), 'hex')) as gaclaim \gset
select public.claim_guest_application(encode(sha256('claim-ga-1'::bytea), 'hex')) as gaclaim2 \gset
select pg_temp.assert(:'gaclaim' = :'gaapp' and :'gaclaim2' = :'gaapp',
  'GA98-10e właściciel adresu przejmuje; ponowienie zwraca tę samą aplikację');
select pg_temp.assert(
  (select count(*) from public.applications where candidate_id = :'GAR') = 1
  and (select status::text from public.applications where id = :'gaapp') = 'viewed',
  'GA98-10f kandydat widzi przejętą aplikację ze statusem');
select pg_temp.assert(
  (select count(*) from public.application_status_history where application_id = :'gaapp') >= 1,
  'GA98-10g historia statusów zachowana i widoczna dla kandydata');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select candidate_id = :'GAR' and claimed_at is not null and guest_email = 'ga-guest@test.be'
     from public.applications where id = :'gaapp')
  and not exists (select 1 from public.candidate_profiles where profile_id = :'GAR' and is_searchable)
  and exists (select 1 from public.audit_logs where action = 'application.guest_claimed' and entity_id = :'gaapp'),
  'GA98-10h przypisanie z audytem; profil nie publikowany automatycznie');
set role authenticated; set app.current_uid = :'GAX'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.claim_guest_application(''' || encode(sha256('claim-ga-1'::bytea), 'hex') || ''')',
  'NOT_FOUND', 'GA98-10i token już użyty — inne konto nie przejmie');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'GAO'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.applications where id = :'gaapp') = 1,
  'GA98-10j firma nadal widzi aplikację po przejęciu');
select pg_temp.expect_error(
  'select public.claim_guest_application(''' || encode(sha256('claim-ga-1'::bytea), 'hex') || ''')',
  'PERMISSION_DENIED', 'GA98-10k konto pracodawcy nie przejmuje aplikacji');
reset role; reset app.current_uid;

-- GA98-11: wygasły token przejęcia.
set role service_role;
select public.submit_guest_application(:'GAJ2', 'gax@test.be', 'Xavier', null, null, null, 'en',
  'idem-ga-0006', 'nonce-ga-0006-aaaaaaaa', encode(sha256('tok-ga-6'::bytea), 'hex')) as gaexp \gset
select pg_temp.assert(
  (select outcome from public.confirm_guest_application(encode(sha256('tok-ga-6'::bytea), 'hex'),
     'nonce-claim-ga-00006', encode(sha256('claim-ga-6'::bytea), 'hex'))) = 'confirmed',
  'GA98-11 potwierdzenie drugiego zgłoszenia');
reset role;
update public.guest_application_requests set claim_expires_at = now() - interval '1 minute' where id = :'gaexp';
set role authenticated; set app.current_uid = :'GAX'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.claim_guest_application(''' || encode(sha256('claim-ga-6'::bytea), 'hex') || ''')',
  'CLAIM_EXPIRED', 'GA98-11b wygasły token przejęcia');
reset role; reset app.current_uid;

-- GA98-12: retencja — niepotwierdzone 7 dni po ostatnim linku i duplikaty 7 dni po
-- potwierdzeniu usunięte razem z e-mailami; potwierdzone zostają, wygasły token przejęcia
-- jest zerowany. Kontrola ujemna: stare created_at z ŚWIEŻYM linkiem (ponowne wysłanie)
-- nie jest usuwane.
set role service_role;
select public.submit_guest_application(:'GAJ3', 'fresh@test.be', 'Fresh F', null, null, null, 'pl',
  'idem-ga-0007', 'nonce-ga-0007-aaaaaaaa', encode(sha256('tok-ga-7'::bytea), 'hex')) as gafresh \gset
reset role;
update public.guest_application_requests
   set confirm_expires_at = now() - interval '6 days', created_at = now() - interval '8 days'
 where id = :'galate';
update public.guest_application_requests
   set confirmed_at = now() - interval '8 days', created_at = now() - interval '8 days'
 where id = :'gadup';
update public.guest_application_requests set created_at = now() - interval '30 days' where id = :'gafresh';
set role service_role;
select public.purge_guest_application_requests() as gapurged \gset
reset role;
select pg_temp.assert(:'gapurged'::int = 2
  and not exists (select 1 from public.guest_application_requests where id in (:'galate', :'gadup'))
  and not exists (select 1 from public.email_deliveries
                    where entity_type = 'guest_application_request' and entity_id in (:'galate', :'gadup'))
  and exists (select 1 from public.guest_application_requests where id = :'gareq')
  and exists (select 1 from public.guest_application_requests where id = :'gaacct')
  and exists (select 1 from public.guest_application_requests where id = :'gafresh')
  and (select claim_token_hash is null from public.guest_application_requests where id = :'gaexp')
  and (select claim_token_hash is not null from public.guest_application_requests where id = :'gareq'),
  'GA98-12 retencja: stare niepotwierdzone usunięte z e-mailami, świeże i potwierdzone zostają');

-- GA98-13: pytania screeningowe (#101) także dla gościa — te same reguły co apply_to_job,
-- odpowiedzi trafiają do application_screening_answers dopiero po potwierdzeniu.
\set GAJ4 'e9800000-0000-0000-0000-0000000000d4'
reset role; reset app.current_uid;
insert into public.jobs(id, company_id, created_by, slug, title, category, contract_type, city, region, status, default_locale) values
  (:'GAJ4', :'GAC', :'GAO', 'draft-ga98-sq', 'Kierowca GA SQ', 'transport', 'permanent', 'Gent', 'Flandria', 'draft', 'pl');
set role authenticated; set app.current_uid = :'GAO'; select pg_temp.assert_client_role();
select public.save_job_draft(:'GAJ4'::uuid, $j${
  "screening_questions": [
    {"type": "yes_no", "required": true, "prompt": {"pl": "Masz prawo jazdy C?"}},
    {"type": "short_text", "required": false, "prompt": {"pl": "Doświadczenie?"}}
  ]
}$j$::jsonb);
reset role; reset app.current_uid;
update public.jobs set status = 'active', published_at = now(), slug = 'ga98-sq' where id = :'GAJ4';
select id as gaq1 from public.job_screening_questions where job_id = :'GAJ4' and position = 0 \gset
select id as gaq2 from public.job_screening_questions where job_id = :'GAJ4' and position = 1 \gset
set role service_role;
select pg_temp.expect_error(
  'select public.submit_guest_application(''' || :'GAJ4' || ''', ''sq@test.be'', ''Sq'', null, null, null, ''pl'', ''idem-ga-sq-1'', ''nonce-ga-sq-1-aaaaaaaa'', ''' || encode(sha256('tok-ga-sq-0'::bytea), 'hex') || ''')',
  'SCREENING_ANSWER_REQUIRED: ' || :'gaq1', 'GA98-13 gość bez odpowiedzi na pytanie wymagane → odrzucony');
select pg_temp.expect_error(
  'select public.submit_guest_application(''' || :'GAJ4' || ''', ''sq@test.be'', ''Sq'', null, null, null, ''pl'', ''idem-ga-sq-2'', ''nonce-ga-sq-2-aaaaaaaa'', ''' || encode(sha256('tok-ga-sq-00'::bytea), 'hex') || ''', null, null, ''{"' || :'gaq1' || '": "tak"}''::jsonb)',
  'VALIDATION_FAILED', 'GA98-13b zły typ odpowiedzi → VALIDATION_FAILED');
select public.submit_guest_application(:'GAJ4', 'sq@test.be', 'Sq Gość', null, null, null, 'pl',
  'idem-ga-sq-3', 'nonce-ga-sq-3-aaaaaaaa', encode(sha256('tok-ga-sq-3'::bytea), 'hex'), null, null,
  jsonb_build_object(:'gaq1', true, :'gaq2', '  3 lata  ')) as gasq \gset
reset role;
select pg_temp.assert(
  (select screening_answers ? :'gaq1' from public.guest_application_requests where id = :'gasq')
  and not exists (select 1 from public.guest_application_requests where job_id = :'GAJ4'
                    and idempotency_key in ('idem-ga-sq-1', 'idem-ga-sq-2'))
  and not exists (select 1 from public.applications where job_id = :'GAJ4'),
  'GA98-13c odpowiedzi zapisane w zgłoszeniu; odrzucone próby nie zostawiły zgłoszeń ani aplikacji');
set role service_role;
select pg_temp.assert(
  (select outcome from public.confirm_guest_application(encode(sha256('tok-ga-sq-3'::bytea), 'hex'),
     'nonce-claim-ga-sq-01', encode(sha256('claim-ga-sq'::bytea), 'hex'))) = 'confirmed',
  'GA98-13d potwierdzenie zgłoszenia z odpowiedziami');
reset role;
select id as gasqapp from public.applications where job_id = :'GAJ4' \gset
select pg_temp.assert(
  (select count(*) from public.application_screening_answers where application_id = :'gasqapp') = 2
  and (select answer_boolean from public.application_screening_answers
         where application_id = :'gasqapp' and position = 0)
  and (select answer_text from public.application_screening_answers
         where application_id = :'gasqapp' and position = 1) = '3 lata'
  and (select screening_answers is null from public.guest_application_requests where id = :'gasq'),
  'GA98-13e odpowiedzi w snapshotcie aplikacji; w zgłoszeniu wyzerowane');
set role authenticated; set app.current_uid = :'GAO'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.application_screening_answers where application_id = :'gasqapp') = 2,
  'GA98-13f firma czyta odpowiedzi gościa pod RLS');
reset role; reset app.current_uid;

-- ============================================================================
-- ESCO93. Taksonomia ESCO v1.2.1 (#93, 0097): słowniki czytelne publicznie, zapis
-- i import wyłącznie service_role; przypięcie manifestu, idempotencja, dane ręczne,
-- fallback etykiet, brak wpływu na profile/oferty/dopasowania, rollback.
-- ============================================================================
\set E93O1 'http://data.europa.eu/esco/occupation/bea705fe-06ac-4147-b8e0-6e8ac1208d8f'
\set E93O2 'http://data.europa.eu/esco/occupation/90f75f67-495d-49fa-ab57-2f320e251d7e'
\set E93S1 'http://data.europa.eu/esco/skill/01fec851-b5f4-419b-940a-3b4c835adfa8'
\set E93S2 'http://data.europa.eu/esco/skill/055ff233-6569-43db-9f95-a4b03dca97da'
\set E93FILES '{"occupations_en.csv":{"sha256":"1111111111111111111111111111111111111111111111111111111111111111","bytes":10}}'
\set E93SAMPLE '{"snapshot":"esco93-sample","escoVersion":"v1.2.1","sample":true,"locales":["pl","nl","fr","en"],"files":' :E93FILES '}'
\set E93REAL '{"snapshot":"esco93-v1.2.1","escoVersion":"v1.2.1","sample":false,"locales":["pl","nl","fr","en"],"files":' :E93FILES '}'
\set E93DIG 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
\set E93OCC '[{"uri":"' :E93O1 '","code":"9333.1","iscoGroup":"9333","active":true,"name":"warehouse worker","labels":{"en":{"preferred":"warehouse worker","alternative":["warehouse operative"]},"pl":{"preferred":"magazynier","alternative":["pracownik magazynu"]}}},{"uri":"' :E93O2 '","code":"5120.1","iscoGroup":"5120","active":true,"name":"cook","labels":{"en":{"preferred":"cook","alternative":[]}}}]'
\set E93SK '[{"uri":"' :E93S1 '","skillType":"skill/competence","reuseLevel":"cross-sector","active":true,"name":"tend packaging machines","labels":{"en":{"preferred":"tend packaging machines","alternative":[]},"fr":{"preferred":"surveiller des machines d''emballage","alternative":[]}}},{"uri":"' :E93S2 '","skillType":"knowledge","reuseLevel":"sector-specific","active":true,"name":"warehouse systems","labels":{"en":{"preferred":"warehouse systems","alternative":[]}}}]'
\set E93REL '[{"occupationUri":"' :E93O1 '","skillUri":"' :E93S1 '","relationType":"essential"},{"occupationUri":"' :E93O1 '","skillUri":"' :E93S2 '","relationType":"optional"},{"occupationUri":"' :E93O2 '","skillUri":"' :E93S2 '","relationType":"optional"}]'

-- Odcisk danych procesowych: import nie może ich zmienić (kryterium odbioru #93).
create function pg_temp.e93_fingerprint() returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(t::text, ',' order by t.id) from public.candidate_profiles t),
    (select string_agg(t::text, ',' order by t.id) from public.candidate_skills t),
    (select string_agg(t::text, ',' order by t.id) from public.jobs t),
    (select string_agg(t::text, ',' order by t.id) from public.job_skills t),
    (select string_agg(t::text, ',' order by t.id) from public.applications t),
    (select string_agg(t::text, ',' order by t.id) from public.matches t)));
$$;
select pg_temp.e93_fingerprint() as e93fp \gset
select count(*) as e93manual from public.occupations where source = 'manual' \gset

-- ESCO93-1: klient bez zapisu i bez RPC importu.
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.esco_begin_snapshot(''{}''::jsonb, ''x'')',
  'permission denied', 'ESCO93-1 anon nie rozpoczyna importu');
select pg_temp.expect_error('insert into public.esco_snapshots (id, esco_version, is_sample, locales, files, manifest_sha256) values (''x-sample'', ''v1.2.1'', true, ''{}'', ''{}'', repeat(''a'', 64))',
  'permission denied', 'ESCO93-1b anon nie pisze metadanych');
reset role;
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.esco_upsert_occupations(''esco93-sample'', ''[]''::jsonb, ''fail'')',
  'permission denied', 'ESCO93-1c zalogowany nie woła upsertu');
select pg_temp.expect_error('insert into public.occupations (slug, name) values (''e93-x'', ''x'')',
  'permission denied', 'ESCO93-1d zalogowany nie dodaje zawodu');
select pg_temp.expect_error('update public.skills set name = name',
  'permission denied', 'ESCO93-1e zalogowany nie zmienia umiejętności');
select pg_temp.expect_error('delete from public.occupation_skills',
  'permission denied', 'ESCO93-1f zalogowany nie usuwa relacji');
select pg_temp.expect_error('insert into public.skill_labels (skill_id, locale, kind, label) select id, ''pl'', ''alternative'', ''x'' from public.skills limit 1',
  'permission denied', 'ESCO93-1g zalogowany nie dodaje etykiety');
reset role; reset app.current_uid;

-- ESCO93-2: manifest — wersja przypięta, języki = supported_locales.
set role service_role;
select pg_temp.expect_error(
  'select public.esco_begin_snapshot(''' || replace(:'E93SAMPLE', 'v1.2.1', 'v1.2.0') || '''::jsonb, ''' || :'E93DIG' || ''')',
  'ESCO_VERSION_NOT_PINNED', 'ESCO93-2 inna wersja ESCO odrzucona');
select pg_temp.expect_error(
  'select public.esco_begin_snapshot(''' || replace(:'E93SAMPLE', '"en"]', '"en","ro"]') || '''::jsonb, ''' || :'E93DIG' || ''')',
  'ESCO_INVALID_MANIFEST', 'ESCO93-2b język spoza portalu odrzucony');

-- ESCO93-3: ręczny wiersz z tym samym URI — bez decyzji odmowa, skip nie dotyka.
insert into public.occupations (slug, name, source, esco_uri) values ('e93-kucharz', 'Kucharz ręczny', 'manual', :'E93O2');
select pg_temp.assert(public.esco_begin_snapshot(:'E93SAMPLE'::jsonb, :'E93DIG') = 'new', 'ESCO93-3 fragment rozpoczęty');
select pg_temp.expect_error(
  'select public.esco_upsert_occupations(''esco93-sample'', ''' || replace(:'E93OCC', '''', '''''') || '''::jsonb, ''fail'')',
  'ESCO_MANUAL_CONFLICT', 'ESCO93-3b konflikt z danymi ręcznymi bez decyzji = błąd');
select pg_temp.assert(
  (public.esco_upsert_occupations('esco93-sample', :'E93OCC'::jsonb, 'skip')->>'manualSkipped')::int = 1,
  'ESCO93-3c skip pomija wiersz ręczny');
select pg_temp.assert(
  (select name = 'Kucharz ręczny' and source = 'manual' and not exists (
     select 1 from public.occupation_labels l where l.occupation_id = o.id)
   from public.occupations o where esco_uri = :'E93O2'),
  'ESCO93-3d wiersz ręczny i jego etykiety nietknięte');
select (public.esco_upsert_skills('esco93-sample', :'E93SK'::jsonb, 'skip')->>'inserted')::int as e93sk \gset
select pg_temp.assert(:e93sk = 2, 'ESCO93-3e umiejętności dodane');
select pg_temp.assert(
  (public.esco_upsert_relations('esco93-sample', :'E93REL'::jsonb)->>'manualSkipped')::int = 1,
  'ESCO93-3f relacja ręcznego zawodu pominięta');
select pg_temp.assert(public.esco_finish_snapshot('esco93-sample', '{}'::jsonb) is not null, 'ESCO93-3g zakończenie');

-- ESCO93-4: odczyt publiczny, relacje essential/optional, fallback etykiet, is_demo.
reset role;
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select string_agg(os.relation_type || ':' || s.skill_type, ',' order by os.relation_type)
   from public.occupation_skills os
   join public.occupations o on o.id = os.occupation_id
   join public.skills s on s.id = os.skill_id
   where o.esco_uri = :'E93O1') = 'essential:skill/competence,optional:knowledge',
  'ESCO93-4 anon czyta relacje: podstawowa i opcjonalna rozróżnione');
select pg_temp.assert(
  (select public.occupation_label(id, 'pl') = 'magazynier'
      and public.occupation_label(id, 'nl') = 'warehouse worker'
      and public.occupation_label(id, 'xx') = 'warehouse worker'
      and public.occupation_label(id, null) = 'warehouse worker'
   from public.occupations where esco_uri = :'E93O1'),
  'ESCO93-4b fallback: język → en (także dla nieznanego/NULL)');
select pg_temp.assert(
  (select public.skill_label(id, 'fr') = 'surveiller des machines d''emballage'
      and public.skill_label(id, 'pl') = 'tend packaging machines'
   from public.skills where esco_uri = :'E93S1'),
  'ESCO93-4c fallback umiejętności');
select pg_temp.assert(
  (select public.occupation_label(id, 'pl') from public.occupations where esco_uri = :'E93O2') = 'Kucharz ręczny',
  'ESCO93-4d brak etykiet → name');
select pg_temp.assert(
  (select bool_and(is_demo) from public.occupations where source = 'esco')
  and (select count(*) from public.occupation_labels l join public.occupations o on o.id = l.occupation_id
       where o.esco_uri = :'E93O1') = 4,
  'ESCO93-4e fragment oznaczony is_demo, etykiety pref+alt w PL/EN');
select pg_temp.assert((select count(*) from public.esco_snapshots where id = 'esco93-sample') = 1,
  'ESCO93-4f metadane (atrybucja, sumy) czytelne publicznie');
reset role;

-- ESCO93-5: ponowny import tego samego snapshotu — bez duplikatów i bez zmian.
set role service_role;
select count(*) as e93labels from public.occupation_labels \gset
select pg_temp.assert(public.esco_begin_snapshot(:'E93SAMPLE'::jsonb, :'E93DIG') = 'repeat', 'ESCO93-5 ten sam manifest = repeat');
select public.esco_upsert_occupations('esco93-sample', :'E93OCC'::jsonb, 'skip') as e93r \gset
select pg_temp.assert(:'e93r'::jsonb = '{"inserted":0,"updated":0,"manualSkipped":1,"labelsAdded":0,"labelsRemoved":0}'::jsonb,
  'ESCO93-5b powtórka: zero zmian');
select pg_temp.assert(public.esco_upsert_skills('esco93-sample', :'E93SK'::jsonb, 'skip')->>'inserted' = '0'
  and public.esco_upsert_relations('esco93-sample', :'E93REL'::jsonb)->>'inserted' = '0',
  'ESCO93-5c powtórka umiejętności i relacji: zero nowych');
select pg_temp.assert((select count(*) from public.occupation_labels) = :e93labels
  and (select count(*) from public.occupations where esco_uri in (:'E93O1', :'E93O2')) = 2,
  'ESCO93-5d brak duplikatów');

-- ESCO93-6: ta sama wersja z innymi plikami — odmowa; pól przypięcia nie da się zmienić.
select pg_temp.expect_error(
  'select public.esco_begin_snapshot(''' || replace(:'E93SAMPLE', '1111', '2222') || '''::jsonb, ''' || :'E93DIG' || ''')',
  'ESCO_CHECKSUM_MISMATCH', 'ESCO93-6 zmieniony plik przy tym samym snapshocie odrzucony');
select pg_temp.expect_error(
  'update public.esco_snapshots set files = ''{}''::jsonb where id = ''esco93-sample''',
  'ESCO_CHECKSUM_MISMATCH', 'ESCO93-6b przypięcie niezmienne');
select pg_temp.expect_error(
  'insert into public.occupation_labels (occupation_id, locale, kind, label) select id, ''ro'', ''preferred'', ''x'' from public.occupations where esco_uri = ''' || :'E93O1' || '''',
  'foreign key', 'ESCO93-6c etykieta w języku spoza portalu odrzucona');

-- ESCO93-7: realny snapshot po fragmencie — przejmuje wiersze (is_demo=false),
-- koncepcje spoza snapshotu wyłączone, ich relacje usunięte; overwrite przejmuje ręczny.
select pg_temp.assert(public.esco_begin_snapshot(:'E93REAL'::jsonb, :'E93DIG') = 'new', 'ESCO93-7 realny snapshot');
select pg_temp.assert(
  (public.esco_upsert_occupations('esco93-v1.2.1', :'E93OCC'::jsonb, 'overwrite')->>'updated')::int = 2,
  'ESCO93-7b overwrite (jawna decyzja) przejmuje ręczny wiersz');
select public.esco_upsert_skills('esco93-v1.2.1',
  (select jsonb_agg(e) from jsonb_array_elements(:'E93SK'::jsonb) e where e->>'uri' = :'E93S1'), 'fail');
select public.esco_upsert_relations('esco93-v1.2.1',
  (select jsonb_agg(e) from jsonb_array_elements(:'E93REL'::jsonb) e where e->>'skillUri' = :'E93S1'));
select public.esco_finish_snapshot('esco93-v1.2.1', '{}'::jsonb) as e93fin \gset
select pg_temp.assert(:'e93fin'::jsonb = '{"deactivatedOccupations":0,"deactivatedSkills":1,"removedRelations":1}'::jsonb,
  'ESCO93-7c umiejętność spoza snapshotu wyłączona, jej relacje usunięte');
select pg_temp.assert(
  (select not is_active from public.skills where esco_uri = :'E93S2')
  and (select source = 'esco' and name = 'cook' from public.occupations where esco_uri = :'E93O2')
  and not (select bool_or(is_demo) from public.occupations where source = 'esco'),
  'ESCO93-7d stan po realnym imporcie');
select pg_temp.expect_error(
  'select public.esco_begin_snapshot(''' || replace(:'E93REAL', 'esco93-v1.2.1', 'esco93-other') || '''::jsonb, ''' || :'E93DIG' || ''')',
  'ESCO_CHECKSUM_MISMATCH', 'ESCO93-7e drugi realny snapshot tej samej wersji odrzucony');
select pg_temp.expect_error(
  'select public.esco_begin_snapshot(''' || replace(:'E93SAMPLE', 'esco93-sample', 'esco93-late-sample') || '''::jsonb, ''' || :'E93DIG' || ''')',
  'ESCO_SAMPLE_AFTER_REAL', 'ESCO93-7f fragment testowy po realnym imporcie odrzucony');
reset role;

-- ESCO93-8: profile, oferty, aplikacje i dopasowania bez zmian; ręczne słowniki zostają.
select pg_temp.assert(pg_temp.e93_fingerprint() = :'e93fp', 'ESCO93-8 import nie zmienia danych procesowych');
select pg_temp.assert((select count(*) from public.occupations where source = 'manual') = :e93manual,
  'ESCO93-8b ręczne zawody z 0010 nietknięte');

-- ============================================================================
-- SR497. Kontrola treści pytań screeningowych przed publikacją (0103, #497): detektor w bazie
--        (treść + opcje + tłumaczenia), kolejka przeglądu przy zapisie, blokada aktywacji do
--        decyzji admina, decyzja z audytem i powiadomieniem, zmiana treści = nowy przegląd.
-- ============================================================================
\set SRJOB  'f4970000-0000-0000-0000-0000000000a1'
\set SRJOB2 'f4970000-0000-0000-0000-0000000000a2'
reset role; reset app.current_uid;
insert into public.jobs(id, company_id, created_by, slug, title, category, contract_type, city, region, status, default_locale) values
  (:'SRJOB', :'COMPA', :'EMPA', 'draft-sr497', 'Magazynier SR', 'warehouse', 'permanent', 'Gandawa', 'Flandria', 'draft', 'pl'),
  (:'SRJOB2', :'COMPA', :'EMPA', 'draft-sr497-2', 'Kierowca SR', 'transport', 'permanent', 'Gandawa', 'Flandria', 'draft', 'pl');
insert into public.job_translations(job_id, locale, title, description, responsibilities) values
  (:'SRJOB', 'pl', 'Magazynier SR', 'Praca w magazynie w Gandawie.', array['Kompletacja zamówień']),
  (:'SRJOB2', 'pl', 'Kierowca SR', 'Transport międzynarodowy.', array['Dostawy']);
insert into public.job_requirements(job_id, locale, kind, position, content) values
  (:'SRJOB', 'pl', 'mandatory', 0, 'Dyspozycyjność'),
  (:'SRJOB2', 'pl', 'mandatory', 0, 'Prawo jazdy C+E');

-- SR497-1: detektor w bazie — kategorie w 4 językach, opcje i tłumaczenia; typowe pytania bez trafień.
select pg_temp.assert(
  public.screening_question_risk('{"pl": "Czy jesteś w ciąży?"}', '[]') = array['family']
  and public.screening_question_risk('{"nl": "Wat is je geboortedatum?"}', '[]') = array['age']
  and public.screening_question_risk('{"fr": "Quelle est votre religion ?"}', '[]') = array['religion']
  and public.screening_question_risk('{"en": "Do you have a criminal record?"}', '[]') = array['criminal']
  and public.screening_question_risk('{"pl": "Wybierz"}', '[{"id": "o1", "label": {"pl": "Tak", "en": "I am a trade union member"}}]') = array['union']
  and public.screening_question_risk('{"pl": "Czy możesz zacząć od zaraz?", "fr": "Quelle est votre nationalité ?"}', '[]') = array['origin'],
  'SR497-1 detektor: kategorie w PL/NL/FR/EN, także w opcjach i tłumaczeniach');
select pg_temp.assert(
  public.screening_question_risk('{"pl": "Czy masz prawo jazdy kat. C+E?", "en": "Do you have health and safety training?"}', '[]') = '{}'
  and public.screening_question_risk('{"pl": "Ile lat doświadczenia masz?", "nl": "Wanneer kun je beginnen?"}', '[]') = '{}'
  and public.screening_question_risk('{"pl": "Czy masz certyfikat VCA?", "fr": "Parlez-vous néerlandais ?"}', '[]') = '{}'
  and public.screening_question_risk('{"pl": "Czy masz dobrą orientację w terenie?"}', '[]') = '{}'
  and public.screening_question_risk('{"fr": "Avez-vous une formation en santé et sécurité ?"}', '[]') = '{}',
  'SR497-1b kontrola ujemna: pytania o prawo jazdy, doświadczenie, dostępność, języki, VCA bez trafień');

-- SR497-2: zapis kroku z pytaniem neutralnym, pytaniem z ryzykowną opcją (tłumaczenie NL)
-- i pytaniem z ryzykownym tłumaczeniem treści (FR) → dwa przeglądy pending + audyt.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.save_job_draft(:'SRJOB'::uuid, $j${
  "screening_questions": [
    {"type": "yes_no", "required": true, "prompt": {"pl": "Czy masz certyfikat VCA?"}},
    {"type": "single_choice", "prompt": {"pl": "Twoja sytuacja"},
     "options": [{"label": {"pl": "Mogę od zaraz"}}, {"label": {"pl": "Za miesiąc", "nl": "Ik ben zwanger"}}]},
    {"type": "date", "prompt": {"pl": "Od kiedy możesz zacząć?", "fr": "Votre date de naissance ?"}}
  ]
}$j$::jsonb);
select count(*) = 2 as ok from public.screening_question_reviews where job_id = :'SRJOB' and status = 'pending' \gset sr2_
select pg_temp.assert(:'sr2_ok'::boolean, 'SR497-2 członek firmy widzi 2 oczekujące przeglądy swojej oferty');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select risk_categories from public.job_screening_questions where job_id = :'SRJOB' and position = 0) = '{}'
  and (select risk_categories from public.job_screening_questions where job_id = :'SRJOB' and position = 1) = array['family']
  and (select risk_categories from public.job_screening_questions where job_id = :'SRJOB' and position = 2) = array['age']
  and (select requested_by from public.screening_question_reviews where job_id = :'SRJOB' and risk_categories = array['age']) = :'EMPA'::uuid,
  'SR497-2b kategorie liczone przez bazę, zgłaszający zapisany');
select count(*) as sr2audit from public.audit_logs
  where action = 'screening_question.review_requested' and after_data->>'job_id' = :'SRJOB' \gset
select pg_temp.assert(:sr2audit = 2, 'SR497-2c audyt dwóch zgłoszeń do przeglądu');

-- SR497-3: autozapis tej samej treści nie tworzy nowych zgłoszeń ani wpisów audytu.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.save_job_draft(:'SRJOB'::uuid, $j${
  "screening_questions": [
    {"type": "yes_no", "required": true, "prompt": {"pl": "Czy masz certyfikat VCA?"}},
    {"type": "single_choice", "prompt": {"pl": "Twoja sytuacja"},
     "options": [{"label": {"pl": "Mogę od zaraz"}}, {"label": {"pl": "Za miesiąc", "nl": "Ik ben zwanger"}}]},
    {"type": "date", "prompt": {"pl": "Od kiedy możesz zacząć?", "fr": "Votre date de naissance ?"}}
  ]
}$j$::jsonb);
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.screening_question_reviews where job_id = :'SRJOB') = 2
  and (select count(*) from public.audit_logs where action = 'screening_question.review_requested'
         and after_data->>'job_id' = :'SRJOB') = 2,
  'SR497-3 ponowny zapis tej samej treści bez nowych zgłoszeń i wpisów audytu');

-- SR497-4: publikacja zablokowana do decyzji; zgłoszenia zostają po odrzuconej publikacji.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(format('select public.publish_job(%L::uuid, %L)', :'SRJOB', 'sr497'),
  'SCREENING_REVIEW_REQUIRED: 1', 'SR497-4 publikacja z nieprzejrzanym pytaniem odrzucona (pozycja pytania)');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.jobs where id = :'SRJOB') = 'draft'
  and (select count(*) from public.screening_question_reviews where job_id = :'SRJOB' and status = 'pending') = 2,
  'SR497-4b oferta pozostaje szkicem, przeglądy nadal oczekują');

-- SR497-4c (kontrola ujemna): bez strażnika 0103 ta sama publikacja przechodzi (cofnięte).
begin;
alter table public.jobs disable trigger trg_enforce_screening_review;
set local role authenticated; set local app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.publish_job(:'SRJOB'::uuid, 'sr497-bez-strażnika') is not null as ok \gset sr4c_
rollback;
select pg_temp.assert(:'sr4c_ok'::boolean, 'SR497-4c kontrola ujemna: bez strażnika oferta z ryzykownym pytaniem byłaby publiczna');
select pg_temp.assert((select status::text from public.jobs where id = :'SRJOB') = 'draft', 'SR497-4d kontrola ujemna cofnięta');

-- SR497-5 (kontrola ujemna): inna firma nie widzi przeglądów; klient nie zmienia ich ani kategorii.
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select count(*) = 0 as ok from public.screening_question_reviews where job_id = :'SRJOB' \gset sr5_
select pg_temp.assert(:'sr5_ok'::boolean, 'SR497-5 inna firma nie czyta przeglądów');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('update public.screening_question_reviews set status = %L where job_id = %L', 'approved', :'SRJOB'),
  'permission denied', 'SR497-5b firma nie zatwierdza własnego pytania bezpośrednim UPDATE');
select pg_temp.expect_error(
  format('insert into public.screening_question_reviews(job_id, content_fingerprint, risk_categories, question_type, prompt, status) values (%L, %L, %L, %L, %L, %L)',
         :'SRJOB', 'x', '{age}', 'yes_no', '{"pl": "x"}', 'approved'),
  'permission denied', 'SR497-5c firma nie wstawia zatwierdzonego przeglądu');
select pg_temp.expect_error(
  format('update public.job_screening_questions set risk_categories = %L where job_id = %L', '{}', :'SRJOB'),
  'permission denied', 'SR497-5d firma nie zeruje kategorii pytania');
select pg_temp.expect_error(
  format('select public.admin_decide_screening_review(id, %L, null) from public.screening_question_reviews where job_id = %L limit 1', 'approved', :'SRJOB'),
  'PERMISSION_DENIED', 'SR497-5e decyzja wyłącznie dla admina');
reset role; reset app.current_uid;

-- SR497-6: admin odrzuca (uzasadnienie wymagane) → audyt, powiadomienie, publikacja z REJECTED.
select id as sr_fam from public.screening_question_reviews where job_id = :'SRJOB' and risk_categories = array['family'] \gset
select id as sr_age from public.screening_question_reviews where job_id = :'SRJOB' and risk_categories = array['age'] \gset
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(format('select public.admin_decide_screening_review(%L::uuid, %L, %L)', :'sr_fam', 'rejected', '  '),
  'REASON_REQUIRED', 'SR497-6 odrzucenie bez uzasadnienia odrzucone');
select pg_temp.expect_error(format('select public.admin_decide_screening_review(%L::uuid, %L, null)', :'sr_fam', 'maybe'),
  'VALIDATION_FAILED', 'SR497-6b nieznana decyzja odrzucona');
select public.admin_decide_screening_review(:'sr_fam'::uuid, 'rejected', 'Opcja dotyczy ciąży — usuń ją.');
select pg_temp.expect_error(format('select public.admin_decide_screening_review(%L::uuid, %L, null)', :'sr_fam', 'approved'),
  'STALE_STATE', 'SR497-6c druga decyzja o tym samym przeglądzie odrzucona');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status = 'rejected' and decided_by = :'ADMIN'::uuid and decision_reason = 'Opcja dotyczy ciąży — usuń ją.'
     from public.screening_question_reviews where id = :'sr_fam')
  and exists (select 1 from public.audit_logs where action = 'screening_question.reviewed'
                and entity_id = :'sr_fam'::uuid and actor_id = :'ADMIN'::uuid
                and after_data->>'status' = 'rejected' and after_data->>'reason' is not null)
  and exists (select 1 from public.notifications where profile_id = :'EMPA'::uuid and entity_id = :'SRJOB'::uuid
                and data->>'kind' = 'screening_review' and data->>'status' = 'rejected'),
  'SR497-6d decyzja zapisana, audyt z uzasadnieniem, powiadomienie dla zgłaszającego');
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(format('select public.publish_job(%L::uuid, %L)', :'SRJOB', 'sr497'),
  'SCREENING_QUESTION_REJECTED: 1', 'SR497-6e publikacja z odrzuconym pytaniem odrzucona');
reset role; reset app.current_uid;

-- SR497-7: akceptacja nie publikuje automatycznie; poprawione pytanie wymaga nowej decyzji.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_decide_screening_review(:'sr_age'::uuid, 'approved', null);
reset role; reset app.current_uid;
select pg_temp.assert((select status::text from public.jobs where id = :'SRJOB') = 'draft',
  'SR497-7 akceptacja nie publikuje oferty');
-- Firma poprawia odrzuconą opcję, ale tłumaczenie zaakceptowanego pytania zmienia na inne ryzykowne.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.save_job_draft(:'SRJOB'::uuid, $j${
  "screening_questions": [
    {"type": "yes_no", "required": true, "prompt": {"pl": "Czy masz certyfikat VCA?"}},
    {"type": "single_choice", "prompt": {"pl": "Twoja sytuacja"},
     "options": [{"label": {"pl": "Mogę od zaraz"}}, {"label": {"pl": "Za miesiąc", "nl": "Over een maand"}}]},
    {"type": "date", "prompt": {"pl": "Od kiedy możesz zacząć?", "fr": "Quelle est votre nationalité ?"}}
  ]
}$j$::jsonb);
select pg_temp.expect_error(format('select public.publish_job(%L::uuid, %L)', :'SRJOB', 'sr497'),
  'SCREENING_REVIEW_REQUIRED: 2', 'SR497-7b zmiana tłumaczenia po akceptacji nie omija kontroli');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select risk_categories from public.job_screening_questions where job_id = :'SRJOB' and position = 1) = '{}'
  and (select count(*) from public.screening_question_reviews where job_id = :'SRJOB' and status = 'pending'
         and risk_categories = array['origin']) = 1,
  'SR497-7c poprawiona opcja bez przeglądu, nowa treść w kolejce');
-- Decyzja o treści, której już nie ma w ofercie (zaakceptowana data urodzenia), jest nieaktualna.
select id as sr_orig from public.screening_question_reviews where job_id = :'SRJOB' and risk_categories = array['origin'] \gset
insert into public.screening_question_reviews(job_id, content_fingerprint, risk_categories, question_type, prompt)
  values (:'SRJOB', 'nieobecna-tresc', array['age'], 'yes_no', '{"pl": "Ile masz lat?"}')
  returning id as sr_gone \gset
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  format('select public.admin_decide_screening_review(%L::uuid, %L, null)', :'sr_gone', 'approved'),
  'STALE_STATE', 'SR497-7d decyzja o treści nieobecnej w ofercie odrzucona');
select public.admin_decide_screening_review(:'sr_orig'::uuid, 'approved', 'Pytanie zaakceptowane do testu.');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.assert(public.publish_job(:'SRJOB'::uuid, 'sr497-ok') is not null, 'SR497-7e po akceptacji bieżącej treści firma publikuje');
reset role; reset app.current_uid;
select pg_temp.assert((select status::text from public.jobs where id = :'SRJOB') = 'active', 'SR497-7f oferta aktywna');

-- SR497-8 (kontrola ujemna fałszywych trafień): typowe pytania nie trafiają do kolejki i nie blokują.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.save_job_draft(:'SRJOB2'::uuid, $j${
  "screening_questions": [
    {"type": "yes_no", "required": true, "prompt": {"pl": "Masz prawo jazdy C+E?", "fr": "Avez-vous le permis C+E ?"}},
    {"type": "single_choice", "prompt": {"pl": "Jak dojedziesz?"},
     "options": [{"label": {"pl": "Własny samochód", "nl": "Eigen auto"}}, {"label": {"pl": "Komunikacja"}}]},
    {"type": "date", "prompt": {"pl": "Od kiedy możesz zacząć?", "en": "When can you start?"}},
    {"type": "short_text", "prompt": {"pl": "Ile lat doświadczenia z tachografem?", "nl": "Welke talen spreek je?"}}
  ]
}$j$::jsonb);
select pg_temp.assert(public.publish_job(:'SRJOB2'::uuid, 'sr497-2') is not null, 'SR497-8 oferta z typowymi pytaniami publikuje się bez przeglądu');
reset role; reset app.current_uid;
select pg_temp.assert(not exists (select 1 from public.screening_question_reviews where job_id = :'SRJOB2'),
  'SR497-8b brak zgłoszeń dla typowych pytań');

-- SR497-9: wznowienie wstrzymanej oferty też sprawdza pytania (strażnik na każdej aktywacji).
reset role;
alter table public.job_screening_questions disable trigger trg_guard_screening_questions_draft;
update public.job_screening_questions set prompt = '{"pl": "Czy należysz do związku zawodowego?"}'
  where job_id = :'SRJOB2' and position = 3;
alter table public.job_screening_questions enable trigger trg_guard_screening_questions_draft;
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.set_job_status(:'SRJOB2'::uuid, 'pause');
select pg_temp.expect_error(format('select public.set_job_status(%L::uuid, %L)', :'SRJOB2', 'resume'),
  'SCREENING_REVIEW_REQUIRED: 3', 'SR497-9 wznowienie z nieprzejrzanym pytaniem odrzucone');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text from public.jobs where id = :'SRJOB2') = 'paused'
  and exists (select 1 from public.screening_question_reviews where job_id = :'SRJOB2' and status = 'pending'
                and risk_categories = array['union']),
  'SR497-9b oferta wstrzymana, pytanie w kolejce');

-- ============================================================================
-- CM45 (#45, etap 2, 0101): dowód zgody, budżet na odbiorcę przy kolejkowaniu,
-- rezerwacja kampanii „rewizja + odbiorca”. Tokeny wypisania (cudzy/wygasły/zmieniony)
-- są podpisem HMAC w aplikacji — kontrole ujemne w tests/unit/email-unsubscribe.test.ts;
-- tu: bez tokenu nikt poza service_role nie wypisze nikogo (CM45-1i).
-- ============================================================================
\set CMA 'e0450000-0000-0000-0000-0000000000c1'
\set CMB 'e0450000-0000-0000-0000-0000000000c2'
\set CMN1 'e0450000-0000-0000-0000-0000000000d1'
\set CMN2 'e0450000-0000-0000-0000-0000000000d2'
\set CMN3 'e0450000-0000-0000-0000-0000000000d3'
\set CMN4 'e0450000-0000-0000-0000-0000000000d4'
\set CMN5 'e0450000-0000-0000-0000-0000000000d5'
\set CMW 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
\set CMJOBS '{"pl":{"jobs":[{"slug":"magazynier-gent","title":"Magazynier","city":"Gent","locale":"pl","isDemo":false}]},"nl":{"jobs":[{"slug":"magazijnier-gent","title":"Magazijnier","city":"Gent","locale":"nl","isDemo":false}]},"fr":{"jobs":[{"slug":"magasinier-gand","title":"Magasinier","city":"Gand","locale":"fr","isDemo":false}]},"en":{"jobs":[{"slug":"warehouse-gent","title":"Warehouse worker","city":"Ghent","locale":"en","isDemo":false}]}}'
reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'CMA','cma@test.be','Cm A','{"role":"candidate","first_name":"Cm","last_name":"A","locale":"pl"}'),
  (:'CMB','cmb@test.be','Cm B','{"role":"candidate","first_name":"Cm","last_name":"B","locale":"nl"}'),
  (:'CMN1','cmn1@test.be','Cm N1','{"role":"candidate","first_name":"Cm","last_name":"N1","locale":"pl"}'),
  (:'CMN2','cmn2@test.be','Cm N2','{"role":"candidate","first_name":"Cm","last_name":"N2","locale":"nl"}'),
  (:'CMN3','cmn3@test.be','Cm N3','{"role":"candidate","first_name":"Cm","last_name":"N3","locale":"fr"}'),
  (:'CMN4','cmn4@test.be','Cm N4','{"role":"candidate","first_name":"Cm","last_name":"N4","locale":"en"}'),
  (:'CMN5','cmn5@test.be','Cm N5','{"role":"candidate","first_name":"Cm","last_name":"N5","locale":"pl"}');

-- CM45-1: dowód zgody.
select pg_temp.assert(not exists (select 1 from public.email_consent_events where profile_id = :'CMA'),
  'CM45-1 wiersz startowy preferencji (wartości domyślne) nie jest zgodą');
set role authenticated; set app.current_uid = :'CMA'; select pg_temp.assert_client_role();
select public.set_notification_preferences(
  '{"email_applications":true,"email_offers":true,"email_messages":true,"email_job_matches":true,"email_marketing":true,"push_enabled":false,"in_app_enabled":true}'::jsonb,
  'nl', :'CMW');
select pg_temp.assert(
  (select count(*) = 1 and bool_and(category = 'marketing' and granted and source = 'settings'
                                    and locale = 'nl' and wording_version = :'CMW')
     from public.email_consent_events where profile_id = :'CMA'),
  'CM45-1b opt-in marketingu: kategoria, źródło, język strony, wersja treści');
select public.set_notification_preferences(
  '{"email_applications":true,"email_offers":true,"email_messages":true,"email_job_matches":true,"email_marketing":true,"push_enabled":true,"in_app_enabled":true}'::jsonb,
  'nl', :'CMW');
select pg_temp.assert((select count(*) from public.email_consent_events where profile_id = :'CMA') = 1,
  'CM45-1c ponowny zapis bez zmiany zgody e-mail nie dopisuje dowodu');
update public.notification_preferences set email_offers = false where profile_id = :'CMA';
select pg_temp.assert(
  (select source = 'direct' and locale = 'pl' and not granted and wording_version is null
     from public.email_consent_events where profile_id = :'CMA' and category = 'offers'),
  'CM45-1d bezpośredni UPDATE pod RLS też zostawia ślad (źródło direct, język odbiorcy)');
select pg_temp.expect_error($$insert into public.email_consent_events (profile_id, category, granted, source, locale)
    values ('e0450000-0000-0000-0000-0000000000c1', 'marketing', true, 'settings', 'pl')$$,
  'permission denied', 'CM45-1e klient nie dopisze dowodu');
select pg_temp.expect_error($$update public.email_consent_events set granted = false$$,
  'permission denied', 'CM45-1f klient nie zmieni dowodu');
select pg_temp.expect_error($$select public.set_notification_preferences('{"email_marketing":true}'::jsonb, 'pl', null)$$,
  'VALIDATION_FAILED', 'CM45-1g niekompletne preferencje odrzucone');
select pg_temp.expect_error(format($$select public.set_notification_preferences(%L::jsonb, 'pl', 'md5:abc')$$,
  '{"email_applications":true,"email_offers":true,"email_messages":true,"email_job_matches":true,"email_marketing":true,"push_enabled":false,"in_app_enabled":true}'),
  'VALIDATION_FAILED', 'CM45-1h zła wersja treści odrzucona');
select pg_temp.expect_error($$select public.email_unsubscribe_all('e0450000-0000-0000-0000-0000000000c2')$$,
  'permission denied', 'CM45-1i zalogowany nie wypisze innej osoby (bez tokenu, bez RPC)');
reset role;
set role authenticated; set app.current_uid = :'CMB'; select pg_temp.assert_client_role();
select pg_temp.assert(not exists (select 1 from public.email_consent_events where profile_id = :'CMA'),
  'CM45-1j cudzy dowód zgody niewidoczny');
reset role; reset app.current_uid;
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error($$select count(*) from public.email_consent_events$$,
  'permission denied', 'CM45-1k anon nie czyta dowodów');
reset role;
select pg_temp.expect_error($$update public.email_consent_events set granted = false$$,
  'PERMISSION_DENIED', 'CM45-1l dowód niezmienny także dla właściciela tabel');

set role service_role;
select pg_temp.assert(public.email_unsubscribe(:'CMA', 'marketing', 'one_click', 'fr') is true,
  'CM45-1m one-click wypisuje z marketingu');
select pg_temp.assert(public.email_unsubscribe_all(:'CMA') is true
    and public.email_unsubscribe_all(:'CMA') is false,
  'CM45-1n wypisanie ze wszystkiego jest idempotentne');
select pg_temp.expect_error($$select public.email_unsubscribe('e0450000-0000-0000-0000-0000000000c1', 'offers', 'settings')$$,
  'VALIDATION_FAILED', 'CM45-1o wypisanie tylko ze źródłem strony/one-click');
reset role;
select pg_temp.assert(
  (select source = 'one_click' and locale = 'fr' and not granted
     from public.email_consent_events where profile_id = :'CMA' and category = 'marketing' and not granted)
  and (select count(*) = 3 and bool_and(source = 'unsubscribe_page' and not granted)
         from public.email_consent_events
        where profile_id = :'CMA' and category in ('applications', 'messages', 'job_matches')),
  'CM45-1p wypisanie zapisuje wycofanie zgody ze źródłem i językiem');
select pg_temp.assert(
  (select not (email_applications or email_offers or email_messages or email_job_matches or email_marketing)
     from public.notification_preferences where profile_id = :'CMA'),
  'CM45-1q po wypisaniu ze wszystkiego żadna kategoria nie jest włączona');

-- CM45-1r: KONTROLA UJEMNA — bez triggera zmiana zgody nie zostawia dowodu.
alter table public.notification_preferences disable trigger notification_preferences_consent_events;
update public.notification_preferences set email_marketing = true where profile_id = :'CMB';
select pg_temp.assert(not exists (select 1 from public.email_consent_events where profile_id = :'CMB'),
  'CM45-1r bez triggera opt-in przechodzi bez śladu (test wykrywa brak dowodu)');
update public.notification_preferences set email_marketing = false where profile_id = :'CMB';
alter table public.notification_preferences enable trigger notification_preferences_consent_events;

-- CM45-2: budżet na odbiorcę (domyślnie newsletter 1/dobę).
update public.notification_preferences set email_marketing = true where profile_id = :'CMB';
select pg_temp.assert(
  (select outcome = 'queued' from public.enqueue_email_outcome(:'CMB', 'newsletter', null, null, 'cm45-news-1', '{}'::jsonb)),
  'CM45-2 pierwszy newsletter w oknie zakolejkowany');
select pg_temp.assert(
  (select outcome = 'recipient_budget' from public.enqueue_email_outcome(:'CMB', 'newsletter', null, null, 'cm45-news-2', '{}'::jsonb)),
  'CM45-2b drugi newsletter w tej samej dobie odrzucony budżetem odbiorcy');
select pg_temp.assert(
  (select status::text = 'failed' and suppressed_at is not null and error_message = 'suppressed_recipient_budget'
     from public.email_deliveries where idempotency_key = 'cm45-news-2'),
  'CM45-2c wiersz ponad limit zostaje jako ślad, nie trafi do workera');
select pg_temp.assert(
  (select outcome = 'duplicate' from public.enqueue_email_outcome(:'CMB', 'newsletter', null, null, 'cm45-news-2', '{}'::jsonb))
  and (select count(*) from public.email_deliveries where idempotency_key = 'cm45-news-2') = 1
  and (select used from public.email_recipient_windows where profile_id = :'CMB' and scope = 'template:newsletter') = 1,
  'CM45-2d ponowienie z tym samym kluczem: bez drugiego listu i bez zużycia budżetu');
select pg_temp.assert(
  (select outcome = 'queued' from public.enqueue_email_outcome(:'CMB', 'statusChanged', 'application', null, 'cm45-status-1', '{}'::jsonb)),
  'CM45-2e transakcyjne nie są ograniczone limitem newslettera');
-- enqueue → wypisanie → worker nie wysyła, a miejsce wraca do odbiorcy.
set role service_role; select public.email_unsubscribe(:'CMB', 'marketing', 'one_click', null); reset role;
select pg_temp.assert(
  not exists (select 1 from public.claim_email_batch(100000) c where c.idempotency_key = 'cm45-news-1'),
  'CM45-2f newsletter zakolejkowany przed wypisaniem nie wychodzi');
select pg_temp.assert(
  (select used from public.email_recipient_windows where profile_id = :'CMB' and scope = 'template:newsletter') = 0,
  'CM45-2g wygaszony list oddaje miejsce w budżecie odbiorcy');

-- CM45-3: kampanie — rezerwacja rewizja + odbiorca.
update public.notification_preferences set email_marketing = true
 where profile_id in (:'CMN1', :'CMN2', :'CMN3', :'CMN5');
set role service_role;
select pg_temp.expect_error($$select public.create_email_campaign_revision('cm45-news', '{"pl":{"jobs":[{"slug":"a"}]}}'::jsonb)$$,
  'VALIDATION_FAILED', 'CM45-3 treść bez wszystkich języków odrzucona');
select public.create_email_campaign_revision('cm45-news', :'CMJOBS'::jsonb) as cm_rev1 \gset
select pg_temp.assert(
  (select b.reserved = 0 from public.enqueue_campaign_batch(:'cm_rev1', 100) b),
  'CM45-3b szkic nie kolejkuje niczego');
select public.activate_email_campaign(:'cm_rev1');
select public.enqueue_campaign_batch(:'cm_rev1', 5000);
reset role;
select pg_temp.assert(
  (select count(*) = 4 and bool_and(r.status = 'queued' and r.delivery_id is not null)
     from public.email_campaign_recipients r
    where r.campaign_id = :'cm_rev1' and r.profile_id in (:'CMN1', :'CMN2', :'CMN3', :'CMN5'))
  and not exists (select 1 from public.email_campaign_recipients r
                   where r.campaign_id = :'cm_rev1' and r.profile_id in (:'CMN4', :'CMA')),
  'CM45-3c zarezerwowani tylko odbiorcy z aktualną zgodą');
select pg_temp.assert(
  (select d.locale = 'nl' and d.payload -> 'jobs' -> 0 ->> 'slug' = 'magazijnier-gent'
          and d.campaign_id = :'cm_rev1'::uuid
     from public.email_deliveries d where d.idempotency_key = 'campaign:' || :'cm_rev1' || ':' || :'CMN2'),
  'CM45-3d list w języku odbiorcy z treścią tego języka (Invariant #1)');
set role service_role;
select pg_temp.assert((select b.reserved = 0 from public.enqueue_campaign_batch(:'cm_rev1', 5000) b),
  'CM45-3e restart harmonogramu nie rezerwuje nikogo drugi raz');
reset role;
select pg_temp.assert(
  (select count(*) from public.email_deliveries where campaign_id = :'cm_rev1'::uuid and profile_id = :'CMN1') = 1
  and (select status from public.email_campaigns where id = :'cm_rev1') = 'completed',
  'CM45-3f jeden list na odbiorcę; kampania zakończona po zarezerwowaniu wszystkich');

-- Stan przed nową rewizją: N1 wysłany i doręczony, N2 czeka (backoff), N3 wypisany, N5 w drodze.
update public.email_deliveries set next_attempt_at = now() + interval '1 hour'
 where campaign_id = :'cm_rev1'::uuid and profile_id = :'CMN2';
set role service_role; select public.email_unsubscribe(:'CMN3', 'marketing', 'one_click', null); reset role;
select pg_temp.assert(
  (select count(*) from public.claim_email_batch(100000) c
    where c.campaign_id = :'cm_rev1'::uuid and c.profile_id in (:'CMN1', :'CMN5')) = 2,
  'CM45-3g worker bierze listy N1 i N5');
update public.email_deliveries set status = 'sent', locked_at = null
 where campaign_id = :'cm_rev1'::uuid and profile_id = :'CMN1';
update public.email_deliveries set status = 'delivered'
 where campaign_id = :'cm_rev1'::uuid and profile_id = :'CMN1';
select pg_temp.assert(
  (select r.status from public.email_campaign_recipients r where r.campaign_id = :'cm_rev1' and r.profile_id = :'CMN1') = 'delivered'
  and (select r.status || '/' || r.reason from public.email_campaign_recipients r
        where r.campaign_id = :'cm_rev1' and r.profile_id = :'CMN3') = 'skipped_consent/opted_out',
  'CM45-3h status odbiorcy idzie za wysyłką; wypisany po kolejkowaniu = skipped_consent');

-- Nowa rewizja: stara wygaszona, nie wraca; zgoda sprawdzana od nowa.
update public.notification_preferences set email_marketing = true where profile_id = :'CMN4';
set role service_role;
select public.create_email_campaign_revision('cm45-news', :'CMJOBS'::jsonb) as cm_rev2 \gset
select public.activate_email_campaign(:'cm_rev2');
reset role;
select pg_temp.assert(
  (select status from public.email_campaigns where id = :'cm_rev1') = 'superseded'
  and (select d.status::text || '/' || d.error_message from public.email_deliveries d
        where d.campaign_id = :'cm_rev1'::uuid and d.profile_id = :'CMN2') = 'failed/suppressed_campaign_inactive'
  and (select r.status || '/' || r.reason from public.email_campaign_recipients r
        where r.campaign_id = :'cm_rev1' and r.profile_id = :'CMN2') = 'cancelled/superseded',
  'CM45-3i aktywacja nowej rewizji wygasza niewysłany list starej');
set role service_role;
select pg_temp.expect_error(format('select public.activate_email_campaign(%L)', :'cm_rev1'),
  'STALE_STATE', 'CM45-3j stara rewizja nie wraca');
select public.enqueue_campaign_batch(:'cm_rev2', 5000);
reset role;
select pg_temp.assert(
  (select array_agg(r.profile_id order by r.profile_id) from public.email_campaign_recipients r
    where r.campaign_id = :'cm_rev2' and r.profile_id in (:'CMN1', :'CMN2', :'CMN3', :'CMN4', :'CMN5'))
    = array[:'CMN2', :'CMN4']::uuid[]
  and (select bool_and(r.status = 'queued') from public.email_campaign_recipients r
        where r.campaign_id = :'cm_rev2' and r.profile_id in (:'CMN2', :'CMN4')),
  'CM45-3k nowa rewizja: bez doręczonych (N1) i w drodze (N5), bez wypisanych (N3); N2 z oddanym budżetem');
-- Worker po wznowieniu: dzierżawa N5 wygasła, rewizja nieaktywna → list nie wychodzi.
update public.email_deliveries set locked_at = now() - interval '1 hour'
 where campaign_id = :'cm_rev1'::uuid and profile_id = :'CMN5';
create function pg_temp.cm45_claim_0098(p_id uuid) returns setof public.email_deliveries
language sql as $$
  select e.* from public.email_deliveries e
   where e.id = p_id and e.status = 'queued'
     and public.email_allowed(e.profile_id, e.template)
     and not public.email_address_suppressed(e.to_email::text);
$$;
select pg_temp.assert(
  exists (select 1 from pg_temp.cm45_claim_0098(
    (select id from public.email_deliveries where campaign_id = :'cm_rev1'::uuid and profile_id = :'CMN5'))),
  'CM45-3l KONTROLA UJEMNA: warunki claimu z 0098 wydałyby list starej rewizji');
select pg_temp.assert(
  not exists (select 1 from public.claim_email_batch(100000) c
               where c.campaign_id = :'cm_rev1'::uuid),
  'CM45-3m nowy claim nie wydaje listu nieaktywnej rewizji po wznowieniu workera');
select pg_temp.assert(
  (select d.error_message = 'suppressed_campaign_inactive' and r.status = 'cancelled'
     from public.email_deliveries d join public.email_campaign_recipients r on r.delivery_id = d.id
    where d.campaign_id = :'cm_rev1'::uuid and d.profile_id = :'CMN5'),
  'CM45-3n list wygaszony (ślad zostaje), odbiorca starej rewizji = cancelled');

-- CM45-4: uprawnienia.
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error('select count(*) from public.email_campaigns', 'permission denied',
  'CM45-4 anon nie czyta kampanii');
select pg_temp.expect_error(format('select * from public.enqueue_campaign_batch(%L)', :'cm_rev2'),
  'permission denied', 'CM45-4b anon nie kolejkuje kampanii');
reset role;
set role authenticated; set app.current_uid = :'CMN1'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select count(*) from public.email_campaign_recipients', 'permission denied',
  'CM45-4c zalogowany nie czyta listy odbiorców');
select pg_temp.expect_error('select count(*) from public.email_recipient_windows', 'permission denied',
  'CM45-4d zalogowany nie czyta liczników budżetu');
select pg_temp.expect_error('update public.email_recipient_budget_config set max_per_recipient = 1000',
  'permission denied', 'CM45-4e zalogowany nie zmieni limitów');
select pg_temp.expect_error(format('select public.activate_email_campaign(%L)', :'cm_rev2'),
  'permission denied', 'CM45-4f zalogowany nie aktywuje kampanii');
select pg_temp.expect_error($$select * from public.enqueue_email_outcome('e0450000-0000-0000-0000-0000000000d1', 'newsletter', null, null, 'x', '{}'::jsonb)$$,
  'permission denied', 'CM45-4g zalogowany nie kolejkuje e-maili');
reset role; reset app.current_uid;

-- CM45-5..6: równoległe sesje (dblink). Dane zatwierdzane przez osobne połączenie, bo
-- niezatwierdzone wiersze skryptu byłyby niewidoczne dla sesji symulujących workery.
select pg_temp.un45_sql($q$
  insert into auth.users(id,email,name,raw_user_meta_data) values
    ('e0450000-0000-0000-0000-0000000000f1','cmp1@test.be','Cm P1','{"role":"candidate","first_name":"Cm","last_name":"P1","locale":"pl"}'),
    ('e0450000-0000-0000-0000-0000000000f2','cmp2@test.be','Cm P2','{"role":"candidate","first_name":"Cm","last_name":"P2","locale":"en"}');
  update public.notification_preferences set email_marketing = true
   where profile_id in ('e0450000-0000-0000-0000-0000000000f1','e0450000-0000-0000-0000-0000000000f2');
  insert into public.email_recipient_budget_config (scope, window_seconds, max_per_recipient)
    values ('template:jobMatch', 86400, 1) on conflict (scope) do update set max_per_recipient = 1;
  select 'ok'$q$);
select pg_temp.remote_connect('cm45_a');
select pg_temp.remote_connect('cm45_b');

-- CM45-5: dwa równoległe enqueue tego samego typu — limit 1 dostaje tylko jeden.
select dbl.dblink_exec('cm45_a', 'begin');
select pg_temp.assert(
  (select t.o from dbl.dblink('cm45_a', $$select outcome from public.enqueue_email_outcome(
     'e0450000-0000-0000-0000-0000000000f1', 'jobMatch', null, null, 'cm45-par-1', '{}'::jsonb)$$) as t(o text)) = 'queued',
  'CM45-5 sesja A kolejkuje (transakcja otwarta)');
select dbl.dblink_send_query('cm45_b', $$select outcome from public.enqueue_email_outcome(
  'e0450000-0000-0000-0000-0000000000f1', 'jobMatch', null, null, 'cm45-par-2', '{}'::jsonb)$$);
select pg_sleep(0.3);
select pg_temp.assert(
  exists (select 1 from pg_stat_activity where wait_event_type = 'Lock' and query like '%cm45-par-2%'),
  'CM45-5a sesja B czeka na licznik odbiorcy');
select dbl.dblink_exec('cm45_a', 'commit');
select pg_temp.assert(
  (select t.o from dbl.dblink_get_result('cm45_b') as t(o text)) = 'recipient_budget',
  'CM45-5b sesja B dostaje odmowę budżetu');
select * from dbl.dblink_get_result('cm45_b') as t(o text);
select pg_temp.assert(
  pg_temp.un45_sql($$select count(*)::text from public.email_deliveries
    where profile_id = 'e0450000-0000-0000-0000-0000000000f1' and template = 'jobMatch' and status = 'queued'$$) = '1',
  'CM45-5c równolegle: dokładnie jeden list w limicie');

-- CM45-5d: KONTROLA UJEMNA — licznik bez blokady (odczyt → zapis) przepuszcza oba.
select pg_temp.un45_sql($q$
  create schema cm45test;
  create table cm45test.win (used int not null);
  insert into cm45test.win values (0);
  create function cm45test.naive_take() returns boolean language plpgsql as $f$
  declare v_used int;
  begin
    select used into v_used from cm45test.win;
    perform pg_sleep(0.2);
    if v_used >= 1 then return false; end if;
    update cm45test.win set used = v_used + 1;
    return true;
  end $f$;
  select 'ok'$q$);
select dbl.dblink_send_query('cm45_a', 'select cm45test.naive_take()');
select dbl.dblink_send_query('cm45_b', 'select cm45test.naive_take()');
select pg_temp.assert(
  (select t.g from dbl.dblink_get_result('cm45_a') as t(g boolean)) is true
  and (select t.g from dbl.dblink_get_result('cm45_b') as t(g boolean)) is true,
  'CM45-5d naiwny licznik przepuszcza dwa listy przy limicie 1 (test wykrywa błąd)');
select * from dbl.dblink_get_result('cm45_a') as t(g boolean);
select * from dbl.dblink_get_result('cm45_b') as t(g boolean);

-- CM45-6: dwa harmonogramy kampanii naraz — jeden list na odbiorcę.
select pg_temp.un45_sql($q$
  with r as (select public.create_email_campaign_revision('cm45-par', $j${"pl":{"jobs":[{"slug":"magazynier-gent","title":"Magazynier","city":"Gent","locale":"pl","isDemo":false}]},"nl":{"jobs":[{"slug":"magazijnier-gent","title":"Magazijnier","city":"Gent","locale":"nl","isDemo":false}]},"fr":{"jobs":[{"slug":"magasinier-gand","title":"Magasinier","city":"Gand","locale":"fr","isDemo":false}]},"en":{"jobs":[{"slug":"warehouse-gent","title":"Warehouse worker","city":"Ghent","locale":"en","isDemo":false}]}}$j$::jsonb) as id)
  select public.activate_email_campaign(id) from r;
  select 'ok'$q$);
select dbl.dblink_exec('cm45_a', 'begin');
select * from dbl.dblink('cm45_a', $$select reserved::text from public.enqueue_campaign_batch(
  (select id from public.email_campaigns where slug = 'cm45-par' and status = 'active'), 5000)$$) as t(v text);
select dbl.dblink_send_query('cm45_b', $$select reserved::text from public.enqueue_campaign_batch(
  (select id from public.email_campaigns where slug = 'cm45-par' and status = 'active'), 5000)$$);
select pg_sleep(0.3);
select dbl.dblink_exec('cm45_a', 'commit');
select * from dbl.dblink_get_result('cm45_b') as t(v text);
select * from dbl.dblink_get_result('cm45_b') as t(v text);
select pg_temp.assert(
  pg_temp.un45_sql($$select (count(*) = 2 and count(distinct d.profile_id) = 2)::text
      from public.email_deliveries d join public.email_campaigns c on c.id = d.campaign_id
     where c.slug = 'cm45-par'
       and d.profile_id in ('e0450000-0000-0000-0000-0000000000f1','e0450000-0000-0000-0000-0000000000f2')$$)::boolean,
  'CM45-6 równoległe harmonogramy: po jednym liście na odbiorcę');
-- CM45-6b: KONTROLA UJEMNA — harmonogram bez rezerwacji (sprawdź „czy już ma list” → wstaw
-- z nowym kluczem) wysyła dwa listy temu samemu odbiorcy.
select pg_temp.un45_sql($q$
  create table cm45test.naive_sent (profile_id uuid not null);
  create function cm45test.naive_schedule() returns int language plpgsql as $f$
  declare v_has boolean;
  begin
    select exists (select 1 from cm45test.naive_sent
                    where profile_id = 'e0450000-0000-0000-0000-0000000000f1') into v_has;
    perform pg_sleep(0.2);
    if v_has then return 0; end if;
    insert into cm45test.naive_sent values ('e0450000-0000-0000-0000-0000000000f1');
    return 1;
  end $f$;
  select 'ok'$q$);
select dbl.dblink_send_query('cm45_a', 'select cm45test.naive_schedule()');
select dbl.dblink_send_query('cm45_b', 'select cm45test.naive_schedule()');
select * from dbl.dblink_get_result('cm45_a') as t(n int);
select * from dbl.dblink_get_result('cm45_a') as t(n int);
select * from dbl.dblink_get_result('cm45_b') as t(n int);
select * from dbl.dblink_get_result('cm45_b') as t(n int);
select pg_temp.assert(
  pg_temp.un45_sql('select count(*)::text from cm45test.naive_sent') = '2',
  'CM45-6b bez rezerwacji dwa harmonogramy wysyłają dwa listy (test wykrywa błąd)');
select dbl.dblink_disconnect('cm45_a');
select dbl.dblink_disconnect('cm45_b');

-- ESCO93-R (rollback 0097): supabase/tests/esco93-rollback.sql, uruchamiany przez test-rls.sh
-- po tym pliku (psql -f, bo \ir ścieżki rollbacku nie działa przy wejściu ze stdin).

-- ============================================================================
-- VIS494. Widoczność profilu kandydata dla firm (#494, 0100): domyślnie wyłączona po
-- ukończeniu onboardingu, świadome włączenie/wyłączenie przez set_candidate_searchable,
-- znacznik czasu + historia tylko przy realnej zmianie, skutek natychmiastowy (także po
-- znanym ID i dla dopasowań), relacja z aplikacji zostaje. Kontrole ujemne: stara
-- polityka matches (0078) i stary guard (0029) dają czerwony wynik.
-- ============================================================================
\set VISC  'e4940000-0000-0000-0000-000000000001'
\set VISO  'e4940000-0000-0000-0000-000000000002'
\set VISE1 'e4940000-0000-0000-0000-000000000003'
\set VISE2 'e4940000-0000-0000-0000-000000000004'
\set VISEU 'e4940000-0000-0000-0000-000000000005'
\set VISF1 'e4940000-0000-0000-0000-0000000000f1'
\set VISF2 'e4940000-0000-0000-0000-0000000000f2'
\set VISFU 'e4940000-0000-0000-0000-0000000000f3'
\set VISJ1 'e4940000-0000-0000-0000-0000000000a1'
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'VISC','visc@test.be','Vis C','{"role":"candidate","first_name":"Vera","last_name":"Visible","locale":"pl"}'),
  (:'VISO','viso@test.be','Vis O','{"role":"candidate","first_name":"Olaf","last_name":"Other","locale":"nl"}'),
  (:'VISE1','vise1@test.be','Vis E1','{"role":"employer","first_name":"Rek","last_name":"V1","locale":"fr"}'),
  (:'VISE2','vise2@test.be','Vis E2','{"role":"employer","first_name":"Rek","last_name":"V2","locale":"en"}'),
  (:'VISEU','viseu@test.be','Vis EU','{"role":"employer","first_name":"Rek","last_name":"VU","locale":"nl"}');
insert into public.companies(id,name,status) values
  (:'VISF1','Firma Vis 1','verified'), (:'VISF2','Firma Vis 2','verified'), (:'VISFU','Firma Vis U','unverified');
insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'VISF1',:'VISE1','owner',true), (:'VISF2',:'VISE2','owner',true), (:'VISFU',:'VISEU','owner',true);
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'VISJ1',:'VISF1','job-vis-1','Magazynier VIS','warehouse','permanent','Antwerpia','Flandria','active','pl');

-- Kandydat bez profilu: pierwszy RPC tworzy profil (ensure_candidate_profile); dane jak po krokach 1–6.
select set_config('app.current_uid', :'VISC', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert(public.set_candidate_searchable(false) is false, 'VIS1 wyłączenie działa zawsze (także przed ukończeniem)');
select pg_temp.expect_error('select public.set_candidate_searchable(true)',
  'VALIDATION_FAILED', 'VIS1b włączenie przed ukończeniem profilu odrzucone');
reset role;
update public.candidate_profiles
  set occupations = array['magazynier'], categories = array['warehouse']::public.job_category[],
      city = 'Antwerpia', availability = 'immediate', headline = 'Magazynier'
  where profile_id = :'VISC';
insert into public.candidate_skills(candidate_profile_id, skill_label)
  select id, 'wózek widłowy' from public.candidate_profiles where profile_id = :'VISC';
insert into public.matches(candidate_id, job_id, score) values (:'VISC', :'VISJ1', 90);

set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert(public.finish_onboarding() is true, 'VIS2 onboarding ukończony');
select pg_temp.assert(
  (select not is_searchable and profile_completed and searchable_changed_at is null
   from public.candidate_profiles where profile_id = :'VISC'),
  'VIS2b ukończony onboarding zostawia profil niewyszukiwalny, bez znacznika');
select pg_temp.assert((select count(*) from public.candidate_visibility_events) = 0,
  'VIS2c brak zdarzeń bez realnej zmiany (wyłączenie przy wyłączonym = no-op)');
reset role;

-- Przed opt-in: nikt poza właścicielem nie widzi profilu, relacji ani dopasowania.
select set_config('app.current_uid', :'VISE1', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.candidate_profiles where profile_id = :'VISC') = 0,
  'VIS3 zweryfikowana firma nie widzi profilu przed opt-in (znane ID)');
select pg_temp.assert((select count(*) from public.matches where candidate_id = :'VISC') = 0,
  'VIS3b zweryfikowana firma nie widzi dopasowania przed opt-in');
reset role;
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.candidate_profiles where profile_id = :'VISC') = 0,
  'VIS3c anon nie widzi profilu');
reset role;

-- Opt-in.
select set_config('app.current_uid', :'VISC', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert(public.set_candidate_searchable(true) is true, 'VIS4 włączenie po ukończeniu');
select pg_temp.assert(public.set_candidate_searchable(true) is true, 'VIS4b ponowienie włączenia');
select pg_temp.assert(
  (select is_searchable and searchable_changed_at is not null
   from public.candidate_profiles where profile_id = :'VISC'),
  'VIS4c flaga i znacznik czasu z bazy');
select pg_temp.assert(
  (select count(*) = 1 and bool_and(searchable) from public.candidate_visibility_events where candidate_id = :'VISC'),
  'VIS4d jedno zdarzenie historii (ponowienie bez duplikatu)');
select pg_temp.expect_error(
  format('update public.candidate_profiles set searchable_changed_at = now() - interval ''1 day'' where profile_id = %L::uuid', :'VISC'),
  'PERMISSION_DENIED', 'VIS4e klient nie ustawia znacznika bezpośrednio');
select pg_temp.expect_error(
  format('insert into public.candidate_visibility_events(candidate_id, searchable) values (%L::uuid, false)', :'VISC'),
  'permission denied', 'VIS4f klient nie dopisuje historii');
select pg_temp.expect_error(
  format('delete from public.candidate_visibility_events where candidate_id = %L::uuid', :'VISC'),
  'permission denied', 'VIS4g klient nie kasuje historii');
reset role;

-- Po opt-in: zweryfikowana firma widzi minimalny zakres (profil zawodowy + relacje + dopasowanie),
-- bez imienia/nazwiska/kontaktu.
select set_config('app.current_uid', :'VISE1', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.candidate_profiles where profile_id = :'VISC') = 1,
  'VIS5 zweryfikowana firma widzi profil po opt-in');
select pg_temp.assert((select count(*) from public.candidate_skills s join public.candidate_profiles cp
    on cp.id = s.candidate_profile_id where cp.profile_id = :'VISC') = 1,
  'VIS5b widzi umiejętności profilu');
select pg_temp.assert((select count(*) from public.matches where candidate_id = :'VISC') = 1,
  'VIS5c widzi dopasowanie do własnej oferty');
select pg_temp.assert((select count(*) from public.profiles where id = :'VISC') = 0,
  'VIS5d nie widzi imienia/nazwiska/kontaktu bez relacji');
select pg_temp.assert((select count(*) from public.candidate_visibility_events) = 0,
  'VIS5e firma nie czyta historii widoczności');
reset role;
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.candidate_profiles where profile_id = :'VISC') = 0,
  'VIS5j anon nie widzi profilu po opt-in');
reset role;
select set_config('app.current_uid', :'VISEU', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.candidate_profiles where profile_id = :'VISC') = 0,
  'VIS5f niezweryfikowana firma nie widzi profilu po opt-in');
reset role;
select set_config('app.current_uid', :'VISO', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.candidate_profiles where profile_id = :'VISC') = 0,
  'VIS5g inny kandydat nie widzi profilu');
select pg_temp.assert((select count(*) from public.candidate_visibility_events) = 0,
  'VIS5h inny kandydat nie widzi cudzej historii');
reset role;
select set_config('app.current_uid', :'VISE1', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.set_candidate_searchable(true)',
  'PERMISSION_DENIED', 'VIS5i konto pracodawcy nie ustawia widoczności');
reset role;

-- Blokada firmy: VISF2 nie widzi mimo opt-in, VISF1 dalej widzi.
select set_config('app.current_uid', :'VISC', false);
set role authenticated; select pg_temp.assert_client_role();
select public.set_company_block(:'VISF2'::uuid, true);
reset role;
select set_config('app.current_uid', :'VISE2', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.candidate_profiles where profile_id = :'VISC') = 0,
  'VIS6 zablokowana firma nie widzi profilu mimo opt-in');
reset role;

-- Opt-out: skutek natychmiastowy, także po znanym ID i dla dopasowań.
select set_config('app.current_uid', :'VISC', false);
set role authenticated; select pg_temp.assert_client_role();
select searchable_changed_at as vis_on_at from public.candidate_profiles where profile_id = :'VISC' \gset
select pg_temp.assert(public.set_candidate_searchable(false) is false, 'VIS7 wyłączenie');
select pg_temp.assert(
  (select not is_searchable and searchable_changed_at >= :'vis_on_at'::timestamptz
   from public.candidate_profiles where profile_id = :'VISC'),
  'VIS7b flaga wyłączona, znacznik zaktualizowany');
select pg_temp.assert(
  (select string_agg(searchable::text, ',' order by created_at, searchable desc)
   from public.candidate_visibility_events where candidate_id = :'VISC') = 'true,false',
  'VIS7c historia: włączenie, potem wyłączenie');
reset role;
select set_config('app.current_uid', :'VISE1', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.candidate_profiles where profile_id = :'VISC') = 0,
  'VIS8 po wyłączeniu firma nie widzi profilu (znane ID)');
select pg_temp.assert((select count(*) from public.candidate_skills s join public.candidate_profiles cp
    on cp.id = s.candidate_profile_id where cp.profile_id = :'VISC') = 0,
  'VIS8b po wyłączeniu nie widzi umiejętności');
select pg_temp.assert((select count(*) from public.matches where candidate_id = :'VISC') = 0,
  'VIS8c po wyłączeniu nie widzi dopasowania (znane ID)');
select pg_temp.assert((select count(*) from public.get_company_top_matches(:'VISF1'::uuid, 5)
    where candidate_id = :'VISC') = 0,
  'VIS8d po wyłączeniu kandydat znika z top dopasowań');
reset role;

-- Kontrola ujemna 1: polityka matches z 0078 (bez widoczności kandydata) przepuszcza wynik.
begin;
drop policy matches_select on public.matches;
create policy matches_select on public.matches
  for select to authenticated
  using (
    candidate_id = auth.uid()
    or (public.is_job_manager(job_id)
        and not public.candidate_blocked_job_company(candidate_id, job_id))
  );
set local role authenticated; set local app.current_uid = :'VISE1'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.matches where candidate_id = :'VISC') = 1,
  'VIS9 kontrola ujemna: bez 0100 firma czyta dopasowanie po wyłączeniu widoczności');
rollback;

-- Kontrola ujemna 2: guard z 0029 (bez znacznika) pozwala klientowi przestawić znacznik.
begin;
create or replace function public.guard_candidate_completeness()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.profile_completed := false; new.is_searchable := false; return new;
  end if;
  if new.profile_completed is distinct from old.profile_completed
     or new.is_searchable is distinct from old.is_searchable then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  return new;
end $$;
set local role authenticated; set local app.current_uid = :'VISC'; select pg_temp.assert_client_role();
update public.candidate_profiles set searchable_changed_at = now() - interval '1 day' where profile_id = :'VISC';
select pg_temp.assert((select searchable_changed_at < now() - interval '1 hour'
    from public.candidate_profiles where profile_id = :'VISC'),
  'VIS9b kontrola ujemna: bez 0100 klient przestawia znacznik');
rollback;

-- Relacja z aplikacji zostaje: kandydat aplikuje do VISF1 — firma widzi profil i dopasowanie
-- w tym procesie mimo wyłączonej widoczności (company_can_view_candidate, 0078).
select set_config('app.current_uid', :'VISC', false);
set role authenticated; select pg_temp.assert_client_role();
select public.apply_to_job(:'VISJ1'::uuid, 'vis-app-1', null, 'immediate', null) as visapp \gset
reset role;
select set_config('app.current_uid', :'VISE1', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.candidate_profiles where profile_id = :'VISC') = 1,
  'VIS10 firma, do której kandydat aplikował, widzi profil mimo wyłączenia');
select pg_temp.assert((select count(*) from public.matches where candidate_id = :'VISC') = 1,
  'VIS10b i dopasowanie do tej oferty');
reset role;
select set_config('app.current_uid', :'VISE2', false);
set role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.candidate_profiles where profile_id = :'VISC') = 0,
  'VIS10c inna firma nadal nie widzi profilu');
reset role; reset app.current_uid;

-- ============================================================================
-- MOD42. Decyzja moderacyjna z uzasadnieniem i atomową egzekucją (0099, #42):
-- decyzja + skutek + stan sprawy + historia + audyt + powiadomienia w jednej transakcji;
-- sam status nie rozstrzyga sprawy DSA; blokada treści; awaria cofa całość; wyścig;
-- przywrócenie; kolejka przeglądu (flaga bez decyzji); uzasadnienie dla autora.
-- ============================================================================
\set MODJ1 'e9600000-0000-0000-0000-0000000000b1'
\set MODJ2 'e9600000-0000-0000-0000-0000000000b2'
\set MODJ3 'e9600000-0000-0000-0000-0000000000b3'
\set MODJ4 'e9600000-0000-0000-0000-0000000000b4'
\set MODJ5 'e9600000-0000-0000-0000-0000000000b5'
\set MODCO 'e9600000-0000-0000-0000-0000000000c1'
\set MODCA 'e9600000-0000-0000-0000-0000000000c2'
\set MODFACTS 'Oferta wymaga od kandydatów opłaty za rekrutację z góry.'
reset role; reset app.current_uid;
insert into public.companies(id,name,status) values (:'MODCO','Firma Moderowana','verified'), (:'MODCA','Firma Ofert M','verified');
insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'MODCO',:'EMPB','owner',true), (:'MODCA',:'EMPA','owner',true);
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'MODJ1',:'MODCA','mod-job-1','Magazynier M1','warehouse','permanent','Antwerpia','Flandria','active','pl'),
  (:'MODJ2',:'MODCA','mod-job-2','Magazynier M2','warehouse','permanent','Antwerpia','Flandria','active','pl'),
  (:'MODJ3',:'MODCO','mod-job-3','Kierowca M3','transport','permanent','Gandawa','Flandria','active','pl'),
  (:'MODJ4',:'MODCA','mod-job-4','Magazynier M4','warehouse','permanent','Antwerpia','Flandria','active','pl'),
  (:'MODJ5',:'MODCA','mod-job-5','Magazynier M5','warehouse','permanent','Antwerpia','Flandria','active','pl');
-- MODJ1 kompletna: `reopen` przeszedłby walidację — blokuje go wyłącznie decyzja.
insert into public.job_translations (job_id, locale, title, description, responsibilities)
  values (:'MODJ1', 'pl', 'Magazynier M1', 'Dłuższy opis stanowiska magazynowego.', array['Obsługa magazynu']);
insert into public.job_requirements (job_id, kind, locale, content, position)
  values (:'MODJ1', 'mandatory', 'pl', 'Doświadczenie', 1);

set role service_role;
select report_id as mr1 from public.submit_content_report(null, gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX',
  'job', :'MODJ1', 'fraud', 'Oferta wymaga opłaty za rekrutację z góry.', null, 'Gość M', 'mod1@test.be', 'fr', true) \gset
select report_id as mr2 from public.submit_content_report(:'CANDA', gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX',
  'job', :'MODJ2', 'other', 'Opis oferty wydaje się niepełny i mylący.', null, null, 'mod2@test.be', 'en', true) \gset
select report_id as mr3 from public.submit_content_report(null, gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX',
  'company', :'MODJ3', 'impersonation', 'Firma podszywa się pod znanego pracodawcę.', null, null, 'mod3@test.be', 'nl', true) \gset
select report_id as mr4 from public.submit_content_report(null, gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX',
  'job', :'MODJ1', 'fraud', 'Druga osoba zgłasza tę samą opłatę z góry.', null, null, 'mod4@test.be', 'en', true) \gset
select report_id as mr5, case_number as mcase5 from public.submit_content_report(null, gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX',
  'job', :'MODJ5', 'fraud', 'Zgłoszenie do testu równoległych decyzji.', null, null, 'mod5@test.be', 'pl', true) \gset
select report_id as mr6 from public.submit_content_report(null, gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX',
  'job', :'MODJ4', 'fraud', 'Zgłoszenie do testu awarii egzekucji.', null, null, 'mod6@test.be', 'pl', true) \gset
select report_id as mr7 from public.submit_content_report(null, gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX',
  'job', :'MODJ4', 'other', 'Zgłoszenie do testu kolejki przeglądu.', null, null, 'mod7@test.be', 'pl', true) \gset
select case_number as mcase1 from public.reports where id = :'mr1' \gset
reset role;

-- MOD42-1: tylko admin decyduje; klient nie czyta decyzji ani nie flaguje.
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_decide_report(''' || :'mr1' || ''', ''open'', ''no_action'', ''Fakty opisane wystarczająco długo.'')',
  'permission denied', 'MOD42-1 anon bez EXECUTE admin_decide_report');
reset role;
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_decide_report(''' || :'mr1' || ''', ''open'', ''no_action'', ''Fakty opisane wystarczająco długo.'')',
  'PERMISSION_DENIED', 'MOD42-1b pracodawca nie decyduje o sprawie');
select pg_temp.expect_error('select count(*) from public.moderation_decisions', 'permission denied',
  'MOD42-1c klient nie czyta tabeli decyzji');
select pg_temp.expect_error('select public.flag_report_for_review(''' || :'mr7' || ''', 3, ''x'')',
  'permission denied', 'MOD42-1d klient nie ustawia priorytetu przeglądu');
select pg_temp.expect_error(
  'update public.jobs set moderation_decision_id = gen_random_uuid() where id = ''' || :'MODJ1' || '''',
  'blokadę moderacyjną', 'MOD42-1e pracodawca nie ustawia blokady moderacyjnej');
reset role; reset app.current_uid;

-- MOD42-2 (regresja): sam status nie rozstrzyga sprawy DSA — treść zostałaby publiczna.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.admin_resolve_report(''' || :'mr1' || ''', ''resolved'', ''open'')',
  'INVALID_TRANSITION', 'MOD42-2 admin_resolve_report nie zamyka sprawy DSA bez decyzji');
select pg_temp.expect_error('select public.admin_resolve_report(''' || :'mr1' || ''', ''dismissed'', ''open'')',
  'INVALID_TRANSITION', 'MOD42-2b ani nie oddala jej bez decyzji');
reset role; reset app.current_uid;
select pg_temp.assert((select status::text from public.reports where id = :'mr1') = 'open'
  and public.job_is_public(:'MODJ1'), 'MOD42-2c sprawa otwarta, treść bez zmian');
-- Kontrola ujemna: bez strażnika (stan sprzed #42) status „resolved” zapisuje się, a oferta
-- zostaje publiczna — dokładnie błąd, który naprawia decyzja z egzekucją.
begin;
alter table public.reports disable trigger trg_reports_decision_guard;
set local role authenticated; set local app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_resolve_report(:'mr1', 'resolved', 'open');
reset role;
select pg_temp.assert((select status::text from public.reports where id = :'mr1') = 'resolved'
  and public.job_is_public(:'MODJ1'),
  'MOD42-2d kontrola ujemna: bez strażnika sprawa „rozstrzygnięta”, a oferta nadal publiczna');
rollback;

-- MOD42-3: walidacja decyzji (bez skutków).
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_decide_report(''' || :'mr1' || ''', ''open'', ''job_removed'', ''za krótko'', ''terms'', ''§ 4'')',
  'FACTS_REQUIRED', 'MOD42-3 fakty wymagane');
select pg_temp.expect_error(
  'select public.admin_decide_report(''' || :'mr1' || ''', ''open'', ''job_removed'', ''' || :'MODFACTS' || ''')',
  'GROUND_REQUIRED', 'MOD42-3b ograniczenie wymaga podstawy');
select pg_temp.expect_error(
  'select public.admin_decide_report(''' || :'mr1' || ''', ''open'', ''job_removed'', ''' || :'MODFACTS' || ''', ''terms'', null)',
  'GROUND_REFERENCE_REQUIRED', 'MOD42-3c ograniczenie wymaga wskazania postanowienia');
select pg_temp.expect_error(
  'select public.admin_decide_report(''' || :'mr3' || ''', ''open'', ''job_removed'', ''' || :'MODFACTS' || ''', ''terms'', ''§ 4'')',
  'DECISION_SCOPE', 'MOD42-3d zgłoszenie firmy nie usuwa pojedynczej oferty');
select pg_temp.expect_error(
  'select public.admin_decide_report(''' || :'mr1' || ''', ''reviewing'', ''job_removed'', ''' || :'MODFACTS' || ''', ''terms'', ''§ 4'')',
  'STALE_STATE', 'MOD42-3e nieaktualny status sprawy → STALE_STATE');
select pg_temp.expect_error(
  'select public.admin_decide_report(''' || :'mr1' || ''', ''open'', ''ban'', ''' || :'MODFACTS' || ''', ''terms'', ''§ 4'')',
  'VALIDATION_FAILED', 'MOD42-3f nieznany rodzaj decyzji');
reset role; reset app.current_uid;
select pg_temp.assert((select count(*) from public.moderation_decisions) = 0
  and public.job_is_public(:'MODJ1'), 'MOD42-3g odrzucone decyzje bez zapisu i skutku');

-- MOD42-4: decyzja „oferta wycofana” — skutek, sprawa, historia, audyt, powiadomienia.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_decide_report(:'mr1', 'open', 'job_removed', :'MODFACTS', 'terms', 'Regulamin § 4 ust. 2', true) as md1 \gset
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'closed' and moderation_decision_id = :'md1'::uuid from public.jobs where id = :'MODJ1')
  and not public.job_is_public(:'MODJ1')
  and not exists (select 1 from public.get_public_jobs('pl', p_limit => 100, p_offset => 0) g where g.id = :'MODJ1'),
  'MOD42-4 oferta wycofana z publicznego widoku i zablokowana decyzją');
select pg_temp.assert(
  (select status::text = 'resolved' and decision_id = :'md1'::uuid and resolved_by = :'ADMIN'::uuid
     from public.reports where id = :'mr1'),
  'MOD42-4b sprawa rozstrzygnięta tą decyzją');
select pg_temp.assert(
  (select decision = 'job_removed' and job_id = :'MODJ1'::uuid and company_id = :'MODCA'::uuid
          and facts = :'MODFACTS' and ground_type = 'terms' and ground_reference = 'Regulamin § 4 ust. 2'
          and automated_detection and not automated_decision and decided_by = :'ADMIN'::uuid
          and previous_status = 'active' and reference ~ '^DEC-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
     from public.moderation_decisions where id = :'md1'),
  'MOD42-4c uzasadnienie: rodzaj, zasięg, fakty, podstawa, automatyzacja, człowiek, stan sprzed');
select pg_temp.assert(
  (select count(*) from public.report_events where report_id = :'mr1' and event_type = 'decision'
     and decision_id = :'md1'::uuid and to_status = 'resolved') = 1
  and (select count(*) from public.report_events where report_id = :'mr1' and event_type = 'status_changed'
     and to_status = 'resolved' and actor_id = :'ADMIN'::uuid) = 1,
  'MOD42-4d historia sprawy: decyzja i zmiana statusu');
select pg_temp.assert(
  (select count(*) from public.audit_logs where action = 'moderation.decided' and entity_id = :'mr1'
     and actor_id = :'ADMIN'::uuid and after_data->>'decisionId' = :'md1' and after_data->>'jobId' = :'MODJ1') = 1,
  'MOD42-4e wpis audytu decyzji');
select pg_temp.assert(
  (select count(*) from public.notifications where profile_id = :'EMPA' and data->>'kind' = 'moderation'
     and data->>'decisionId' = :'md1') = 1
  and (select count(*) from public.email_deliveries where profile_id = :'EMPA' and template = 'moderationJobRemoved'
     and entity_id = :'md1' and locale = 'nl' and payload->>'facts' = :'MODFACTS'
     and payload->>'groundReference' = 'Regulamin § 4 ust. 2' and payload->>'jobTitle' = 'Magazynier M1') = 1,
  'MOD42-4f autor: powiadomienie i uzasadnienie e-mailem w JEGO języku (nl)');
select pg_temp.assert(
  (select count(*) from public.email_deliveries where to_email = 'mod1@test.be' and template = 'reportDecisionActioned'
     and locale = 'fr' and entity_id = :'mr1' and payload->>'caseNumber' = :'mcase1'
     and not (payload ? 'facts') and not (payload ? 'companyName') and not (payload ? 'groundReference')) = 1,
  'MOD42-4g zgłaszający: sam wynik, bez uzasadnienia i danych autora, w jego języku (fr)');
set role service_role;
select public.get_report_case(:'mcase1', 'ABCDEFGHIJKLMNOPQRSTUVWX') as mlookup1 \gset
reset role;
select pg_temp.assert((:'mlookup1'::jsonb)->>'outcome' = 'action_taken'
  and (:'mlookup1'::jsonb)->>'status' = 'resolved'
  and position(:'MODFACTS' in :'mlookup1') = 0,
  'MOD42-4h sprawdzenie sprawy: wynik bez uzasadnienia');

-- MOD42-5: blokada — pracodawca, admin i właściciel tabel nie przywrócą treści statusem.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.set_job_status(''' || :'MODJ1' || ''', ''reopen'')',
  'MODERATION_LOCKED', 'MOD42-5 pracodawca nie otworzy ponownie wycofanej oferty');
reset role; reset app.current_uid;
select pg_temp.expect_error('update public.jobs set status = ''active'' where id = ''' || :'MODJ1' || '''',
  'MODERATION_LOCKED', 'MOD42-5b właściciel tabel nie zmieni statusu zablokowanej oferty');
select pg_temp.expect_error('update public.jobs set moderation_decision_id = null where id = ''' || :'MODJ1' || '''',
  'blokadę moderacyjną', 'MOD42-5c blokady nie zdejmuje się z pominięciem przywrócenia');
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_decide_report(''' || :'mr1' || ''', ''resolved'', ''no_action'', ''' || :'MODFACTS' || ''')',
  'INVALID_TRANSITION', 'MOD42-5d druga decyzja w rozstrzygniętej sprawie odrzucona');
select pg_temp.expect_error('select public.admin_resolve_report(''' || :'mr1' || ''', ''reviewing'', ''resolved'')',
  'INVALID_TRANSITION', 'MOD42-5e rozstrzygniętej sprawy DSA nie otwiera zmiana statusu');
reset role; reset app.current_uid;

-- MOD42-6: decyzja niezmienna; decyzja bez skutku odrzucana przy COMMIT także poza RPC.
select pg_temp.expect_error('update public.moderation_decisions set facts = ''podmiana faktów decyzji'' where id = ''' || :'md1' || '''',
  'niezmienna', 'MOD42-6 fakty decyzji niezmienne');
select pg_temp.expect_error('delete from public.moderation_decisions where id = ''' || :'md1' || '''',
  'niezmienna', 'MOD42-6b decyzji nie można usunąć');
begin;
set constraints all immediate;
select pg_temp.expect_error(
  'insert into public.moderation_decisions(reference, report_id, decision, job_id, company_id, facts, ground_type, ground_reference)
   values (''DEC-TEST-0000-0001'', ''' || :'mr6' || ''', ''job_removed'', ''' || :'MODJ4' || ''', ''' || :'MODCA' || ''', '''
   || :'MODFACTS' || ''', ''terms'', ''§ 4'')',
  'MODERATION_EFFECT_MISSING', 'MOD42-6c decyzja bez wykonanego skutku nie zapisze się');
rollback;
select pg_temp.expect_error('update public.reports set status = ''resolved'' where id = ''' || :'mr6' || '''',
  'INVALID_TRANSITION', 'MOD42-6d sprawy DSA nie zamyka bezpośredni zapis statusu');

-- MOD42-7: awaria egzekucji cofa całą transakcję — sprawa otwarta, zero skutków.
create function pg_temp.mod_fail_job() returns trigger language plpgsql as $$
begin
  if new.id = 'e9600000-0000-0000-0000-0000000000b4'::uuid then raise exception 'INJECTED_ENFORCEMENT_FAILURE'; end if;
  return new;
end $$;
create trigger trg_mod_fail before update on public.jobs for each row execute function pg_temp.mod_fail_job();
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.admin_decide_report(''' || :'mr6' || ''', ''open'', ''job_removed'', ''' || :'MODFACTS' || ''', ''law'', ''Art. 1'')',
  'INJECTED_ENFORCEMENT_FAILURE', 'MOD42-7 awaria egzekucji przerywa decyzję');
reset role; reset app.current_uid;
drop trigger trg_mod_fail on public.jobs;
select pg_temp.assert(
  (select status::text = 'open' and decision_id is null from public.reports where id = :'mr6')
  and (select count(*) from public.moderation_decisions where report_id = :'mr6') = 0
  and (select count(*) from public.report_events where report_id = :'mr6' and event_type <> 'submitted') = 0
  and (select count(*) from public.email_deliveries where entity_id = :'mr6' and template like 'reportDecision%') = 0
  and (select count(*) from public.audit_logs where action = 'moderation.decided' and entity_id = :'mr6') = 0
  and public.job_is_public(:'MODJ4'),
  'MOD42-7b po awarii: sprawa otwarta, brak decyzji, historii, e-maili i audytu, treść bez zmian');

-- MOD42-8: brak działań — sprawa oddalona, treść publiczna, autor nie jest powiadamiany.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_decide_report(:'mr2', 'open', 'no_action', 'Treść oferty nie narusza regulaminu ani prawa.') as md2 \gset
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'dismissed' and decision_id = :'md2'::uuid from public.reports where id = :'mr2')
  and public.job_is_public(:'MODJ2')
  and (select ground_type is null and company_id is null from public.moderation_decisions where id = :'md2'),
  'MOD42-8 brak działań: sprawa oddalona, oferta publiczna');
select pg_temp.assert(
  (select count(*) from public.email_deliveries where entity_id = :'md2') = 0
  and (select count(*) from public.notifications where data->>'decisionId' = :'md2') = 0
  and (select count(*) from public.email_deliveries where entity_id = :'mr2' and template = 'reportDecisionNoAction'
         and locale = 'pl' and to_email = 'mod2@test.be') = 1,
  'MOD42-8b tylko zgłaszający dostaje wynik — w języku profilu (pl), nie formularza (en)');

-- MOD42-9: zawieszenie firmy — oferty znikają, admin nie przywróci statusem.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_decide_report(:'mr3', 'open', 'company_suspended',
  'Firma podaje dane innego, znanego pracodawcy.', 'law', 'Art. 1 ustawy (do uzupełnienia)') as md3 \gset
select pg_temp.expect_error(
  'select public.admin_set_company_status(''' || :'MODCO' || ''', ''verified'', ''suspended'')',
  'MODERATION_LOCKED', 'MOD42-9 admin nie przywróci firmy zmianą statusu');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'suspended' and moderation_decision_id = :'md3'::uuid
          and status_reason = 'Firma podaje dane innego, znanego pracodawcy.' from public.companies where id = :'MODCO')
  and not exists (select 1 from public.get_public_jobs('pl', p_limit => 100, p_offset => 0) g where g.id = :'MODJ3'),
  'MOD42-9b firma zawieszona i zablokowana, jej oferty poza listą');
select pg_temp.assert(
  (select count(*) from public.email_deliveries where profile_id = :'EMPB' and template = 'moderationCompanySuspended'
     and entity_id = :'md3' and locale = 'fr') = 1
  and (select count(*) from public.email_deliveries where to_email = 'mod3@test.be'
     and template = 'reportDecisionActioned' and locale = 'nl') = 1,
  'MOD42-9c właściciel (fr) i zgłaszający (nl) — każdy w swoim języku');

-- MOD42-10: dwie równoległe decyzje w tej samej sprawie → jedna wygrywa, druga STALE_STATE.
select 'select public.admin_decide_report(''' || :'mr5' || ''', ''open'', ''job_removed'', ''' || :'MODFACTS'
  || ''', ''terms'', ''§ 4'')::text' as mod_race_a \gset
select 'select public.admin_decide_report(''' || :'mr5' || ''', ''open'', ''no_action'', ''Treść nie narusza regulaminu serwisu.'')::text'
  as mod_race_b \gset
select pg_temp.remote_begin('mod_a', :'ADMIN') as mod_pid_a \gset
select pg_temp.remote_begin('mod_b', :'ADMIN') as mod_pid_b \gset
select t.v as mod_res_a from dbl.dblink('mod_a', :'mod_race_a') as t(v text) \gset
select dbl.dblink_send_query('mod_b', :'mod_race_b');
select pg_temp.wait_blocked(:mod_pid_b, 'MOD42-10');
select dbl.dblink_exec('mod_a', 'commit');
select pg_temp.remote_result('mod_b') as mod_res_b \gset
select dbl.dblink_exec('mod_b', 'rollback');
select dbl.dblink_disconnect('mod_a'); select dbl.dblink_disconnect('mod_b');
select pg_temp.assert(position('STALE_STATE' in :'mod_res_b') > 0, 'MOD42-10 druga decyzja → STALE_STATE');
select pg_temp.assert(
  (select count(*) from public.moderation_decisions where report_id = :'mr5') = 1
  and (select decision_id = :'mod_res_a'::uuid and status::text = 'resolved' from public.reports where id = :'mr5')
  and (select status::text = 'closed' from public.jobs where id = :'MODJ5')
  and (select count(*) from public.email_deliveries where entity_id = :'mr5' and template like 'reportDecision%') = 1,
  'MOD42-10b jedna decyzja, jeden skutek, jeden wynik dla zgłaszającego');

-- MOD42-11: druga decyzja o już wycofanej ofercie; przywrócenie przekazuje blokadę dalej.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_decide_report(:'mr4', 'open', 'job_removed', :'MODFACTS', 'terms', 'Regulamin § 4 ust. 2') as md4 \gset
reset role; reset app.current_uid;
select pg_temp.assert(
  (select moderation_decision_id = :'md1'::uuid and status::text = 'closed' from public.jobs where id = :'MODJ1')
  and (select previous_status = 'active' from public.moderation_decisions where id = :'md4'),
  'MOD42-11 skutek już w mocy: blokada bez zmian, stan sprzed pierwszego ograniczenia');
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.admin_restore_moderation(''' || :'md1' || ''', ''za krótko'')',
  'REASON_REQUIRED', 'MOD42-11b przywrócenie wymaga uzasadnienia');
select pg_temp.expect_error('select public.admin_restore_moderation(''' || :'md2' || ''', ''Brak ograniczenia do cofnięcia tutaj.'')',
  'INVALID_TRANSITION', 'MOD42-11c decyzji bez ograniczenia nie przywraca się');
select public.admin_restore_moderation(:'md1', 'Autor usunął wymóg opłaty i wyjaśnił sprawę.') as mrest1 \gset
reset role; reset app.current_uid;
select pg_temp.assert(
  (select moderation_decision_id = :'md4'::uuid and status::text = 'closed' from public.jobs where id = :'MODJ1')
  and not public.job_is_public(:'MODJ1'),
  'MOD42-11d inna aktywna decyzja przejmuje blokadę — oferta nadal wycofana');
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.admin_restore_moderation(''' || :'md4' || ''', ''Pracodawca próbuje sam przywrócić.'')',
  'PERMISSION_DENIED', 'MOD42-11e pracodawca nie przywraca treści');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_restore_moderation(:'md4', 'Autor usunął wymóg opłaty i wyjaśnił sprawę.') as mrest4 \gset
select pg_temp.expect_error('select public.admin_restore_moderation(''' || :'md4' || ''', ''Autor usunął wymóg opłaty i wyjaśnił sprawę.'')',
  'STALE_STATE', 'MOD42-11f ponowne przywrócenie → STALE_STATE');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select moderation_decision_id is null and status::text = 'active' from public.jobs where id = :'MODJ1')
  and public.job_is_public(:'MODJ1'),
  'MOD42-11g po cofnięciu ostatniej decyzji oferta wraca do stanu sprzed ograniczenia');
-- Kontrola do MOD42-5: bez blokady ta sama oferta zamyka się i otwiera ponownie.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.set_job_status(:'MODJ1'::uuid, 'close');
select pg_temp.assert(public.set_job_status(:'MODJ1'::uuid, 'reopen') = 'active',
  'MOD42-11g2 kontrola: po przywróceniu reopen działa (wcześniej blokowała go tylko decyzja)');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.report_events where decision_id in (:'md1'::uuid, :'md4'::uuid) and event_type = 'restored') = 2
  and (select count(*) from public.audit_logs where action = 'moderation.restored' and entity_id in (:'mr1'::uuid, :'mr4'::uuid)) = 2
  and (select count(*) from public.email_deliveries where profile_id = :'EMPA' and template = 'moderationRestored'
         and locale = 'nl' and entity_id in (:'md1'::uuid, :'md4'::uuid)) = 2
  and (select status::text from public.reports where id = :'mr1') = 'resolved',
  'MOD42-11h przywrócenie: historia, audyt, e-mail do autora; sprawa pozostaje rozstrzygnięta');

-- MOD42-12: przywrócenie firmy.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_restore_moderation(:'md3', 'Firma wykazała, że jest uprawnionym pracodawcą.') as mrest3 \gset
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status::text = 'verified' and moderation_decision_id is null and status_reason is null
     from public.companies where id = :'MODCO')
  and exists (select 1 from public.get_public_jobs('pl', p_limit => 100, p_offset => 0) g where g.id = :'MODJ3'),
  'MOD42-12 firma przywrócona do stanu sprzed zawieszenia, oferty wracają');

-- MOD42-13: kolejka przeglądu — automat tylko flaguje, niczego nie rozstrzyga.
set role service_role;
select public.flag_report_for_review(:'mr7', 3, 'Wykryto podobieństwo do znanych oszustw');
reset role;
select pg_temp.assert(
  (select review_priority = 3 and review_flag = 'Wykryto podobieństwo do znanych oszustw'
          and status::text = 'open' and decision_id is null from public.reports where id = :'mr7')
  and (select count(*) from public.report_events where report_id = :'mr7' and event_type = 'flagged') = 1
  and public.job_is_public(:'MODJ4'),
  'MOD42-13 flaga i priorytet bez decyzji i bez skutku');
select pg_temp.expect_error('update public.reports set review_priority = 0 where id = ''' || :'mr7' || '''',
  'priorytet przeglądu', 'MOD42-13b priorytet tylko przez RPC flagi');
set role service_role;
select pg_temp.expect_error('select public.flag_report_for_review(''' || :'mr1' || ''', 1, null)',
  'NOT_FOUND', 'MOD42-13c rozstrzygniętej sprawy się nie flaguje');
reset role;

-- MOD42-14: uzasadnienie dostępne autorowi (właściciel/admin firmy), nikomu innemu.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.get_company_moderation_decisions(:'MODCA')) = 3
  and (select bool_and(facts = :'MODFACTS' and restored_at is not null)
         from public.get_company_moderation_decisions(:'MODCA') where job_id = :'MODJ1'),
  'MOD42-14 autor widzi swoje decyzje z uzasadnieniem i przywróceniem');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.get_company_moderation_decisions(:'MODCA')) = 0,
  'MOD42-14b kandydat nie widzi decyzji firmy');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.get_company_moderation_decisions(:'MODCA')) = 0
  and (select count(*) from public.get_company_moderation_decisions(:'MODCO')) = 1,
  'MOD42-14c inna firma nie widzi cudzych decyzji');
reset role; reset app.current_uid;
-- MOD42-14d: panel admina czyta decyzje i przywrócenia (service_role po potwierdzeniu roli).
set role service_role;
select pg_temp.assert((select count(*) from public.moderation_decisions) = 5
  and (select count(*) from public.moderation_restorations) = 3,
  'MOD42-14d service_role czyta decyzje i przywrócenia');
reset role;

-- ============================================================================
-- CS493. #493 — osobno: regulamin, informacja o prywatności, zgody opcjonalne (0108)
-- ============================================================================
\set CS1 'c4930000-0000-0000-0000-000000000001'
\set CS2 'c4930000-0000-0000-0000-000000000002'
\set CS3 'c4930000-0000-0000-0000-000000000003'
\set CS4 'c4930000-0000-0000-0000-000000000004'
\set CS5 'c4930000-0000-0000-0000-000000000005'
-- Konta bez markera receiptu (profil z triggera, bez akceptacji).
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'CS1','cs1@test.be','Cs One','{"role":"candidate","first_name":"Cs","last_name":"One","locale":"nl"}'),
  (:'CS2','cs2@test.be','Cs Two','{"role":"employer","first_name":"Cs","last_name":"Two","locale":"fr"}');

-- CS493-0: wiersze sprzed #493 i dawne API = legacy_combined (znaczenie zachowane).
select pg_temp.assert(
  (select bool_and(kind = 'legacy_combined' and source is null)
     from public.document_acceptances where profile_id = :'CANDA'),
  'CS493-0 dawny wspólny checkbox zapisany jako legacy_combined');

-- CS493-1: klient nie pisze receiptów ani nie woła RPC zapisu.
set role authenticated; set app.current_uid = :'CS1'; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'insert into public.document_acceptances (profile_id, document, kind) values ('''
    || :'CS1' || ''', ''terms'', ''terms_acceptance'')',
  'permission denied', 'CS493-1 authenticated nie pisze document_acceptances');
select pg_temp.expect_error(
  'select public.record_signup_consents(''' || :'CS1' || ''', true, true, ''{}'', ''signup'')',
  'permission denied', 'CS493-1b authenticated nie woła record_signup_consents');
reset role; reset app.current_uid;
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error(
  'select public.record_signup_consents(''' || :'CS1' || ''', true, true, ''{}'', ''signup'')',
  'permission denied', 'CS493-1c anon nie woła record_signup_consents');
reset role;

-- CS493-2: regulamin i informacja o prywatności są wymagane; nieznany cel = błąd; bez zapisu.
set role service_role;
select pg_temp.expect_error(
  'select public.record_signup_consents(''' || :'CS1' || ''', false, true, ''{}'', ''signup'')',
  'VALIDATION_FAILED', 'CS493-2 bez akceptacji regulaminu');
select pg_temp.expect_error(
  'select public.record_signup_consents(''' || :'CS1' || ''', true, false, ''{}'', ''signup'')',
  'VALIDATION_FAILED', 'CS493-2b bez potwierdzenia informacji o prywatności');
select pg_temp.expect_error(
  'select public.record_signup_consents(''' || :'CS1' || ''', true, true, ''{"ai_matching": true}'', ''signup'')',
  'VALIDATION_FAILED', 'CS493-2c cel spoza listy');
select pg_temp.expect_error(
  'select public.record_signup_consents(''' || :'CS1' || ''', true, true, ''{"email_marketing": "yes"}'', ''signup'')',
  'VALIDATION_FAILED', 'CS493-2d wybór nie-boolean');
select pg_temp.expect_error(
  'select public.record_signup_consents(''' || :'CS1' || ''', true, true, ''{}'', ''cookie_banner'')',
  'VALIDATION_FAILED', 'CS493-2e kanał spoza listy');
reset role;
select pg_temp.assert(
  (select count(*) from public.document_acceptances where profile_id = :'CS1') = 0
  and (select count(*) from public.email_consent_events where profile_id = :'CS1') = 0,
  'CS493-2f odrzucone wywołania nie zostawiają receiptu');

-- CS493-3: odmowa zgody opcjonalnej nie blokuje; każdy element osobno; zgoda nie jest włączana.
set role service_role;
select public.record_signup_consents(:'CS1', true, true, '{"email_marketing": false}', 'signup', 'nl',
  '{"terms": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "privacy": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "email_marketing": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}',
  '203.0.113.9', 'UA/2.0');
reset role;
select pg_temp.assert(
  (select count(*) from public.document_acceptances where profile_id = :'CS1') = 2
  and exists (select 1 from public.document_acceptances where profile_id = :'CS1'
               and document = 'terms' and kind = 'terms_acceptance' and source = 'signup'
               and locale = 'nl' and document_version = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' and ip_address = '203.0.113.9')
  and exists (select 1 from public.document_acceptances where profile_id = :'CS1'
               and document = 'privacy' and kind = 'privacy_notice_ack' and source = 'signup'),
  'CS493-3 regulamin i informacja o prywatności jako osobne receipty z wersją i kanałem');
select pg_temp.assert(
  (select count(*) from public.email_consent_events where profile_id = :'CS1') = 0,
  'CS493-3b odmowa nie tworzy zdarzenia zgody (#513: dziennik zapisuje tylko zmiany)');
select pg_temp.assert(
  coalesce((select email_marketing from public.notification_preferences where profile_id = :'CS1'), false) = false,
  'CS493-3c odmowa nie włącza marketingu');

-- CS493-4: zgoda włącza kategorię (wycofanie = ustawienia powiadomień).
set role service_role;
select public.record_signup_consents(:'CS2', true, true, '{"email_marketing": true}', 'signup', 'fr',
  '{"email_marketing": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}', null, null);
reset role;
select pg_temp.assert(
  (select email_marketing from public.notification_preferences where profile_id = :'CS2') = true
  and (select count(*) from public.email_consent_events where profile_id = :'CS2') = 1
  and (select granted and category = 'marketing' and source = 'signup' and locale = 'fr'
              and wording_version = 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
         from public.email_consent_events where profile_id = :'CS2'),
  'CS493-4 zgoda na marketing: kategoria włączona, zdarzenie #513 ze źródłem signup i wersją treści');
-- Kontekst źródła nie przecieka na kolejne zapisy w tej samej transakcji.
select pg_temp.assert(
  public.email_consent_context('source') is null and public.email_consent_context('wording') is null,
  'CS493-4a kontekst signup wyczyszczony po zapisie');
set role authenticated; set app.current_uid = :'CS2'; select pg_temp.assert_client_role();
select public.set_notification_preferences(
  '{"email_applications": true, "email_offers": true, "email_messages": true, "email_job_matches": true,
    "email_marketing": false, "push_enabled": true, "in_app_enabled": true}', 'fr', null);
select pg_temp.assert(
  (select email_marketing from public.notification_preferences where profile_id = :'CS2') = false
  and (select count(*) from public.email_consent_events) = 2
  and exists (select 1 from public.email_consent_events where category = 'marketing'
               and not granted and source = 'settings'),
  'CS493-4b wycofanie w ustawieniach (RPC #513); użytkownik widzi tylko własny dowód');
reset role; reset app.current_uid;

-- CS493-5: onboarding bez pokazanych zgód opcjonalnych nie tworzy fałszywego dowodu.
set role service_role;
select public.record_signup_consents(:'CS1', true, true, '{}', 'onboarding', 'nl', '{}', null, null);
reset role;
select pg_temp.assert(
  (select count(*) from public.email_consent_events where profile_id = :'CS1') = 0
  and (select count(*) from public.document_acceptances where profile_id = :'CS1' and source = 'onboarding') = 2,
  'CS493-5 onboarding: tylko regulamin + informacja, bez zgody na inne cele');

-- CS493-6: receipty są niezmienne dla każdej roli (także właściciela tabel).
select pg_temp.expect_error(
  'update public.document_acceptances set kind = ''legacy_combined'' where profile_id = ''' || :'CS1' || '''',
  'CONSENT_RECEIPT_IMMUTABLE', 'CS493-6 document_acceptances bez UPDATE');
select pg_temp.expect_error(
  'delete from public.document_acceptances where profile_id = ''' || :'CS1' || '''',
  'CONSENT_RECEIPT_IMMUTABLE', 'CS493-6b document_acceptances bez DELETE');
-- Kontrola ujemna: bez triggera przepisanie akceptacji regulaminu na dawny wpis przechodzi.
begin;
drop trigger document_acceptances_immutable on public.document_acceptances;
update public.document_acceptances set kind = 'legacy_combined', source = null where profile_id = :'CS1';
select pg_temp.assert(
  not exists (select 1 from public.document_acceptances where profile_id = :'CS1' and kind <> 'legacy_combined'),
  'CS493-6d kontrola ujemna: bez triggera znaczenie receiptu dałoby się przepisać');
rollback;
-- Kontrola ujemna: bez źródła 'signup' w triggerze 0101 zgoda z rejestracji byłaby 'direct'.
begin;
create or replace function public.record_email_consent_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $f$
begin
  insert into public.email_consent_events (profile_id, category, granted, source, locale)
  values (new.profile_id, 'marketing', new.email_marketing, 'direct', 'pl');
  return null;
end $f$;
set role service_role;
select public.record_signup_consents(:'CS1', true, true, '{"email_marketing": true}', 'signup', 'nl', '{}', null, null);
reset role;
select pg_temp.assert(
  not exists (select 1 from public.email_consent_events where profile_id = :'CS1' and source = 'signup'),
  'CS493-6e kontrola ujemna: trigger bez źródła signup nie daje dowodu z rejestracji');
rollback;

-- CS493-7: Better Auth, marker v2 — osobne receipty, zgoda opcjonalna z formularza.
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'CS3','cs3@test.be','Cs Three', jsonb_build_object('role','candidate','first_name','Cs','last_name','Three',
    'locale','en','signup_receipt_version',2,'agree_terms',true,'privacy_notice_ack',true,
    'optional_consents', jsonb_build_object('email_marketing', true),
    'consent_wording', jsonb_build_object('terms','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','privacy','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','email_marketing','sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')));
select pg_temp.assert(
  (select array_agg(kind order by kind) from public.document_acceptances where profile_id = :'CS3')
    = array['privacy_notice_ack','terms_acceptance']
  and (select granted and source = 'signup' and locale = 'en' and wording_version = 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
         from public.email_consent_events where profile_id = :'CS3' and category = 'marketing')
  and (select email_marketing from public.notification_preferences where profile_id = :'CS3'),
  'CS493-7 rejestracja v2: dwa osobne receipty + zgoda opcjonalna');
-- v2 bez potwierdzenia informacji o prywatności albo z celem spoza listy = brak konta.
select pg_temp.expect_error(format(
  'insert into auth.users(id,email,name,raw_user_meta_data) values (%L,%L,%L,%L::jsonb)',
  :'CS4', 'cs4@test.be', 'Cs Four',
  '{"role":"employer","first_name":"Cs","last_name":"Four","locale":"pl","signup_receipt_version":2,"agree_terms":true}'),
  'VALIDATION_FAILED', 'CS493-7b v2 bez potwierdzenia informacji o prywatności');
select pg_temp.expect_error(format(
  'insert into auth.users(id,email,name,raw_user_meta_data) values (%L,%L,%L,%L::jsonb)',
  :'CS4', 'cs4@test.be', 'Cs Four',
  '{"role":"employer","first_name":"Cs","last_name":"Four","locale":"pl","signup_receipt_version":2,"agree_terms":true,"privacy_notice_ack":true,"optional_consents":{"profile_ai":true}}'),
  'VALIDATION_FAILED', 'CS493-7c v2 z celem spoza listy');
select pg_temp.expect_error(format(
  'insert into auth.users(id,email,name,raw_user_meta_data) values (%L,%L,%L,%L::jsonb)',
  :'CS4', 'cs4@test.be', 'Cs Four',
  '{"role":"employer","first_name":"Cs","last_name":"Four","locale":"pl","signup_receipt_version":null,"agree_terms":true}'),
  'VALIDATION_FAILED', 'CS493-7d marker null');
select pg_temp.assert(
  not exists (select 1 from auth.users where id = :'CS4')
  and not exists (select 1 from public.profiles where id = :'CS4'),
  'CS493-7e odrzucona rejestracja nie zostawia konta');
-- v2 bez zgody opcjonalnej: konto powstaje, marketing wyłączony, brak dowodu zgody.
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'CS5','cs5@test.be','Cs Five','{"role":"employer","first_name":"Cs","last_name":"Five","locale":"pl","signup_receipt_version":2,"agree_terms":true,"privacy_notice_ack":true}');
select pg_temp.assert(
  (select count(*) from public.document_acceptances where profile_id = :'CS5') = 2
  and (select count(*) from public.email_consent_events where profile_id = :'CS5') = 0
  and coalesce((select email_marketing from public.notification_preferences where profile_id = :'CS5'), false) = false,
  'CS493-7f brak zgody opcjonalnej nie blokuje konta');

-- CS493-8: usunięcie konta (kaskada) usuwa receipty mimo niezmienności.
delete from auth.users where id = :'CS5';
select pg_temp.assert(
  not exists (select 1 from public.document_acceptances where profile_id = :'CS5')
  and not exists (select 1 from public.profiles where id = :'CS5'),
  'CS493-8 kaskada usunięcia konta usuwa receipty');
delete from auth.users where id = :'CS3';
select pg_temp.assert(
  not exists (select 1 from public.email_consent_events where profile_id = :'CS3'),
  'CS493-8b kaskada usuwa dowód zgód opcjonalnych (#513)');
-- DR486. Retencja, eksport danych kandydata, usunięcie konta, kolejka storage,
--        ponowne usunięcie po odtworzeniu kopii (0105)
-- ============================================================================
\echo '--- DR486 retencja i prawa kandydata ---'
\set RD1 'd4860000-0000-4000-8000-000000000001'
\set RD2 'd4860000-0000-4000-8000-000000000002'
\set RD3 'd4860000-0000-4000-8000-000000000003'
\set RD4 'd4860000-0000-4000-8000-000000000004'
\set RDF1 'd4860000-0000-4000-8000-0000000000f1'
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'RD1','rd1@test.be','Rita D','{"role":"candidate","first_name":"Rita","last_name":"D","locale":"fr"}'),
  (:'RD2','rd2@test.be','Rob E','{"role":"candidate","first_name":"Rob","last_name":"E","locale":"nl"}'),
  (:'RD3','rd3@test.be','Ron F','{"role":"candidate","first_name":"Ron","last_name":"F","locale":"en"}'),
  (:'RD4','rd4@test.be','Rea G','{"role":"candidate","first_name":"Rea","last_name":"G","locale":"pl"}');
insert into public.candidate_profiles(profile_id, is_searchable) values
  (:'RD1', true), (:'RD2', true), (:'RD3', false), (:'RD4', false);
\set RDCO 'd4860000-0000-4000-8000-0000000000c0'
\set RDJ  'd4860000-0000-4000-8000-0000000000a1'
\set RDJ2 'd4860000-0000-4000-8000-0000000000a2'
insert into public.companies(id, name, status) values (:'RDCO', 'Firma Retencja', 'verified');
insert into public.company_members(company_id, profile_id, role, is_active) values (:'RDCO', :'EMPA', 'owner', true);
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'RDJ', :'RDCO', 'rd-job-1', 'Operator RD', 'warehouse', 'permanent', 'Antwerpia', 'Flandria', 'active', 'pl'),
  (:'RDJ2', :'RDCO', 'rd-job-2', 'Kierowca RD', 'transport', 'permanent', 'Gandawa', 'Flandria', 'active', 'pl');
insert into auth.sessions(id, user_id, token, expires_at)
  values (gen_random_uuid(), :'RD1', 'rd1-session-token', now() + interval '1 day');

-- Proces RD1 z firmą A: aplikacja, propozycja, rozmowa w obie strony, dopasowanie, CV.
set role authenticated; set app.current_uid = :'RD1'; select pg_temp.assert_client_role();
select public.apply_to_job(:'RDJ', 'rd1-apply', null, null, 'Proszę o kontakt') as rdapp1 \gset
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'RD2'; select pg_temp.assert_client_role();
select public.apply_to_job(:'RDJ', 'rd2-apply', null, null, 'Cudza aplikacja') as rdapp2 \gset
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select public.send_offer(:'RDJ'::uuid, :'RD1'::uuid, 'rd1-offer', 'Zapraszamy na rozmowę', null) as rdoff1 \gset
select public.get_or_create_conversation(:'rdapp1'::uuid, null) as rdconv1 \gset
select public.send_message(:'rdconv1'::uuid, 'Wiadomość rekrutera', gen_random_uuid());
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'RD1'; select pg_temp.assert_client_role();
select public.send_message(:'rdconv1'::uuid, 'Odpowiedź kandydata', gen_random_uuid());
reset role; reset app.current_uid;
insert into public.matches(candidate_id, job_id, score, matched, missing, strengths)
  values (:'RD1', :'RDJ', 72, '{warehouse}', '{forklift}', '{availability}');
insert into public.files(id, owner_id, bucket, path, file_name, mime_type, size_bytes, entity_type, visibility)
  values (:'RDF1', :'RD1', 'candidate-files', :'RD1' || '/cv-00000000-0000-4000-8000-000000000001.pdf',
          'cv-rita.pdf', 'application/pdf', 1000, 'candidate_cv', 'private');
-- Zgłoszenie DSA złożone przez RD1 (sprawa zostaje po usunięciu konta, bez powiązania).
set role service_role;
select report_id as rdrep1 from public.submit_content_report(:'RD1', gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX',
  'job', :'RDJ2', 'fraud', 'Podejrzana oferta wymagająca opłaty.', null, 'Rita D', 'rd1@test.be', 'fr', true) \gset
reset role;
insert into public.report_events(report_id, event_type, actor_id) values (:'rdrep1', 'flagged', :'RD1');

-- DR486-1: tabele techniczne niedostępne dla ról klienta (domyślnie deny).
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.expect_error('select count(*) from public.retention_policies', 'permission denied', 'DR486-1 anon retention_policies');
select pg_temp.expect_error('select count(*) from public.data_rights_requests', 'permission denied', 'DR486-1b anon data_rights_requests');
select pg_temp.expect_error('select public.export_my_data()', 'permission denied', 'DR486-1c anon bez eksportu');
select pg_temp.expect_error('select public.request_account_erasure(''rd1@test.be'')', 'permission denied', 'DR486-1d anon bez usunięcia');
reset role;
set role authenticated; set app.current_uid = :'RD2'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select count(*) from public.retention_policies', 'permission denied', 'DR486-1e kandydat retention_policies');
select pg_temp.expect_error('select count(*) from public.erasure_tombstones', 'permission denied', 'DR486-1f kandydat tombstones');
select pg_temp.expect_error('select count(*) from public.storage_deletion_queue', 'permission denied', 'DR486-1g kandydat kolejka storage');
select pg_temp.expect_error('insert into public.data_rights_requests(subject_id, kind, channel, due_at) values (auth.uid(), ''access'', ''self_service'', now())',
  'permission denied', 'DR486-1h kandydat nie dopisuje śladu wniosku');
select pg_temp.expect_error('select public.run_retention_purge(10)', 'permission denied', 'DR486-1i kandydat nie uruchamia retencji');
select pg_temp.expect_error('select * from public.claim_storage_deletions(10)', 'permission denied', 'DR486-1j kandydat nie bierze kolejki');
select pg_temp.expect_error('select public.apply_erasure_tombstones(array[''' || :'RD1' || '''::uuid])', 'permission denied',
  'DR486-1k kandydat nie usuwa innych przez tombstone');
select pg_temp.expect_error('select public.erase_candidate_subject(''' || :'RD1' || ''', ''self_service'', null)', 'permission denied',
  'DR486-1l funkcja wewnętrzna bez EXECUTE');
reset role; reset app.current_uid;

-- DR486-2: eksport — pracodawca i admin nie korzystają z eksportu kandydata.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.export_my_data()', 'PERMISSION_DENIED', 'DR486-2 pracodawca bez eksportu kandydata');
reset role; reset app.current_uid;

-- DR486-3: eksport RD1 — dane podane, proces, istniejący wynik dopasowania, wiadomości ze stroną.
set role authenticated; set app.current_uid = :'RD1'; select pg_temp.assert_client_role();
select public.export_my_data()::text as rdexp \gset
select pg_temp.assert((select count(*) from public.data_rights_requests) = 1,
  'DR486-3a kandydat widzi własny ślad wniosku o dostęp');
reset role; reset app.current_uid;
select pg_temp.assert(
  (:'rdexp')::jsonb ->> 'format' = 'pracujbe-export/1'
  and (:'rdexp')::jsonb #>> '{account,email}' = 'rd1@test.be'
  and jsonb_array_length((:'rdexp')::jsonb -> 'applications') = 1
  and (:'rdexp')::jsonb #>> '{applications,0,id}' = :'rdapp1'
  and (:'rdexp')::jsonb #>> '{applications,0,companyName}' = 'Firma Retencja'
  and jsonb_typeof((:'rdexp')::jsonb #> '{applications,0,statusHistory}') = 'array'
  and (:'rdexp')::jsonb #>> '{offers,0,id}' = :'rdoff1'
  and ((:'rdexp')::jsonb #>> '{matches,0,score}')::numeric = 72
  and (:'rdexp')::jsonb #> '{matches,0,missing}' = '["forklift"]'::jsonb
  and (:'rdexp')::jsonb #>> '{files,0,fileName}' = 'cv-rita.pdf'
  and jsonb_typeof((:'rdexp')::jsonb -> 'emailConsentEvents') = 'array'
  and jsonb_typeof((:'rdexp')::jsonb -> 'moderationAppeals') = 'array',
  'DR486-3 eksport zawiera profil, aplikację z historią, propozycję, wynik dopasowania, CV (metadane)');
select pg_temp.assert(
  (select count(*) from jsonb_array_elements((:'rdexp')::jsonb #> '{conversations,0,messages}') m
     where (m->>'fromMe')::boolean) = 1
  and (select count(*) from jsonb_array_elements((:'rdexp')::jsonb #> '{conversations,0,messages}') m
     where not (m->>'fromMe')::boolean and m->>'body' = 'Wiadomość rekrutera') = 1,
  'DR486-3b wiadomości obu stron, strona oznaczona fromMe');
select pg_temp.assert(
  position(:'EMPA' in :'rdexp') = 0 and position(:'RD2' in :'rdexp') = 0
  and position(:'rdapp2' in :'rdexp') = 0 and position('Cudza aplikacja' in :'rdexp') = 0
  and position('rd1-apply' in :'rdexp') = 0 and position('cv-00000000' in :'rdexp') = 0,
  'DR486-3c bez identyfikatora rekrutera, danych innego kandydata, klucza idempotencji i klucza obiektu CV');
select pg_temp.assert(
  (select count(*) from public.audit_logs where action = 'data.exported' and entity_id = :'RD1') = 1,
  'DR486-3d eksport w audycie');
-- DR486-3e: limit 10 eksportów na dobę (kontrola: 10. przechodzi, 11. nie).
insert into public.data_rights_requests(subject_id, kind, channel, due_at, completed_at)
  select :'RD2', 'access', 'self_service', now(), now() from generate_series(1, 9);
set role authenticated; set app.current_uid = :'RD2'; select pg_temp.assert_client_role();
select pg_temp.assert(public.export_my_data() ? 'profile', 'DR486-3e 10. eksport w dobie przechodzi');
select pg_temp.expect_error('select public.export_my_data()', 'RATE_LIMITED', 'DR486-3f 11. eksport w dobie → RATE_LIMITED');
select pg_temp.assert((select count(*) from public.data_rights_requests where subject_id = :'RD1') = 0,
  'DR486-3g kandydat nie widzi śladu wniosków innej osoby');
reset role; reset app.current_uid;

-- DR486-4: usunięcie wymaga potwierdzenia adresem konta; pracodawca nie korzysta.
set role authenticated; set app.current_uid = :'RD1'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.request_account_erasure(''rd2@test.be'')', 'CONFIRMATION_MISMATCH',
  'DR486-4 cudzy adres → CONFIRMATION_MISMATCH');
select pg_temp.expect_error('select public.request_account_erasure(null)', 'CONFIRMATION_MISMATCH',
  'DR486-4b brak potwierdzenia');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.request_account_erasure(''empa@test.be'')', 'PERMISSION_DENIED',
  'DR486-4c pracodawca nie usuwa konta tą ścieżką');
reset role; reset app.current_uid;
select pg_temp.assert(exists (select 1 from public.profiles where id = :'RD1')
  and exists (select 1 from public.applications where id = :'rdapp1'),
  'DR486-4d odmowa niczego nie usuwa');

-- DR486-5 (kontrola ujemna do 0105 pkt 10): stara reguła historii DSA wywraca usunięcie.
begin;
create or replace function public.report_events_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'PERMISSION_DENIED: historia sprawy jest tylko do dopisywania' using errcode = '42501';
end $$;
select pg_temp.expect_error('select public.erase_candidate_subject(''' || :'RD1' || ''', ''self_service'', null)',
  'tylko do dopisywania', 'DR486-5 kontrola: bez poprawki usunięcie autora zdarzenia DSA pada');
rollback;
-- DR486-5b (kontrola ujemna): reports_guard z 0076 odrzuca odwołanie reporter_id pod sesją
-- usuwanego kandydata — samoobsługowe usunięcie autora zgłoszenia by padło.
begin;
create or replace function public.reports_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then return new; end if;
  if not public.is_admin() then
    raise exception 'PERMISSION_DENIED: zgłoszenie zmienia tylko administrator' using errcode = '42501';
  end if;
  return new;
end $$;
set local role authenticated; set local app.current_uid = :'RD1'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.request_account_erasure(''rd1@test.be'')',
  'zmienia tylko administrator', 'DR486-5b kontrola: bez poprawki reports_guard usunięcie pada');
rollback;

-- DR486-6: usunięcie konta RD1 (adres wielkimi literami, ze spacjami).
set role authenticated; set app.current_uid = :'RD1'; select pg_temp.assert_client_role();
select public.request_account_erasure('  RD1@Test.be ')::text as rderase \gset
reset role; reset app.current_uid;
select pg_temp.assert(
  not exists (select 1 from auth.users where id = :'RD1')
  and not exists (select 1 from public.profiles where id = :'RD1')
  and not exists (select 1 from public.candidate_profiles where profile_id = :'RD1')
  and not exists (select 1 from auth.sessions where user_id = :'RD1')
  and not exists (select 1 from public.applications where id = :'rdapp1')
  and not exists (select 1 from public.offers where id = :'rdoff1')
  and not exists (select 1 from public.conversations where id = :'rdconv1')
  and not exists (select 1 from public.messages where conversation_id = :'rdconv1')
  and not exists (select 1 from public.matches where candidate_id = :'RD1')
  and not exists (select 1 from public.files where owner_id = :'RD1' or id = :'RDF1'),
  'DR486-6 konto, sesje, profil, aplikacja, propozycja, rozmowa, dopasowanie i CV usunięte');
select pg_temp.assert(
  not exists (select 1 from public.notifications where entity_id in (:'rdapp1'::uuid, :'rdoff1'::uuid, :'rdconv1'::uuid))
  and not exists (select 1 from public.email_deliveries where entity_id in (:'rdapp1'::uuid, :'rdoff1'::uuid)
                    or to_email = 'rd1@test.be'),
  'DR486-6b powiadomienia i e-maile firmy o procesie RD1 usunięte');
select pg_temp.assert(
  (select reporter_id is null and kind = 'dsa_notice' from public.reports where id = :'rdrep1')
  and (select bool_and(actor_id is null) from public.report_events where report_id = :'rdrep1'),
  'DR486-6c sprawa DSA zostaje bez powiązania z kontem');
select pg_temp.assert(
  (select count(*) from public.storage_deletion_queue
    where bucket = 'candidate-files' and path = :'RD1' || '/cv-00000000-0000-4000-8000-000000000001.pdf') = 1
  and (select channel = 'self_service' from public.erasure_tombstones where subject_id = :'RD1')
  and (select completed_at is not null and kind = 'erasure' and (details->>'applications')::int = 1
            and (details->>'files')::int = 1
         from public.data_rights_requests where subject_id = :'RD1' and kind = 'erasure')
  and (select count(*) from public.audit_logs where action = 'account.erased' and entity_id = :'RD1') = 1,
  'DR486-6d obiekt CV w kolejce, tombstone, ślad wniosku z licznikami, audyt');
select pg_temp.assert(
  exists (select 1 from public.applications where id = :'rdapp2')
  and exists (select 1 from public.profiles where id = :'RD2')
  and exists (select 1 from public.applications where candidate_id = :'CANDA'),
  'DR486-6e dane innych kandydatów nienaruszone');
set role authenticated; set app.current_uid = :'RD1'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.export_my_data()', 'PERMISSION_DENIED', 'DR486-6f po usunięciu brak dostępu');
reset role; reset app.current_uid;

-- DR486-7: kolejka storage — dzierżawa, backoff przy błędzie, sukces usuwa wiersz.
set role service_role;
select id as rdq1 from public.claim_storage_deletions(10) where path like :'RD1' || '/%' \gset
select pg_temp.assert(not exists (select 1 from public.claim_storage_deletions(10) where id = :'rdq1'),
  'DR486-7 wiersz w dzierżawie nie jest pobierany drugi raz');
select public.complete_storage_deletion(:'rdq1', false, 'UNAVAILABLE');
select pg_temp.assert((select attempts = 1 and last_error = 'UNAVAILABLE' and next_attempt_at > now() and locked_until is null
  from public.storage_deletion_queue where id = :'rdq1'), 'DR486-7b błąd → ponowienie z backoffem');
select pg_temp.assert(not exists (select 1 from public.claim_storage_deletions(10) where id = :'rdq1'),
  'DR486-7c przed terminem ponowienia wiersz nie wraca');
update public.storage_deletion_queue set next_attempt_at = now() - interval '1 second' where id = :'rdq1';
select pg_temp.assert(exists (select 1 from public.claim_storage_deletions(10) where id = :'rdq1'),
  'DR486-7d po terminie wiersz wraca');
select public.complete_storage_deletion(:'rdq1', true, null);
select pg_temp.assert(not exists (select 1 from public.storage_deletion_queue where id = :'rdq1'),
  'DR486-7e sukces usuwa wiersz kolejki');
reset role;
-- DR486-7f (kontrola ujemna): bez triggera usunięcie wiersza files nie zostawia śladu obiektu.
begin;
drop trigger trg_files_queue_storage_deletion on public.files;
insert into public.files(owner_id, bucket, path, entity_type) values (:'RD2', 'candidate-files', 'x/orphan.pdf', 'candidate_cv');
delete from public.files where path = 'x/orphan.pdf';
select pg_temp.assert(not exists (select 1 from public.storage_deletion_queue where path = 'x/orphan.pdf'),
  'DR486-7f kontrola: bez triggera obiekt zostałby osierocony');
rollback;

-- DR486-8: retencja — przed terminem nic, po terminie usunięte; kategorie wyłączone nie działają.
set session_replication_role = replica;
insert into public.files(owner_id, bucket, path, entity_type, deleted_at) values
  (:'RD2', 'candidate-files', :'RD2' || '/cv-old.pdf', 'candidate_cv', now() - interval '31 days'),
  (:'RD2', 'candidate-files', :'RD2' || '/cv-recent.pdf', 'candidate_cv', now() - interval '5 days');
update public.profiles set deleted_at = now() - interval '31 days', is_active = false where id = :'RD3';
update public.profiles set deleted_at = now() - interval '1 day', is_active = false where id = :'RD4';
update public.applications set status = 'rejected', updated_at = now() - interval '40 days' where id = :'rdapp2';
set session_replication_role = origin;
set role service_role;
select public.run_retention_purge(100)::text as rdpurge1 \gset
reset role;
select pg_temp.assert(
  not exists (select 1 from public.files where path = :'RD2' || '/cv-old.pdf')
  and exists (select 1 from public.storage_deletion_queue where path = :'RD2' || '/cv-old.pdf')
  and exists (select 1 from public.files where path = :'RD2' || '/cv-recent.pdf')
  and not exists (select 1 from public.profiles where id = :'RD3')
  and exists (select 1 from public.erasure_tombstones where subject_id = :'RD3' and channel = 'retention')
  and exists (select 1 from public.profiles where id = :'RD4')
  and exists (select 1 from public.applications where id = :'rdapp2'),
  'DR486-8 po terminie usunięte (plik, profil), przed terminem zostają, wyłączona kategoria nie działa');
select pg_temp.assert((:'rdpurge1')::jsonb ->> 'deletedFiles' = '1' and (:'rdpurge1')::jsonb ->> 'erasedProfiles' = '1'
  and (:'rdpurge1')::jsonb ->> 'closedApplications' = '0', 'DR486-8b liczniki zadania');
-- Okres ustawia wyłącznie admin (z audytem); rejestr usunięć nie krótszy niż retencja kopii.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.admin_set_retention_policy(''closed_application'', 30)', 'PERMISSION_DENIED',
  'DR486-8c pracodawca nie zmienia retencji');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.admin_set_retention_policy(''erasure_tombstone'', 30)', 'retencja kopii',
  'DR486-8d tombstone krótszy niż kopie → odmowa');
select pg_temp.expect_error('select public.admin_set_retention_policy(''nie_ma'', 30)', 'NOT_FOUND', 'DR486-8e nieznana kategoria');
select public.admin_set_retention_policy('closed_application', 30);
select public.admin_set_retention_policy('confirmed_guest_request', 1);
reset role; reset app.current_uid;
-- Ślad potwierdzonego zgłoszenia gościa powiązanego z zamkniętą aplikacją (#522: okres ustala
-- właściciel) — retencja go nie usuwa, nawet po ustawieniu wartości.
set session_replication_role = replica;
insert into public.guest_application_requests(job_id, email, full_name, locale, idempotency_key, status,
    confirm_token_hash, confirm_nonce, confirm_expires_at, consent_accepted_at, confirmed_at, application_id)
  values (:'RDJ', 'gosc-rd@test.be', 'Gość RD', 'pl', 'rd-guest-trail-1', 'confirmed', repeat('a', 64),
    'rd-guest-nonce-0001', now() - interval '60 days', now() - interval '60 days', now() - interval '60 days', :'rdapp2')
  returning id as rdguest \gset
set session_replication_role = origin;
set role service_role;
select public.run_retention_purge(100)::text as rdpurge2 \gset
select public.run_retention_purge(100)::text as rdpurge3 \gset
reset role;
select pg_temp.assert(
  not exists (select 1 from public.applications where id = :'rdapp2')
  and exists (select 1 from public.applications where candidate_id = :'CANDA')
  and (:'rdpurge3')::jsonb ->> 'closedApplications' = '0'
  and (select application_id is null from public.guest_application_requests where id = :'rdguest')
  and not ((:'rdpurge2')::jsonb ? 'confirmedGuestRequests')
  and (select count(*) from public.audit_logs where action = 'retention.policy_changed') = 2,
  'DR486-8f po włączeniu kategorii usunięta tylko zakończona aplikacja (ślad gościa zostaje); ponowny przebieg idempotentny');

-- DR486-9: odtworzona kopia przywraca RD1 → tombstone usuwa go ponownie.
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'RD1','rd1@test.be','Rita D','{"role":"candidate","first_name":"Rita","last_name":"D","locale":"fr"}');
insert into public.candidate_profiles(profile_id, is_searchable) values (:'RD1', true);
select pg_temp.assert(exists (select 1 from public.profiles where id = :'RD1'),
  'DR486-9 kontrola: bez ponownego zastosowania dane z kopii wracają');
set role service_role;
select public.apply_erasure_tombstones(array[:'RD1'::uuid, 'd4860000-0000-4000-8000-0000000000ff'::uuid])::text as rdreapply \gset
reset role;
select pg_temp.assert(
  not exists (select 1 from public.profiles where id = :'RD1') and not exists (select 1 from auth.users where id = :'RD1')
  and (:'rdreapply')::jsonb = '{"reapplied": 1, "alreadyAbsent": 1}'::jsonb
  and (select reapplied_at is not null from public.erasure_tombstones where subject_id = :'RD1'),
  'DR486-9b po restore osoba usunięta ponownie, tombstone oznaczony');

-- ============================================================================
-- APL43. Odwołania od decyzji moderacyjnych, terminy, retencja i raport przejrzystości
-- (0104, #43): obie strony odwołują się bez dostępu do danych drugiej; termin od
-- POINFORMOWANIA; rozpatruje inny człowiek; skuteczne odwołanie atomowo zmienia decyzję,
-- treść i audyt; czyszczenie nie rusza sprawy przed końcem drogi odwołania; agregaty.
-- =====================================================================
\set ADMIN2 '78787878-7878-7878-7878-787878787878'
\set APCO 'e9700000-0000-0000-0000-0000000000c1'
\set APJ1 'e9700000-0000-0000-0000-0000000000b1'
\set APJ2 'e9700000-0000-0000-0000-0000000000b2'
\set APJ3 'e9700000-0000-0000-0000-0000000000b3'
\set APJ4 'e9700000-0000-0000-0000-0000000000b4'
\set APFACTS 'Oferta żąda od kandydatów opłaty za rekrutację z góry.'
\set APGROUNDS 'Nie pobieramy opłat; wymóg był błędem w szablonie ogłoszenia.'
\set APREASON 'Autor wykazał, że opłata nie była pobierana od kandydatów.'
reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'ADMIN2','admin2@test.be','Ad Two','{"role":"employer","first_name":"Ad","last_name":"Two","locale":"fr"}');
update public.profiles set role = 'admin' where id = :'ADMIN2';
insert into public.companies(id,name,status) values (:'APCO','Firma Odwołań','verified');
insert into public.company_members(company_id,profile_id,role,is_active) values (:'APCO',:'EMPA','owner',true);
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'APJ1',:'APCO','apl-job-1','Magazynier A1','warehouse','permanent','Antwerpia','Flandria','active','pl'),
  (:'APJ2',:'APCO','apl-job-2','Magazynier A2','warehouse','permanent','Antwerpia','Flandria','active','pl'),
  (:'APJ3',:'APCO','apl-job-3','Magazynier A3','warehouse','permanent','Antwerpia','Flandria','active','pl'),
  (:'APJ4',:'APCO','apl-job-4','Magazynier A4','warehouse','permanent','Antwerpia','Flandria','active','pl');

set role service_role;
select report_id as ar1 from public.submit_content_report(null, gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX',
  'job', :'APJ1', 'fraud', 'Oferta wymaga opłaty za rekrutację z góry.', null, 'Gość A', 'apl1@test.be', 'fr', true) \gset
select report_id as ar2, case_number as acase2 from public.submit_content_report(:'CANDA', gen_random_uuid(),
  'ABCDEFGHIJKLMNOPQRSTUVWX', 'job', :'APJ2', 'fraud', 'Oferta wymaga opłaty za rekrutację z góry.', null, null,
  'apl2@test.be', 'en', true) \gset
select report_id as ar3 from public.submit_content_report(null, gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX',
  'job', :'APJ3', 'fraud', 'Oferta wymaga opłaty za rekrutację z góry.', null, null, 'apl3@test.be', 'nl', true) \gset
select report_id as ar4, case_number as acase4 from public.submit_content_report(null, gen_random_uuid(),
  'ABCDEFGHIJKLMNOPQRSTUVWX', 'job', :'APJ4', 'other', 'Opis oferty wydaje się niepełny i mylący.', null, null,
  'apl4@test.be', 'nl', true) \gset
select report_id as ar5, case_number as acase5 from public.submit_content_report(null, gen_random_uuid(),
  'ABCDEFGHIJKLMNOPQRSTUVWX', 'job', :'APJ4', 'other', 'Opis oferty wydaje się niepełny i mylący.', 'https://example.test/x',
  'Gość Pięć', 'apl5@test.be', 'pl', true) \gset
select report_id as ar6 from public.submit_content_report(null, gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX',
  'job', :'APJ4', 'other', 'Opis oferty wydaje się niepełny i mylący.', null, null, 'apl6@test.be', 'pl', true) \gset
select report_id as ar7 from public.submit_content_report(null, gen_random_uuid(), 'ABCDEFGHIJKLMNOPQRSTUVWX',
  'job', :'APJ4', 'other', 'Opis oferty wydaje się niepełny i mylący.', null, null, 'apl7@test.be', 'pl', true) \gset
reset role;

set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_decide_report(:'ar1', 'open', 'job_removed', :'APFACTS', 'terms', 'Regulamin § 4') as ad1 \gset
select public.admin_decide_report(:'ar2', 'open', 'no_action', 'Treść nie narusza regulaminu ani prawa.') as ad2 \gset
select public.admin_decide_report(:'ar3', 'open', 'job_removed', :'APFACTS', 'terms', 'Regulamin § 4') as ad3 \gset
select public.admin_decide_report(:'ar4', 'open', 'no_action', 'Treść nie narusza regulaminu ani prawa.') as ad4 \gset
select public.admin_decide_report(:'ar5', 'open', 'no_action', 'Treść nie narusza regulaminu ani prawa.') as ad5 \gset
select public.admin_decide_report(:'ar6', 'open', 'no_action', 'Treść nie narusza regulaminu ani prawa.') as ad6 \gset
select public.admin_decide_report(:'ar7', 'open', 'no_action', 'Treść nie narusza regulaminu ani prawa.') as ad7 \gset
reset role; reset app.current_uid;

-- APL43-1: odwołanie autora — tylko aktywny owner/admin firmy decyzji; cudza decyzja = NOT_FOUND.
set role anon; select pg_temp.assert_client_role();
select pg_temp.expect_error('select * from public.submit_moderation_appeal(''' || :'ad1' || ''', gen_random_uuid(), ''' || :'APGROUNDS' || ''')',
  'permission denied', 'APL43-1 anon bez EXECUTE');
reset role;
set role authenticated; set app.current_uid = :'EMPB'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select * from public.submit_moderation_appeal(''' || :'ad1' || ''', gen_random_uuid(), ''' || :'APGROUNDS' || ''')',
  'NOT_FOUND', 'APL43-1b inna firma nie odwołuje się od cudzej decyzji');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select * from public.submit_moderation_appeal(''' || :'ad2' || ''', gen_random_uuid(), ''' || :'APGROUNDS' || ''')',
  'NOT_FOUND', 'APL43-1c zgłaszający nie korzysta ze ścieżki autora (decyzja bez ograniczenia)');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select * from public.submit_moderation_appeal(''' || :'ad2' || ''', gen_random_uuid(), ''' || :'APGROUNDS' || ''')',
  'NOT_FOUND', 'APL43-1d autor nie odwołuje się od decyzji o braku działań');
select pg_temp.expect_error('select * from public.submit_moderation_appeal(''' || :'ad1' || ''', gen_random_uuid(), ''za krótko'')',
  'GROUNDS_REQUIRED', 'APL43-1e uzasadnienie odwołania wymagane');
select 'e9700000-0000-0000-0000-00000000a001' as akey1 \gset
select appeal_id as aa1, reference as aref1, created as acreated1
  from public.submit_moderation_appeal(:'ad1', :'akey1', :'APGROUNDS') \gset
select appeal_id as aa1r, created as acreated1r from public.submit_moderation_appeal(:'ad1', :'akey1', :'APGROUNDS') \gset
select pg_temp.expect_error('select * from public.submit_moderation_appeal(''' || :'ad1' || ''', gen_random_uuid(), ''' || :'APGROUNDS' || ''')',
  'APPEAL_EXISTS', 'APL43-1f drugie odwołanie od tej samej decyzji');
select pg_temp.expect_error('select count(*) from public.moderation_appeals', 'permission denied',
  'APL43-1g klient nie czyta tabeli odwołań');
select appeal_id as aa3 from public.submit_moderation_appeal(:'ad3', gen_random_uuid(), :'APGROUNDS') \gset
reset role; reset app.current_uid;
select pg_temp.assert(:'acreated1'::boolean and not :'acreated1r'::boolean and :'aa1' = :'aa1r'
  and :'aref1' ~ '^APL-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$',
  'APL43-1h idempotencja: ponowienie tym samym kluczem = to samo odwołanie');
select pg_temp.assert(
  (select appellant_role = 'author' and appellant_id = :'EMPA'::uuid and appellant_locale = 'nl'
          and status = 'pending' and due_at > now() from public.moderation_appeals where id = :'aa1')
  and (select count(*) from public.email_deliveries where template = 'appealReceived' and entity_id = :'aa1'
         and profile_id = :'EMPA' and locale = 'nl') = 1
  and (select count(*) from public.report_events where report_id = :'ar1' and event_type = 'appeal_submitted') = 1
  and (select count(*) from public.audit_logs where action = 'moderation.appeal_submitted' and entity_id = :'ar1') = 1,
  'APL43-1i odwołanie: stan, e-mail w języku autora (nl), historia, audyt');

-- APL43-2: odwołanie zgłaszającego — numer sprawy + kod, tylko od braku działań.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select * from public.submit_report_appeal(''' || :'acase2' || ''', ''ABCDEFGHIJKLMNOPQRSTUVWX'', gen_random_uuid(), ''' || :'APGROUNDS' || ''')',
  'permission denied', 'APL43-2 klient nie woła RPC zgłaszającego z pominięciem limitera');
reset role; reset app.current_uid;
set role service_role;
select pg_temp.expect_error('select * from public.submit_report_appeal(''' || :'acase2' || ''', ''ABCDEFGHIJKLMNOPQRSTUVWY'', gen_random_uuid(), ''' || :'APGROUNDS' || ''')',
  'NOT_FOUND', 'APL43-2b zły kod dostępu = NOT_FOUND');
select pg_temp.expect_error('select * from public.submit_report_appeal(''' || (select case_number from public.reports where id = :'ar1') || ''', ''ABCDEFGHIJKLMNOPQRSTUVWX'', gen_random_uuid(), ''' || :'APGROUNDS' || ''')',
  'INVALID_TRANSITION', 'APL43-2c zgłaszający nie odwołuje się od ograniczenia treści');
select appeal_id as aa2 from public.submit_report_appeal(:'acase2', 'ABCDEFGHIJKLMNOPQRSTUVWX', gen_random_uuid(),
  'Oferta nadal wymaga opłaty; załączam opis rozmowy z rekruterem.') \gset
reset role;
select pg_temp.assert(
  (select appellant_role = 'reporter' and appellant_id = :'CANDA'::uuid and appellant_locale = 'pl'
     from public.moderation_appeals where id = :'aa2')
  and (select count(*) from public.email_deliveries where template = 'appealReceived' and entity_id = :'aa2'
         and to_email = 'apl2@test.be' and locale = 'pl' and not (payload ? 'companyName')) = 1,
  'APL43-2d odwołanie zgłaszającego: język profilu (pl), bez danych autora');

-- APL43-3: termin od POINFORMOWANIA, nie od utworzenia rekordu.
set role service_role;
select pg_temp.assert(public.moderation_appeal_deadline(:'ad4') is null
  and public.moderation_appealable(:'ad4') = 'OK',
  'APL43-3 e-mail w kolejce: strona nie poinformowana, termin nie biegnie');
reset role;
update public.email_deliveries set status = 'bounced', sent_at = now() - interval '7 months'
  where entity_id = :'ar4' and template = 'reportDecisionNoAction';
set role service_role;
select pg_temp.assert(public.moderation_appeal_deadline(:'ad4') is null,
  'APL43-3b odbity e-mail nie jest poinformowaniem');
reset role;
update public.email_deliveries set status = 'delivered' where entity_id = :'ar4' and template = 'reportDecisionNoAction';
set role service_role;
select pg_temp.assert(public.moderation_appealable(:'ad4') = 'APPEAL_WINDOW_CLOSED',
  'APL43-3c 7 miesięcy od doręczenia: termin odwołania upłynął');
select pg_temp.expect_error('select * from public.submit_report_appeal(''' || :'acase4' || ''', ''ABCDEFGHIJKLMNOPQRSTUVWX'', gen_random_uuid(), ''' || :'APGROUNDS' || ''')',
  'APPEAL_WINDOW_CLOSED', 'APL43-3d odwołanie po terminie odrzucone');
select (public.get_report_case(:'acase4', 'ABCDEFGHIJKLMNOPQRSTUVWX'))->>'appealState' as astate4 \gset
reset role;
select pg_temp.assert(:'astate4' = 'APPEAL_WINDOW_CLOSED', 'APL43-3e zgłaszający widzi, że termin upłynął');
-- Autor: odczyt powiadomienia w panelu = poinformowanie (wcześniejsze niż e-mail).
update public.notifications set read_at = now() - interval '1 day'
  where data->>'decisionId' = :'ad3' and profile_id = :'EMPA';
set role service_role;
select pg_temp.assert(public.moderation_informed_at(:'ad3') between now() - interval '25 hours' and now() - interval '23 hours',
  'APL43-3f autor poinformowany odczytem powiadomienia w panelu');
reset role;

-- APL43-4: ponowny przegląd przez INNEGO człowieka, gdy to możliwe.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.admin_decide_appeal(''' || :'aa1' || ''', ''pending'', ''reversed'', ''' || :'APREASON' || ''')',
  'PERMISSION_DENIED', 'APL43-4 autor nie rozpatruje własnego odwołania');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.admin_decide_appeal(''' || :'aa1' || ''', ''pending'', ''reversed'', ''' || :'APREASON' || ''')',
  'REVIEWER_CONFLICT', 'APL43-4b autor decyzji nie rozpatruje odwołania, gdy jest inny admin');
reset role; reset app.current_uid;
-- Kontrola: jedyny administrator może rozpatrzyć — z zapisem `same_reviewer`.
begin;
update public.profiles set role = 'employer' where id = :'ADMIN2';
set local role authenticated; set local app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_decide_appeal(:'aa3', 'pending', 'upheld', 'Decyzja jest zasadna, opłata była pobierana.');
reset role;
select pg_temp.assert((select same_reviewer and status = 'upheld' from public.moderation_appeals where id = :'aa3'),
  'APL43-4c jedyny admin rozpatruje odwołanie, zapis same_reviewer');
rollback;

-- APL43-5: awaria skutku cofa rozpatrzenie w całości.
create function pg_temp.apl_fail_job() returns trigger language plpgsql as $$
begin
  if new.id = 'e9700000-0000-0000-0000-0000000000b1'::uuid then raise exception 'INJECTED_APPEAL_FAILURE'; end if;
  return new;
end $$;
create trigger trg_apl_fail before update on public.jobs for each row execute function pg_temp.apl_fail_job();
set role authenticated; set app.current_uid = :'ADMIN2'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.admin_decide_appeal(''' || :'aa1' || ''', ''pending'', ''reversed'', ''' || :'APREASON' || ''')',
  'INJECTED_APPEAL_FAILURE', 'APL43-5 awaria przywrócenia przerywa rozpatrzenie');
reset role; reset app.current_uid;
drop trigger trg_apl_fail on public.jobs;
select pg_temp.assert(
  (select status = 'pending' and decided_at is null from public.moderation_appeals where id = :'aa1')
  and not exists (select 1 from public.moderation_restorations where decision_id = :'ad1')
  and (select status::text = 'closed' and moderation_decision_id = :'ad1'::uuid from public.jobs where id = :'APJ1')
  and (select count(*) from public.audit_logs where action = 'moderation.appeal_decided' and entity_id = :'ar1') = 0,
  'APL43-5b po awarii: odwołanie oczekuje, treść nadal ograniczona, bez audytu');

-- APL43-6: uwzględnione odwołanie autora — cofnięcie ograniczenia, audyt, wynik w języku autora.
set role authenticated; set app.current_uid = :'ADMIN2'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.admin_decide_appeal(''' || :'aa1' || ''', ''upheld'', ''reversed'', ''' || :'APREASON' || ''')',
  'STALE_STATE', 'APL43-6 nieaktualny status odwołania → STALE_STATE');
select public.admin_decide_appeal(:'aa1', 'pending', 'reversed', :'APREASON');
select pg_temp.expect_error('select public.admin_decide_appeal(''' || :'aa1' || ''', ''pending'', ''upheld'', ''' || :'APREASON' || ''')',
  'STALE_STATE', 'APL43-6b drugie rozpatrzenie odrzucone');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select a.status = 'reversed' and a.decided_by = :'ADMIN2'::uuid and not a.same_reviewer
          and a.restoration_id = r.id and r.reason = :'APREASON'
     from public.moderation_appeals a join public.moderation_restorations r on r.decision_id = a.decision_id
    where a.id = :'aa1')
  and (select status::text = 'active' and moderation_decision_id is null from public.jobs where id = :'APJ1')
  and public.job_is_public(:'APJ1'),
  'APL43-6c decyzja cofnięta, oferta wraca do stanu sprzed ograniczenia');
select pg_temp.assert(
  (select count(*) from public.audit_logs where action = 'moderation.appeal_decided' and entity_id = :'ar1'
     and actor_id = :'ADMIN2'::uuid and after_data->>'status' = 'reversed') = 1
  and (select count(*) from public.audit_logs where action = 'moderation.restored' and entity_id = :'ar1') = 1
  and (select count(*) from public.report_events where report_id = :'ar1' and event_type in ('restored', 'appeal_decided')) = 2
  and (select count(*) from public.email_deliveries where template = 'appealReversed' and entity_id = :'aa1'
         and profile_id = :'EMPA' and locale = 'nl' and payload->>'reasoning' = :'APREASON') = 1
  and (select count(*) from public.email_deliveries where template = 'moderationRestored' and entity_id = :'ad1') = 0
  and (select count(*) from public.notifications where profile_id = :'EMPA' and data->>'appealId' = :'aa1'
         and data->>'decision' = 'appeal_reversed') = 1,
  'APL43-6d audyt, historia, jeden e-mail z wynikiem w języku autora (bez dubla „przywrócono”)');

-- APL43-7: uwzględnione odwołanie zgłaszającego — ponowne zastosowanie skutku.
set role authenticated; set app.current_uid = :'ADMIN2'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.admin_decide_appeal(''' || :'aa2' || ''', ''pending'', ''reversed'', ''' || :'APREASON' || ''')',
  'VALIDATION_FAILED: DECISION', 'APL43-7 uwzględnienie odwołania zgłaszającego wymaga rodzaju ograniczenia');
select pg_temp.expect_error('select public.admin_decide_appeal(''' || :'aa2' || ''', ''pending'', ''reversed'', ''' || :'APREASON' || ''', ''job_removed'', ''terms'', null)',
  'GROUND_REFERENCE_REQUIRED', 'APL43-7b ograniczenie wymaga podstawy');
select public.admin_decide_appeal(:'aa2', 'pending', 'reversed', 'Rekruter potwierdził pobieranie opłaty od kandydatów.',
  'job_removed', 'terms', 'Regulamin § 4 ust. 2');
reset role; reset app.current_uid;
select new_decision_id as ad2n from public.moderation_appeals where id = :'aa2' \gset
select pg_temp.assert(
  (select appeal_id = :'aa2'::uuid and decision = 'job_removed' and decided_by = :'ADMIN2'::uuid
          and previous_status = 'active' from public.moderation_decisions where id = :'ad2n')
  and (select status::text = 'resolved' and decision_id = :'ad2n'::uuid from public.reports where id = :'ar2')
  and (select status::text = 'closed' and moderation_decision_id = :'ad2n'::uuid from public.jobs where id = :'APJ2')
  and not public.job_is_public(:'APJ2')
  and (select count(*) from public.moderation_decisions where id = :'ad2') = 1,
  'APL43-7c nowa decyzja z odwołania: treść ograniczona, sprawa wskazuje nową decyzję, pierwotna zostaje');
select pg_temp.assert(
  (select count(*) from public.email_deliveries where template = 'moderationJobRemoved' and entity_id = :'ad2n'
     and profile_id = :'EMPA' and locale = 'nl' and not (payload ? 'caseNumber')) = 1
  and (select count(*) from public.email_deliveries where template = 'appealReversed' and entity_id = :'aa2'
     and to_email = 'apl2@test.be' and locale = 'pl' and not (payload ? 'companyName')) = 1
  and (select count(*) from public.audit_logs where action = 'moderation.decided' and entity_id = :'ar2'
     and after_data->>'appealId' = :'aa2') = 1,
  'APL43-7d autor dostaje uzasadnienie nowej decyzji (nl), zgłaszający wynik odwołania (pl)');
set role service_role;
select public.get_report_case(:'acase2', 'ABCDEFGHIJKLMNOPQRSTUVWX') as alookup2 \gset
reset role;
select pg_temp.assert((:'alookup2'::jsonb)->>'outcome' = 'action_taken'
  and (:'alookup2'::jsonb)->'appeal'->>'status' = 'reversed'
  and (:'alookup2'::jsonb)->>'appealState' is null,
  'APL43-7e zgłaszający widzi wynik odwołania, bez kolejnej drogi odwołania');
-- Kontrola ujemna: poza ścieżką odwołania rozstrzygniętej sprawy nie da się przepiąć ani otworzyć.
select pg_temp.expect_error('update public.reports set decision_id = ''' || :'ad2' || ''' where id = ''' || :'ar2' || '''',
  'nie można zmienić', 'APL43-7f decyzji sprawy nie przepina bezpośredni zapis');
begin;
set local pracujbe.appeal = 'on';
select pg_temp.expect_error('update public.reports set decision_id = ''' || :'ad5' || ''', status = ''dismissed'' where id = ''' || :'ar2' || '''',
  'nie można zmienić', 'APL43-7g sama flaga nie wystarcza — decyzja musi wynikać z odwołania tej sprawy');
rollback;

-- APL43-8: utrzymanie decyzji niczego nie zmienia; odwołanie niezmienne.
set role authenticated; set app.current_uid = :'ADMIN2'; select pg_temp.assert_client_role();
select public.admin_decide_appeal(:'aa3', 'pending', 'upheld', 'Decyzja jest zasadna, opłata była pobierana.');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status = 'upheld' and new_decision_id is null and restoration_id is null from public.moderation_appeals where id = :'aa3')
  and (select status::text = 'closed' and moderation_decision_id = :'ad3'::uuid from public.jobs where id = :'APJ3')
  and (select count(*) from public.email_deliveries where template = 'appealUpheld' and entity_id = :'aa3' and locale = 'nl') = 1,
  'APL43-8 utrzymana decyzja: treść nadal ograniczona, wynik do autora');
select pg_temp.expect_error('update public.moderation_appeals set grounds = ''podmiana uzasadnienia odwołania'' where id = ''' || :'aa3' || '''',
  'niezmienne', 'APL43-8b uzasadnienie odwołania niezmienne');
select pg_temp.expect_error('update public.moderation_appeals set status = ''reversed'' where id = ''' || :'aa3' || '''',
  'niezmienne', 'APL43-8c wyniku nie zmienia bezpośredni zapis');
select pg_temp.expect_error('delete from public.moderation_appeals where id = ''' || :'aa3' || '''',
  'nie można usunąć', 'APL43-8d odwołania nie można usunąć');

-- APL43-9: izolacja stron.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.get_company_moderation_decisions(:'APCO') where appeal_id is not null) = 2
  and not exists (select 1 from public.get_company_moderation_decisions(:'APCO') where appeal_id = :'aa2'::uuid)
  and (select appeal_state from public.get_company_moderation_decisions(:'APCO') where id = :'ad2n') = 'OK',
  'APL43-9 autor widzi swoje odwołania; odwołanie zgłaszającego pozostaje niewidoczne');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select count(*) from public.report_events where report_id = :'ar2') > 0
  and (select count(*) from public.report_events where report_id = :'ar2' and event_type like 'appeal%') = 0,
  'APL43-9b zgłaszający nie widzi zdarzeń odwołań w historii (RLS)');
reset role; reset app.current_uid;
select pg_temp.assert(position(:'APGROUNDS' in :'alookup2') = 0 and position('Firma' in :'alookup2') = 0,
  'APL43-9c wynik dla zgłaszającego bez danych autora');

-- APL43-10: retencja — dry-run, termin od poinformowania, anonimizacja bez utraty agregatów.
-- ar5: poinformowany 2 lata temu → poza drogą odwołania i retencją; ar6: poinformowany
-- 7 mies. temu, zamknięty 2 lata temu → nadal w retencji (naiwne „resolved_at + 12 mies.”
-- usunęłoby go); ar7: nigdy nie poinformowany → czeka; ar2: odwołanie rozstrzygnięte dziś.
update public.email_deliveries set status = 'sent', sent_at = now() - interval '2 years'
  where entity_id = :'ar5' and template = 'reportDecisionNoAction';
update public.email_deliveries set status = 'sent', sent_at = now() - interval '7 months'
  where entity_id = :'ar6' and template = 'reportDecisionNoAction';
update public.reports set resolved_at = now() - interval '2 years' where id in (:'ar5', :'ar6', :'ar7');
select pg_temp.assert((select resolved_at + public.dsa_case_retention() < now() from public.reports where id = :'ar6'),
  'APL43-10 kontrola: naiwna retencja od zamknięcia objęłaby już sprawę ar6');
set role service_role;
select public.dsa_transparency_report(now() - interval '1 day', now() + interval '1 day') as atr_before \gset
select public.dsa_retention_run(true) as adry \gset
select pg_temp.assert(
  exists (select 1 from public.dsa_retention_cases() where report_id = :'ar5' and eligible_at <= now())
  and exists (select 1 from public.dsa_retention_cases() where report_id = :'ar6' and eligible_at > now())
  and exists (select 1 from public.dsa_retention_cases() where report_id = :'ar7' and retention_start is null)
  and exists (select 1 from public.dsa_retention_cases() where report_id = :'ar2' and (retention_start is null or eligible_at > now())),
  'APL43-10b kwalifikacja: tylko sprawa poza terminem odwołania od poinformowania i retencją');
reset role;
select pg_temp.assert((:'adry'::jsonb)->>'dryRun' = 'true' and ((:'adry'::jsonb)->>'eligibleCases')::int >= 1
  and (select reporter_email is not null and redacted_at is null from public.reports where id = :'ar5')
  and (select count(*) from public.dsa_retention_runs where dry_run) = 1,
  'APL43-10c dry-run: raport zapisany, dane nienaruszone');
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.dsa_retention_run(false)', 'permission denied',
  'APL43-10d czyszczenie tylko service_role');
select pg_temp.expect_error('select public.dsa_transparency_report(now() - interval ''1 day'', now())', 'permission denied',
  'APL43-10e raport przejrzystości tylko przez panel (service_role)');
reset role; reset app.current_uid;
select pg_temp.expect_error('update public.reports set reporter_email = null where id = ''' || :'ar5' || '''',
  'niezmienna', 'APL43-10f poza przebiegiem retencji dane sprawy niezmienne');
set role service_role;
select public.dsa_retention_run(false) as arun \gset
select pg_temp.assert(public.get_report_case(:'acase5', 'ABCDEFGHIJKLMNOPQRSTUVWX') is null,
  'APL43-10g po anonimizacji sprawy nie da się odczytać kodem dostępu');
select public.dsa_transparency_report(now() - interval '1 day', now() + interval '1 day') as atr_after \gset
reset role;
select pg_temp.assert(
  (select redacted_at is not null and reporter_email is null and reporter_name is null and content_url is null
          and details is null and target_snapshot is null and access_code_hash is null
          and case_number = :'acase5' and category = 'other' and status::text = 'dismissed'
     from public.reports where id = :'ar5')
  and (select facts is null and redacted_at is not null and decision = 'no_action' from public.moderation_decisions where id = :'ad5')
  and (select count(*) from public.email_deliveries where entity_id = :'ar5' and payload <> '{}'::jsonb) = 0
  and (select count(*) from public.report_events where report_id = :'ar5' and event_type = 'redacted') = 1,
  'APL43-10h anonimizacja: dane osobowe i dowód usunięte, kategoria/rodzaj/daty zostają');
select pg_temp.assert(
  (select redacted_at is null and reporter_email is not null from public.reports where id = :'ar6')
  and (select redacted_at is null from public.reports where id = :'ar7')
  and (select redacted_at is null and details is not null from public.reports where id = :'ar2')
  and (select grounds is not null from public.moderation_appeals where id = :'aa2'),
  'APL43-10i sprawy w terminie odwołania, niepoinformowane i świeżo po odwołaniu — nienaruszone');
select pg_temp.assert((:'arun'::jsonb)->>'dryRun' = 'false' and ((:'arun'::jsonb)->>'redactedCases')::int >= 1
  and (select count(*) from public.audit_logs where action = 'dsa.retention_run') = 1
  and (:'atr_before'::jsonb)->'decisions' = (:'atr_after'::jsonb)->'decisions',
  'APL43-10j przebieg zapisany i w audycie; agregaty raportu bez zmian po anonimizacji');

-- APL43-11: raport przejrzystości i eksport — liczby i brak danych osobowych.
set role service_role;
select public.dsa_transparency_report(now() - interval '1 day', now() + interval '1 day') as atr \gset
select pg_temp.assert(
  ((:'atr'::jsonb)->'appeals'->>'total')::int = (select count(*) from public.moderation_appeals)
  and ((:'atr'::jsonb)->'appeals'->'byStatus'->>'reversed')::int = 2
  and ((:'atr'::jsonb)->'appeals'->'byAppellant'->>'reporter')::int = 1
  and ((:'atr'::jsonb)->'decisions'->>'fromAppeal')::int = 1
  and ((:'atr'::jsonb)->'decisions'->>'total')::int = (select count(*) from public.moderation_decisions
                                                         where decided_at > now() - interval '1 day')
  and ((:'atr'::jsonb)->'decisions'->>'automatedDecision')::int = 0
  and ((:'atr'::jsonb)->'restorations'->>'viaAppeal')::int = 1
  and ((:'atr'::jsonb)->'notices'->'byCategory'->>'fraud')::int
        = (select count(*) from public.reports where kind = 'dsa_notice' and category = 'fraud'
             and created_at > now() - interval '1 day'),
  'APL43-11 agregaty: zgłoszenia, podstawy, automatyzacja, odwołania i odwrócone decyzje');
select pg_temp.assert(
  (select count(*) from public.dsa_statements_export(now() - interval '1 day', now() + interval '1 day'))
    = (select count(*) from public.moderation_decisions where decided_at > now() - interval '1 day')
  and not exists (select 1 from public.dsa_statements_export(now() - interval '1 day', now() + interval '1 day') e
                   where to_jsonb(e)::text ~ '@|Gość|Oferta żąda'),
  'APL43-11b eksport: wiersz na decyzję, bez adresów, imion i faktów');
select pg_temp.expect_error('select public.dsa_transparency_report(now(), now() - interval ''1 day'')',
  'VALIDATION_FAILED', 'APL43-11c zły okres raportu');
reset role;
-- ============================================================================
-- RA43. Odwołanie zgłaszającego od COFNIĘCIA ograniczenia (0109, #43): ręczne cofnięcie
-- informuje zgłaszającego w jego języku; termin od poinformowania; od cofnięcia po odwołaniu
-- autora odwołanie nie przysługuje; rozpatruje ktoś inny niż osoba, która cofnęła;
-- uwzględnienie = nowa decyzja ograniczająca; retencja, raport i eksport.
-- ============================================================================
\echo '--- RA43 odwołanie od cofnięcia ---'
\set RAJ1 'e9800000-0000-0000-0000-0000000000b1'
\set RAJ2 'e9800000-0000-0000-0000-0000000000b2'
\set RAJ3 'e9800000-0000-0000-0000-0000000000b3'
\set RAJ4 'e9800000-0000-0000-0000-0000000000b4'
\set RAREASON 'Po ponownym przeglądzie oferta nie wymaga żadnych opłat.'
\set RAGROUNDS 'Rekruter nadal żąda opłaty; opisuję przebieg rozmowy telefonicznej.'
reset role; reset app.current_uid;
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'RAJ1',:'APCO','ra-job-1','Magazynier R1','warehouse','permanent','Antwerpia','Flandria','active','pl'),
  (:'RAJ2',:'APCO','ra-job-2','Magazynier R2','warehouse','permanent','Antwerpia','Flandria','active','pl'),
  (:'RAJ3',:'APCO','ra-job-3','Magazynier R3','warehouse','permanent','Antwerpia','Flandria','active','pl'),
  (:'RAJ4',:'APCO','ra-job-4','Magazynier R4','warehouse','permanent','Antwerpia','Flandria','active','pl');

set role service_role;
select report_id as rr1, case_number as rcase1 from public.submit_content_report(null, gen_random_uuid(),
  'ABCDEFGHIJKLMNOPQRSTUVWX', 'job', :'RAJ1', 'fraud', 'Oferta wymaga opłaty za rekrutację z góry.', null,
  'Gość Ra', 'ra1@test.be', 'fr', true) \gset
select report_id as rr2, case_number as rcase2 from public.submit_content_report(:'CANDA', gen_random_uuid(),
  'ABCDEFGHIJKLMNOPQRSTUVWX', 'job', :'RAJ2', 'fraud', 'Oferta wymaga opłaty za rekrutację z góry.', null, null,
  'ra2@test.be', 'en', true) \gset
select report_id as rr3, case_number as rcase3 from public.submit_content_report(null, gen_random_uuid(),
  'ABCDEFGHIJKLMNOPQRSTUVWX', 'job', :'RAJ3', 'fraud', 'Oferta wymaga opłaty za rekrutację z góry.', null, null,
  'ra3@test.be', 'nl', true) \gset
select report_id as rr4 from public.submit_content_report(null, gen_random_uuid(),
  'ABCDEFGHIJKLMNOPQRSTUVWX', 'job', :'RAJ4', 'fraud', 'Oferta wymaga opłaty za rekrutację z góry.', null, null,
  'ra4@test.be', 'nl', true) \gset
reset role;

set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_decide_report(:'rr1', 'open', 'job_removed', :'APFACTS', 'terms', 'Regulamin § 4') as rd1 \gset
select public.admin_decide_report(:'rr2', 'open', 'job_removed', :'APFACTS', 'terms', 'Regulamin § 4') as rd2 \gset
select public.admin_decide_report(:'rr3', 'open', 'job_removed', :'APFACTS', 'terms', 'Regulamin § 4') as rd3 \gset
select public.admin_decide_report(:'rr4', 'open', 'job_removed', :'APFACTS', 'terms', 'Regulamin § 4') as rd4 \gset
reset role; reset app.current_uid;

-- RA43-1: ręczne cofnięcie (inny admin niż autor decyzji) informuje zgłaszającego w JEGO języku.
set role authenticated; set app.current_uid = :'ADMIN2'; select pg_temp.assert_client_role();
select public.admin_restore_moderation(:'rd1', :'RAREASON') as rs1 \gset
select public.admin_restore_moderation(:'rd2', :'RAREASON') as rs2 \gset
select public.admin_restore_moderation(:'rd4', :'RAREASON') as rs4 \gset
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.email_deliveries where template = 'reportRestored' and entity_type = 'moderation_restoration'
     and entity_id = :'rs1' and to_email = 'ra1@test.be' and locale = 'fr' and profile_id is null
     and payload->>'caseNumber' = :'rcase1' and not (payload ? 'reason') and not (payload ? 'companyName')) = 1
  and (select count(*) from public.email_deliveries where template = 'reportRestored' and entity_id = :'rs2'
     and profile_id = :'CANDA' and locale = public.resolve_recipient_locale(:'CANDA') and locale <> 'en') = 1,
  'RA43-1 e-mail o cofnięciu do zgłaszającego: gość w języku formularza, konto wg profilu; bez powodu i danych autora');
set role service_role;
select pg_temp.assert(public.moderation_restoration_appealable(:'rs1') = 'OK'
  and public.moderation_restoration_appeal_deadline(:'rs1') is null,
  'RA43-1b e-mail w kolejce: odwołanie przysługuje, termin jeszcze nie biegnie');
reset role;

-- RA43-2: cofnięcie będące skutkiem odwołania autora — bez odwołania zgłaszającego i bez e-maila.
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select appeal_id as raa3 from public.submit_moderation_appeal(:'rd3', gen_random_uuid(), :'APGROUNDS') \gset
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'ADMIN2'; select pg_temp.assert_client_role();
select public.admin_decide_appeal(:'raa3', 'pending', 'reversed', :'RAREASON');
reset role; reset app.current_uid;
select id as rs3 from public.moderation_restorations where decision_id = :'rd3' \gset
set role service_role;
select pg_temp.assert(public.moderation_restoration_appealable(:'rs3') = 'INVALID_TRANSITION',
  'RA43-2 od cofnięcia po uwzględnionym odwołaniu autora odwołanie nie przysługuje');
select pg_temp.expect_error('select * from public.submit_report_restoration_appeal(''' || :'rcase3' || ''', ''ABCDEFGHIJKLMNOPQRSTUVWX'', gen_random_uuid(), ''' || :'RAGROUNDS' || ''')',
  'INVALID_TRANSITION', 'RA43-2b RPC odrzuca odwołanie od cofnięcia po odwołaniu autora');
select pg_temp.expect_error('select * from public.submit_report_restoration_appeal(''' || :'acase2' || ''', ''ABCDEFGHIJKLMNOPQRSTUVWX'', gen_random_uuid(), ''' || :'RAGROUNDS' || ''')',
  'INVALID_TRANSITION', 'RA43-2c sprawa bez cofnięcia: odwołanie od cofnięcia nie przysługuje');
reset role;
select pg_temp.assert((select count(*) from public.email_deliveries where template = 'reportRestored' and entity_id = :'rs3') = 0,
  'RA43-2d cofnięcie po odwołaniu autora nie wysyła zgłaszającemu e-maila o odwołaniu');

-- RA43-3: dostęp — tylko service_role (za limiterem), zły kod = NOT_FOUND.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select * from public.submit_report_restoration_appeal(''' || :'rcase2' || ''', ''ABCDEFGHIJKLMNOPQRSTUVWX'', gen_random_uuid(), ''' || :'RAGROUNDS' || ''')',
  'permission denied', 'RA43-3 klient nie woła RPC z pominięciem limitera');
select pg_temp.expect_error('select public.moderation_restoration_appealable(''' || :'rs1' || ''')',
  'permission denied', 'RA43-3b stan drogi odwołania tylko przez serwer');
reset role; reset app.current_uid;
set role service_role;
select pg_temp.expect_error('select * from public.submit_report_restoration_appeal(''' || :'rcase1' || ''', ''ABCDEFGHIJKLMNOPQRSTUVWY'', gen_random_uuid(), ''' || :'RAGROUNDS' || ''')',
  'NOT_FOUND', 'RA43-3c zły kod dostępu = NOT_FOUND');
reset role;

-- RA43-4: termin od POINFORMOWANIA o cofnięciu.
update public.email_deliveries set status = 'bounced', sent_at = now() - interval '2 years'
  where entity_id = :'rs2' and template = 'reportRestored';
set role service_role;
select pg_temp.assert(public.moderation_restoration_appeal_deadline(:'rs2') is null
  and public.moderation_restoration_appealable(:'rs2') = 'OK',
  'RA43-4 odbity e-mail o cofnięciu nie jest poinformowaniem');
reset role;
update public.email_deliveries set status = 'delivered' where entity_id = :'rs2' and template = 'reportRestored';
update public.email_deliveries set status = 'sent', sent_at = now() where entity_id = :'rs1' and template = 'reportRestored';
set role service_role;
select pg_temp.assert(public.moderation_restoration_appealable(:'rs2') = 'APPEAL_WINDOW_CLOSED',
  'RA43-4b dwa lata od doręczenia: termin odwołania od cofnięcia upłynął');
select pg_temp.expect_error('select * from public.submit_report_restoration_appeal(''' || :'rcase2' || ''', ''ABCDEFGHIJKLMNOPQRSTUVWX'', gen_random_uuid(), ''' || :'RAGROUNDS' || ''')',
  'APPEAL_WINDOW_CLOSED', 'RA43-4c odwołanie od cofnięcia po terminie odrzucone');
select public.get_report_case(:'rcase1', 'ABCDEFGHIJKLMNOPQRSTUVWX') as rlook1 \gset
reset role;
select pg_temp.assert((:'rlook1'::jsonb)->'restoration'->>'appealState' = 'OK'
  and ((:'rlook1'::jsonb)->'restoration'->>'appealDeadline')::timestamptz > now() + interval '5 months'
  and (:'rlook1'::jsonb)->'appeal' = 'null'::jsonb and (:'rlook1'::jsonb)->>'appealState' is null
  and position(:'RAREASON' in :'rlook1') = 0,
  'RA43-4d zgłaszający widzi cofnięcie i termin odwołania, bez powodu cofnięcia');

-- RA43-5: odwołanie od cofnięcia — idempotentne, jedno na cofnięcie, e-mail w języku zgłaszającego.
set role service_role;
select 'e9800000-0000-0000-0000-00000000a001' as rkey1 \gset
select appeal_id as rap1, created as rcr1 from public.submit_report_restoration_appeal(:'rcase1',
  'ABCDEFGHIJKLMNOPQRSTUVWX', :'rkey1', :'RAGROUNDS') \gset
select appeal_id as rap1r, created as rcr1r from public.submit_report_restoration_appeal(:'rcase1',
  'ABCDEFGHIJKLMNOPQRSTUVWX', :'rkey1', :'RAGROUNDS') \gset
select pg_temp.expect_error('select * from public.submit_report_restoration_appeal(''' || :'rcase1' || ''', ''ABCDEFGHIJKLMNOPQRSTUVWX'', gen_random_uuid(), ''' || :'RAGROUNDS' || ''')',
  'APPEAL_EXISTS', 'RA43-5 drugie odwołanie od tego samego cofnięcia');
select pg_temp.expect_error('select * from public.submit_report_restoration_appeal(''' || :'rcase1' || ''', ''ABCDEFGHIJKLMNOPQRSTUVWX'', gen_random_uuid(), ''za krótko'')',
  'GROUNDS_REQUIRED', 'RA43-5b uzasadnienie wymagane');
reset role;
select pg_temp.assert(:'rcr1'::boolean and not :'rcr1r'::boolean and :'rap1' = :'rap1r'
  and (select appellant_role = 'reporter' and appealed_restoration_id = :'rs1'::uuid and decision_id = :'rd1'::uuid
          and appellant_locale = 'fr' and status = 'pending' from public.moderation_appeals where id = :'rap1')
  and (select count(*) from public.email_deliveries where template = 'appealReceived' and entity_id = :'rap1'
         and to_email = 'ra1@test.be' and locale = 'fr' and payload->>'appealTarget' = 'restoration') = 1
  and (select count(*) from public.audit_logs where action = 'moderation.appeal_submitted' and entity_id = :'rr1'
         and after_data->>'appealedRestorationId' = :'rs1') = 1,
  'RA43-5c odwołanie od cofnięcia: idempotencja, stan, e-mail (fr), audyt');

-- RA43-6: strażniki tabeli (niezależne od RPC).
select pg_temp.expect_error('insert into public.moderation_appeals(reference, decision_id, report_id, appellant_role, appellant_locale, grounds, idempotency_key, due_at, appealed_restoration_id) values (''APL-X'', ''' || :'rd2' || ''', ''' || :'rr2' || ''', ''reporter'', ''pl'', ''' || :'RAGROUNDS' || ''', gen_random_uuid(), now(), ''' || :'rs1' || ''')',
  'nie dotyczy tej decyzji', 'RA43-6 cofnięcie innej decyzji odrzucone przez strażnik');
select pg_temp.expect_error('insert into public.moderation_appeals(reference, decision_id, report_id, appellant_role, appellant_locale, grounds, idempotency_key, due_at, appealed_restoration_id) values (''APL-Y'', ''' || :'rd2' || ''', ''' || :'rr2' || ''', ''author'', ''pl'', ''' || :'RAGROUNDS' || ''', gen_random_uuid(), now(), ''' || :'rs2' || ''')',
  'moderation_appeals_restoration_role', 'RA43-6b od cofnięcia odwołuje się wyłącznie zgłaszający');
select pg_temp.expect_error('update public.moderation_appeals set appealed_restoration_id = null where id = ''' || :'rap1' || '''',
  'niezmienne', 'RA43-6c celu odwołania nie zmienia bezpośredni zapis');

-- RA43-7: rozpatruje inny człowiek niż osoba, która COFNĘŁA (nie autor decyzji).
set role authenticated; set app.current_uid = :'ADMIN2'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.admin_decide_appeal(''' || :'rap1' || ''', ''pending'', ''upheld'', ''' || :'RAREASON' || ''')',
  'REVIEWER_CONFLICT', 'RA43-7 osoba, która cofnęła ograniczenie, nie rozpatruje odwołania od cofnięcia');
reset role; reset app.current_uid;
select pg_temp.assert((select decided_by = :'ADMIN'::uuid from public.moderation_decisions where id = :'rd1')
  and (select restored_by = :'ADMIN2'::uuid from public.moderation_restorations where id = :'rs1'),
  'RA43-7b kontrola: reguła 0104 (autor decyzji) zablokowałaby ADMIN i przepuściła ADMIN2');
-- Awaria skutku cofa całość.
create function pg_temp.ra_fail_job() returns trigger language plpgsql as $$
begin
  if new.id = 'e9800000-0000-0000-0000-0000000000b1'::uuid then raise exception 'INJECTED_RESTORATION_APPEAL_FAILURE'; end if;
  return new;
end $$;
create trigger trg_ra_fail before update on public.jobs for each row execute function pg_temp.ra_fail_job();
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select public.admin_decide_appeal(''' || :'rap1' || ''', ''pending'', ''reversed'', ''' || :'RAREASON' || ''', ''job_removed'', ''terms'', ''Regulamin § 4'')',
  'INJECTED_RESTORATION_APPEAL_FAILURE', 'RA43-7c awaria ponownego ograniczenia przerywa rozpatrzenie');
reset role; reset app.current_uid;
drop trigger trg_ra_fail on public.jobs;
select pg_temp.assert(
  (select status = 'pending' from public.moderation_appeals where id = :'rap1')
  and (select count(*) from public.moderation_decisions where appeal_id = :'rap1') = 0
  and (select status::text = 'active' and moderation_decision_id is null from public.jobs where id = :'RAJ1'),
  'RA43-7d po awarii: odwołanie oczekuje, treść bez nowego ograniczenia');
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_decide_appeal(:'rap1', 'pending', 'reversed', 'Zgłaszający wykazał, że opłata jest nadal pobierana.',
  'job_removed', 'terms', 'Regulamin § 4 ust. 2');
reset role; reset app.current_uid;
select new_decision_id as rd1n from public.moderation_appeals where id = :'rap1' \gset
select pg_temp.assert(
  (select status = 'reversed' and decided_by = :'ADMIN'::uuid and not same_reviewer and restoration_id is null
     from public.moderation_appeals where id = :'rap1')
  and (select appeal_id = :'rap1'::uuid and decision = 'job_removed' from public.moderation_decisions where id = :'rd1n')
  and (select status::text = 'resolved' and decision_id = :'rd1n'::uuid from public.reports where id = :'rr1')
  and (select status::text = 'closed' and moderation_decision_id = :'rd1n'::uuid from public.jobs where id = :'RAJ1')
  and (select count(*) from public.email_deliveries where template = 'appealReversed' and entity_id = :'rap1'
         and to_email = 'ra1@test.be' and locale = 'fr' and payload->>'appealTarget' = 'restoration'
         and not (payload ? 'companyName')) = 1
  and (select count(*) from public.email_deliveries where template = 'moderationJobRemoved' and entity_id = :'rd1n'
         and profile_id = :'EMPA') = 1,
  'RA43-7e uwzględnione odwołanie od cofnięcia: nowa decyzja, treść znów ograniczona, wyniki w językach odbiorców');
set role service_role;
select public.get_report_case(:'rcase1', 'ABCDEFGHIJKLMNOPQRSTUVWX') as rlook1b \gset
select pg_temp.assert(public.moderation_restoration_appealable(:'rs1') = 'APPEAL_EXISTS'
  and public.moderation_appealable(:'rd1n') = 'OK',
  'RA43-7f po rozpatrzeniu: od cofnięcia już nie, od nowej decyzji autor może się odwołać');
reset role;
select pg_temp.assert((:'rlook1b'::jsonb)->'restoration'->'appeal'->>'status' = 'reversed'
  and (:'rlook1b'::jsonb)->>'outcome' = 'action_taken',
  'RA43-7g zgłaszający widzi wynik odwołania od cofnięcia');

-- RA43-8: retencja — cofnięcie bez poinformowania czeka; po terminie od poinformowania — czyszczenie.
set session_replication_role = replica;
update public.moderation_restorations set restored_at = now() - interval '2 years' where id in (:'rs2', :'rs4');
set session_replication_role = origin;
update public.reports set resolved_at = now() - interval '2 years' where id in (:'rr2', :'rr4');
set role service_role;
select pg_temp.assert(
  exists (select 1 from public.dsa_retention_cases() where report_id = :'rr4' and retention_start is null)
  and exists (select 1 from public.dsa_retention_cases() where report_id = :'rr2' and eligible_at <= now())
  and exists (select 1 from public.dsa_retention_cases() where report_id = :'rr1' and retention_start is null),
  'RA43-8 niepoinformowany o cofnięciu czeka; po terminie od poinformowania i retencji — kwalifikuje się; nowa decyzja z odwołania otwiera drogę autora');
select pg_temp.assert((select greatest(r.resolved_at, mr.restored_at) + public.dsa_case_retention() <= now()
    from public.reports r join public.moderation_decisions d on d.report_id = r.id
    join public.moderation_restorations mr on mr.decision_id = d.id where r.id = :'rr4'),
  'RA43-8b kontrola: reguła 0104 (od chwili cofnięcia) objęłaby sprawę przed końcem drogi odwołania');
select public.dsa_retention_run(false) as rrun \gset
reset role;
select pg_temp.assert(
  (select redacted_at is not null from public.reports where id = :'rr2')
  and (select count(*) from public.email_deliveries where entity_id = :'rs2' and template = 'reportRestored'
         and payload = '{}'::jsonb) = 1
  and (select reason is null and redacted_at is not null from public.moderation_restorations where id = :'rs2')
  and (select redacted_at is null and reporter_email is not null from public.reports where id = :'rr4')
  and (select count(*) from public.email_deliveries where entity_id = :'rs4' and payload <> '{}'::jsonb) = 1,
  'RA43-8c anonimizacja obejmuje e-mail o cofnięciu; sprawa niepoinformowana nienaruszona');

-- RA43-9: raport i eksport — odwołanie od cofnięcia liczone osobno, wiersz na decyzję.
set role service_role;
select public.dsa_transparency_report(now() - interval '1 day', now() + interval '1 day') as rtr \gset
select pg_temp.assert(((:'rtr'::jsonb)->'appeals'->>'againstRestoration')::int = 1
  and (select appeal_status is null from public.dsa_statements_export(now() - interval '1 day', now() + interval '1 day')
        where decision_reference = (select reference from public.moderation_decisions where id = :'rd1'))
  and (select count(*) from public.dsa_statements_export(now() - interval '1 day', now() + interval '1 day'))
        = (select count(*) from public.moderation_decisions where decided_at > now() - interval '1 day'),
  'RA43-9 raport: odwołania od cofnięcia; eksport bez przypisania ich do decyzji jako jej odwołania');
reset role;
select pg_temp.assert((select count(*) from public.moderation_decisions d
    join public.moderation_appeals a on a.decision_id = d.id where d.id = :'rd1') = 1,
  'RA43-9b kontrola: złączenie po samej decyzji (0104) przypisałoby decyzji odwołanie od cofnięcia');
-- ============================================================================
-- CJ186. Zaufany odczyt oferty do materiałów kampanii (#186, #175, 0102): tylko aktywna,
-- niedemonstracyjna, niewygasła oferta zweryfikowanej firmy; wąskie pola bez PII; wejście
-- panelu tylko dla recruiter+ firmy oferty lub admina; kontrola ujemna po zdjęciu filtra.
-- ============================================================================
\set CJREC 'c1860000-0000-0000-0000-000000000001'
\set CJMEM 'c1860000-0000-0000-0000-000000000002'
\set CJOTH 'c1860000-0000-0000-0000-000000000003'
\set CJV   'c1860000-0000-0000-0000-0000000000a1'
\set CJD   'c1860000-0000-0000-0000-0000000000a2'
\set CJU   'c1860000-0000-0000-0000-0000000000a3'
\set CJO   'c1860000-0000-0000-0000-0000000000a4'
\set CJ1   'c1860000-0000-0000-0000-0000000000b1'
\set CJ2   'c1860000-0000-0000-0000-0000000000b2'
\set CJ3   'c1860000-0000-0000-0000-0000000000b3'
\set CJ4   'c1860000-0000-0000-0000-0000000000b4'
\set CJ5   'c1860000-0000-0000-0000-0000000000b5'
\set CJ6   'c1860000-0000-0000-0000-0000000000b6'
\set CJ7   'c1860000-0000-0000-0000-0000000000b7'
\set CJ8   'c1860000-0000-0000-0000-0000000000b8'
\echo '--- CJ186 campaign job source ---'
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'CJREC','cjrec@test.be','Cj Rec','{"role":"employer","first_name":"Cj","last_name":"Rec","locale":"pl"}'),
  (:'CJMEM','cjmem@test.be','Cj Mem','{"role":"employer","first_name":"Cj","last_name":"Mem","locale":"pl"}'),
  (:'CJOTH','cjoth@test.be','Cj Oth','{"role":"employer","first_name":"Cj","last_name":"Oth","locale":"pl"}');
insert into public.companies(id,name,status,is_demo,email) values
  (:'CJV','Kampania Sp','verified',false,'kontakt-cj@test.be'),
  (:'CJD','Demo Sp','verified',true,null),
  (:'CJU','Niezweryfikowana Sp','unverified',false,null),
  (:'CJO','Obca Sp','verified',false,null);
insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'CJV',:'CJREC','owner',true),
  (:'CJV',:'CJMEM','member',true),
  (:'CJO',:'CJOTH','owner',true);
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,
                        salary_min,salary_max,is_demo,expires_at,deleted_at) values
  (:'CJ1',:'CJV','cj-ok','Magazynier kampanii','warehouse','permanent','Antwerpia','Flandria','active','pl',2400,2800,false,now() + interval '10 days',null),
  (:'CJ2',:'CJV','cj-demo','Magazynier demo','warehouse','permanent','Antwerpia','Flandria','active','pl',null,null,true,null,null),
  (:'CJ3',:'CJV','cj-paused','Magazynier wstrzymany','warehouse','permanent','Antwerpia','Flandria','paused','pl',null,null,false,null,null),
  (:'CJ4',:'CJV','cj-expired','Magazynier wygasły','warehouse','permanent','Antwerpia','Flandria','active','pl',null,null,false,now() - interval '1 minute',null),
  (:'CJ5',:'CJD','cj-demo-company','Magazynier firmy demo','warehouse','permanent','Gandawa','Flandria','active','pl',null,null,false,null,null),
  (:'CJ6',:'CJU','cj-unverified','Magazynier bez weryfikacji','warehouse','permanent','Gandawa','Flandria','active','pl',null,null,false,null,null),
  (:'CJ7',:'CJV','cj-deleted','Magazynier usunięty','warehouse','permanent','Gandawa','Flandria','active','pl',null,null,false,null,now()),
  (:'CJ8',:'CJO','cj-other','Kierowca obcej firmy','transport','permanent','Liège','Walonia','active','pl',null,null,false,null,null);
insert into public.job_translations(job_id, locale, title) values
  (:'CJ1', 'nl', 'Magazijnmedewerker campagne'), (:'CJ1', 'pl', 'Magazynier kampanii PL');

-- Liczba wierszy publicznego wejścia pod bieżącą rolą.
create function pg_temp.cj_public(p_slug text, p_locale text default 'pl') returns int
language sql as $$ select count(*)::int from public.get_campaign_job(p_slug, p_locale) $$;
create function pg_temp.cj_managed(p_job uuid) returns int
language sql as $$ select count(*)::int from public.get_managed_campaign_job(p_job, 'pl') $$;

-- CJ186-1: kontrakt kolumn — tylko pola grafiki (bez id, kontaktu, opisu, członków firmy).
select pg_temp.assert(
  (select string_agg(parameter_name, ',' order by ordinal_position)
   from information_schema.parameters p join information_schema.routines r using (specific_schema, specific_name)
   where r.routine_schema = 'public' and r.routine_name = n and p.parameter_mode = 'OUT')
  = 'slug,title,company_name,city,region,contract_type,accommodation,salary_min,salary_max,currency,salary_period',
  'CJ186-1 ' || n || ': wąski zestaw kolumn')
from unnest(array['get_campaign_job', 'get_managed_campaign_job', 'campaign_job_source']) n;

-- CJ186-2: gość — aktywna oferta zwraca tłumaczenie tytułu, pozostałe przypadki jednakowo puste.
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select title = 'Magazijnmedewerker campagne' and company_name = 'Kampania Sp' and city = 'Antwerpia'
      and salary_min = 2400 and salary_max = 2800 and currency = 'EUR'
   from public.get_campaign_job('cj-ok', 'nl')),
  'CJ186-2 aktywna oferta: tytuł w żądanym języku, firma, miasto, stawka');
select pg_temp.assert((select title from public.get_campaign_job('cj-ok', 'fr')) = 'Magazynier kampanii PL',
  'CJ186-2b brak tłumaczenia → język domyślny oferty (jak get_public_job)');
select pg_temp.assert(pg_temp.cj_public(s) = 0, 'CJ186-2c brak danych: ' || s)
from unnest(array['cj-demo', 'cj-paused', 'cj-expired', 'cj-demo-company', 'cj-unverified',
                  'cj-deleted', 'cj-nie-istnieje']) s;
select pg_temp.assert(pg_temp.cj_public('cj-ok', 'xx') = 0, 'CJ186-2d język spoza listy → brak danych');
select pg_temp.expect_error('select * from public.campaign_job_source(null, ''cj-ok'', ''pl'')',
  'permission denied', 'CJ186-2e gość nie woła źródła bez filtrów uprawnień');
select pg_temp.expect_error('select * from public.get_managed_campaign_job(''' || :'CJ1' || ''', ''pl'')',
  'permission denied', 'CJ186-2f gość nie woła wejścia panelu');
-- Dotychczasowe publiczne RPC pokazuje ofertę demo — to jest luka, którą zamyka 0102.
select pg_temp.assert((select count(*) from public.get_public_job('cj-demo', 'pl')) = 1,
  'CJ186-2g get_public_job nie filtruje is_demo (dlatego osobne źródło)');
reset role;

-- CJ186-3: panel — recruiter+ firmy oferty i admin; member, obca firma i przypadki brzegowe puste.
set role authenticated; set app.current_uid = :'CJREC'; select pg_temp.assert_client_role();
select pg_temp.assert(pg_temp.cj_managed(:'CJ1') = 1, 'CJ186-3 owner firmy dostaje aktywną ofertę');
select pg_temp.assert(pg_temp.cj_managed(j) = 0, 'CJ186-3b owner: brak danych dla ' || j)
from unnest(array[:'CJ2', :'CJ3', :'CJ4', :'CJ7', :'CJ8', :'CJ5', :'CJ6']::uuid[]) j;
select pg_temp.expect_error('select * from public.campaign_job_source(''' || :'CJ1' || ''', null, ''pl'')',
  'permission denied', 'CJ186-3c zalogowany nie woła źródła bez filtrów uprawnień');
reset role;
set role authenticated; set app.current_uid = :'CJMEM'; select pg_temp.assert_client_role();
select pg_temp.assert(pg_temp.cj_managed(:'CJ1') = 0, 'CJ186-3d member (bez praw rekrutera) nie eksportuje');
reset role;
set role authenticated; set app.current_uid = :'CJOTH'; select pg_temp.assert_client_role();
select pg_temp.assert(pg_temp.cj_managed(:'CJ1') = 0 and pg_temp.cj_managed(:'CJ8') = 1,
  'CJ186-3e obca firma nie eksportuje cudzej oferty, własną tak');
reset role;
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.assert(pg_temp.cj_managed(:'CJ1') = 1 and pg_temp.cj_managed(:'CJ2') = 0,
  'CJ186-3f admin eksportuje aktywną ofertę, nie demo');
reset role; reset app.current_uid;
update public.company_members set is_active = false where company_id = :'CJV' and profile_id = :'CJMEM';
update public.company_members set role = 'recruiter' where company_id = :'CJV' and profile_id = :'CJMEM';
set role authenticated; set app.current_uid = :'CJMEM'; select pg_temp.assert_client_role();
select pg_temp.assert(pg_temp.cj_managed(:'CJ1') = 0, 'CJ186-3g nieaktywny recruiter nie eksportuje');
reset role; reset app.current_uid;

-- CJ186-4: kontrola ujemna — zdjęcie KAŻDEGO filtra źródła ujawnia odpowiadający przypadek,
-- więc asercje CJ186-2c wykrywają regresję (zmiana w transakcji cofanej).
create function pg_temp.cj_drop_filter(p_filter text) returns void language plpgsql as $$
declare
  v_def text := pg_get_functiondef('public.campaign_job_source(uuid, text, text)'::regprocedure);
begin
  if position(p_filter in v_def) = 0 then
    raise exception 'ASSERT FAILED: CJ186-4 filtr „%” nie występuje w źródle', p_filter;
  end if;
  execute replace(v_def, p_filter, 'true');
end $$;
begin; select pg_temp.cj_drop_filter('j.is_demo = false');
select pg_temp.assert(pg_temp.cj_public('cj-demo') = 1, 'CJ186-4 bez filtra is_demo oferta demo wycieka'); rollback;
begin; select pg_temp.cj_drop_filter('c.is_demo = false');
select pg_temp.assert(pg_temp.cj_public('cj-demo-company') = 1, 'CJ186-4b bez filtra is_demo firmy wycieka'); rollback;
begin; select pg_temp.cj_drop_filter('j.status = ''active''');
select pg_temp.assert(pg_temp.cj_public('cj-paused') = 1, 'CJ186-4c bez filtra statusu wycieka wstrzymana'); rollback;
begin; select pg_temp.cj_drop_filter('(j.expires_at is null or j.expires_at > now())');
select pg_temp.assert(pg_temp.cj_public('cj-expired') = 1, 'CJ186-4d bez filtra wygaśnięcia wycieka wygasła'); rollback;
begin; select pg_temp.cj_drop_filter('c.status = ''verified''');
select pg_temp.assert(pg_temp.cj_public('cj-unverified') = 1, 'CJ186-4e bez filtra weryfikacji wycieka'); rollback;
begin; select pg_temp.cj_drop_filter('j.deleted_at is null');
select pg_temp.assert(pg_temp.cj_public('cj-deleted') = 1, 'CJ186-4f bez filtra usunięcia wycieka'); rollback;
select pg_temp.assert(pg_temp.cj_public(s) = 0, 'CJ186-4g po cofnięciu filtry wróciły: ' || s)
from unnest(array['cj-demo', 'cj-demo-company', 'cj-paused', 'cj-expired', 'cj-unverified', 'cj-deleted']) s;

-- ============================================================================
-- BR490 (#490, 0106): rejestr incydentów i naruszeń danych osobowych — tylko admin,
-- niezmienna historia, CAS wersji, reguły art. 33/34, eksport, zawiadomienie osób przez
-- outbox w języku ODBIORCY. Kontrole ujemne (w transakcjach cofanych): grant SELECT bez
-- RLS, wyłączony trigger historii, treść w języku nadawcy — każda daje wykrywalny błąd.
-- ============================================================================
\set BRA 'e4900000-0000-0000-0000-0000000000a1'
\set BRB 'e4900000-0000-0000-0000-0000000000a2'
\set BRC 'e4900000-0000-0000-0000-0000000000a3'
\set BRK1 'e4900000-0000-0000-0000-0000000000c1'
\set BRK2 'e4900000-0000-0000-0000-0000000000c2'
\set BRN1 'e4900000-0000-0000-0000-0000000000d1'
\set BRN2 'e4900000-0000-0000-0000-0000000000d2'
reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'BRA','bra@test.be','Br A','{"role":"candidate","first_name":"Br","last_name":"A","locale":"pl"}'),
  (:'BRB','brb@test.be','Br B','{"role":"employer","first_name":"Br","last_name":"B","locale":"nl"}'),
  (:'BRC','brc@test.be','Br C','{"role":"candidate","first_name":"Br","last_name":"C","locale":"fr"}');
-- Adres BRC ma aktywną blokadę (#44) — zawiadomienie nie trafi do kolejki (widać w liczniku).
insert into public.email_suppressions(email, reason) values ('brc@test.be', 'hard_bounce');

select jsonb_build_object(
  'kind', 'personal_data_breach', 'title', 'Błędny adresat e-maila',
  'description', 'Powiadomienie trafiło do niewłaściwej osoby.',
  'detectedAt', (now() - interval '2 hours')::text, 'occurredAt', (now() - interval '3 hours')::text,
  'dataCategories', jsonb_build_array('contact', 'applications', 'contact'),
  'affectedCount', '1', 'affectedCountEstimated', false,
  'riskLevel', 'not_assessed', 'authorityDecision', 'pending', 'subjectsDecision', 'pending'
)::text as br_form \gset

-- BR490-1: tabele rejestru niedostępne bezpośrednio (także dla admina — tylko RPC).
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.expect_error('select 1 from public.breach_incidents', 'permission denied',
  'BR490-1 anon nie czyta rejestru');
select pg_temp.expect_error($$select public.admin_create_breach_incident(gen_random_uuid(), '{}'::jsonb)$$,
  'permission denied', 'BR490-1b anon nie wywoła RPC rejestru');
reset role;
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error('select 1 from public.breach_incidents', 'permission denied',
  'BR490-1c admin nie czyta tabeli bezpośrednio');
select pg_temp.expect_error('select 1 from public.breach_incident_events', 'permission denied',
  'BR490-1d admin nie czyta historii bezpośrednio');
select pg_temp.expect_error($$insert into public.breach_incidents(reference, client_key, title, description, detected_at)
  values ('X', gen_random_uuid(), 't', 'd', now())$$, 'permission denied', 'BR490-1e brak bezpośredniego INSERT');
select pg_temp.expect_error('select 1 from public.breach_notice_recipients', 'permission denied',
  'BR490-1f admin nie czyta listy odbiorców bezpośrednio');
reset role; reset app.current_uid;
-- KONTROLA UJEMNA: z grantem SELECT i bez RLS odczyt by przeszedł — asercje 1–1f to wykrywają.
begin;
grant select on public.breach_incidents to authenticated;
alter table public.breach_incidents disable row level security;
set local role authenticated; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) >= 0 from public.breach_incidents),
  'BR490-1g z grantem i bez RLS odczyt przechodzi (test wykrywa błąd)');
rollback;
reset role; reset app.current_uid;

-- BR490-2: kandydat i pracodawca nie mają dostępu do RPC (PERMISSION_DENIED).
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(format('select public.admin_create_breach_incident(%L, %L::jsonb)', :'BRK1', :'br_form'),
  'PERMISSION_DENIED', 'BR490-2 kandydat nie założy wpisu');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(format('select public.admin_export_breach_incident(%L, ''json'')', :'BRK1'),
  'PERMISSION_DENIED', 'BR490-2b pracodawca nie eksportuje');
reset role; reset app.current_uid;

-- BR490-3: admin zakłada wpis; ponowienie z tym samym kluczem = ten sam wpis.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_create_breach_incident(:'BRK1', :'br_form'::jsonb) as br1 \gset
select pg_temp.assert(public.admin_create_breach_incident(:'BRK1', :'br_form'::jsonb) = :'br1'::uuid,
  'BR490-3 ponowienie z tym samym kluczem zwraca ten sam wpis');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) = 1 and bool_and(reference ~ '^NAR-[0-9]{4}-[0-9A-F]{10}$' and version = 1
          and status = 'open' and data_categories = array['applications','contact']
          and affected_count = 1 and not affected_count_estimated and created_by = :'ADMIN'::uuid)
     from public.breach_incidents where client_key = :'BRK1'),
  'BR490-3b jeden wpis: numer, wersja 1, kategorie bez duplikatów, autor');
select pg_temp.assert(
  (select count(*) = 1 and bool_and(event_type = 'created' and changes ? 'title' and actor_id = :'ADMIN'::uuid)
     from public.breach_incident_events where incident_id = :'br1'),
  'BR490-3c historia: jedno zdarzenie created z polami');
select pg_temp.assert(
  (select count(*) = 1 and bool_and(actor_id = :'ADMIN'::uuid and after_data::text not like '%niewłaściwej%')
     from public.audit_logs where action = 'breach.created' and entity_id = :'br1'),
  'BR490-3d audyt breach.created bez treści opisu');

-- BR490-4: reguły art. 33/34 i wymagane uzasadnienia (kod pola w błędzie).
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(format('select public.admin_update_breach_incident(%L, 1, %L::jsonb)', :'br1',
  (:'br_form'::jsonb || '{"riskLevel":"risk"}')::text),
  'riskAssessment:required', 'BR490-4 ocena ryzyka wymaga uzasadnienia');
select pg_temp.expect_error(format('select public.admin_update_breach_incident(%L, 1, %L::jsonb)', :'br1',
  (:'br_form'::jsonb || '{"riskLevel":"risk","riskAssessment":"r","authorityDecision":"not_required","authorityDecisionReason":"x"}')::text),
  'authorityDecision:conflictsWithRisk', 'BR490-4b ryzyko + „nie zgłaszamy” odrzucone (art. 33)');
select pg_temp.expect_error(format('select public.admin_update_breach_incident(%L, 1, %L::jsonb)', :'br1',
  (:'br_form'::jsonb || '{"riskLevel":"high_risk","riskAssessment":"r","subjectsDecision":"not_required","subjectsDecisionReason":"x"}')::text),
  'subjectsDecision:conflictsWithRisk', 'BR490-4c wysokie ryzyko + „nie zawiadamiamy” odrzucone (art. 34)');
select pg_temp.expect_error(format('select public.admin_update_breach_incident(%L, 1, %L::jsonb)', :'br1',
  (:'br_form'::jsonb || '{"authorityDecision":"notify"}')::text),
  'authorityDecisionReason:required', 'BR490-4d decyzja bez uzasadnienia odrzucona');
select pg_temp.expect_error(format('select public.admin_update_breach_incident(%L, 1, %L::jsonb)', :'br1',
  (:'br_form'::jsonb || jsonb_build_object('riskLevel', 'risk', 'riskAssessment', 'r',
     'authorityDecision', 'notify', 'authorityDecisionReason', 'x',
     'detectedAt', (now() - interval '100 hours')::text, 'occurredAt', (now() - interval '101 hours')::text,
     'authorityNotifiedAt', (now() - interval '1 hour')::text))::text),
  'authorityDelayReason:required', 'BR490-4e zgłoszenie po 72 h wymaga przyczyn opóźnienia');
select pg_temp.expect_error(format('select public.admin_update_breach_incident(%L, 1, %L::jsonb)', :'br1',
  (:'br_form'::jsonb || jsonb_build_object('detectedAt', (now() + interval '1 day')::text))::text),
  'detectedAt:future', 'BR490-4f stwierdzenie w przyszłości odrzucone');
select pg_temp.expect_error(format('select public.admin_update_breach_incident(%L, 1, %L::jsonb)', :'br1',
  (:'br_form'::jsonb || '{"detectedAt":"nie-data"}')::text),
  'detectedAt:invalid', 'BR490-4g zła data odrzucona z kodem pola');
select pg_temp.expect_error(format('select public.admin_update_breach_incident(%L, 1, %L::jsonb)', :'br1',
  (:'br_form'::jsonb || '{"dataCategories":["cv_files","hasla"]}')::text),
  'dataCategories:invalid', 'BR490-4h kategoria spoza listy odrzucona');
reset role; reset app.current_uid;
-- CHECK na tabeli działa niezależnie od RPC (bezpośredni zapis właściciela).
select pg_temp.expect_error(format(
  $$update public.breach_incidents set risk_level = 'high_risk', risk_assessment = 'r',
    subjects_decision = 'not_required', subjects_decision_reason = 'x' where id = %L$$, :'br1'),
  'breach_subjects_vs_risk', 'BR490-4i CHECK art. 34 także poza RPC');

-- BR490-5: edycja z CAS wersji; różnice w historii; zapis bez zmian nie tworzy zdarzenia.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.assert(public.admin_update_breach_incident(:'br1', 1,
  (:'br_form'::jsonb || jsonb_build_object('riskLevel', 'high_risk', 'riskAssessment', 'Dane kontaktowe i aplikacja',
     'authorityDecision', 'notify', 'authorityDecisionReason', 'Prawdopodobne ryzyko',
     'subjectsDecision', 'notify', 'subjectsDecisionReason', 'Wysokie ryzyko',
     'actionsTaken', 'Poprawiono wybór adresata'))) = 2,
  'BR490-5 edycja podnosi wersję do 2');
select pg_temp.expect_error(format('select public.admin_update_breach_incident(%L, 1, %L::jsonb)', :'br1', :'br_form'),
  'STALE_STATE', 'BR490-5b nieaktualna wersja → STALE_STATE');
select pg_temp.assert(public.admin_update_breach_incident(:'br1', 2,
  (:'br_form'::jsonb || jsonb_build_object('riskLevel', 'high_risk', 'riskAssessment', 'Dane kontaktowe i aplikacja',
     'authorityDecision', 'notify', 'authorityDecisionReason', 'Prawdopodobne ryzyko',
     'subjectsDecision', 'notify', 'subjectsDecisionReason', 'Wysokie ryzyko',
     'actionsTaken', 'Poprawiono wybór adresata'))) = 2,
  'BR490-5c zapis bez zmian nie podnosi wersji');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) = 1 and bool_and(version = 2 and changes -> 'risk_level' = '{"from":"not_assessed","to":"high_risk"}'::jsonb
          and not changes ? 'title')
     from public.breach_incident_events where incident_id = :'br1' and event_type = 'updated'),
  'BR490-5d jedno zdarzenie updated tylko ze zmienionymi polami (przed/po)');
select pg_temp.assert(
  (select after_data -> 'fields' ? 'risk_level' and after_data::text not like '%Dane kontaktowe%'
     from public.audit_logs where action = 'breach.updated' and entity_id = :'br1'),
  'BR490-5e audyt: nazwy pól bez treści');

-- BR490-6: historia i wpis niezmienne dla KAŻDEJ roli (tu superuser).
select pg_temp.expect_error(format('update public.breach_incident_events set note = %L where incident_id = %L', 'x', :'br1'),
  'BREACH_HISTORY_IMMUTABLE', 'BR490-6 historia bez UPDATE');
select pg_temp.expect_error(format('delete from public.breach_incident_events where incident_id = %L', :'br1'),
  'BREACH_HISTORY_IMMUTABLE', 'BR490-6b historia bez DELETE');
select pg_temp.expect_error('truncate public.breach_incident_events', 'BREACH_HISTORY_IMMUTABLE',
  'BR490-6c historia bez TRUNCATE');
select pg_temp.expect_error(format('delete from public.breach_incidents where id = %L', :'br1'),
  'BREACH_REGISTER_NO_DELETE', 'BR490-6d wpisu rejestru nie da się usunąć');
select pg_temp.expect_error(format('update public.breach_incidents set reference = %L where id = %L', 'NAR-0000-X', :'br1'),
  'BREACH_REGISTER_IMMUTABLE_FIELD', 'BR490-6e numeru wpisu nie da się zmienić');
-- KONTROLA UJEMNA: bez triggera wpis historii dałby się przepisać.
begin;
alter table public.breach_incident_events disable trigger trg_breach_events_immutable;
update public.breach_incident_events set note = 'przepisane' where incident_id = :'br1';
select pg_temp.assert(exists (select 1 from public.breach_incident_events where note = 'przepisane'),
  'BR490-6f bez triggera historia jest zmienialna (test wykrywa błąd)');
rollback;

-- BR490-7: zamknięcie tylko po udokumentowaniu decyzji; zamknięty wpis bez edycji; ponowne otwarcie.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(format('select public.admin_close_breach_incident(%L, 2, %L)', :'br1', 'Koniec'),
  'BREACH_NOT_READY: authorityNotifiedAt', 'BR490-7 zamknięcie bez daty zgłoszenia do organu odrzucone');
select pg_temp.expect_error(format('select public.admin_close_breach_incident(%L, 2, %L)', :'br1', '  '),
  'closureSummary:required', 'BR490-7b zamknięcie wymaga podsumowania');
reset role; reset app.current_uid;

-- BR490-8: eksport — wpis, historia, bez klucza klienta; eksport zostaje w historii i dzienniku.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_export_breach_incident(:'br1', 'json')::text as br_export \gset
select pg_temp.expect_error(format('select public.admin_export_breach_incident(%L, ''xml'')', :'br1'),
  'format:invalid', 'BR490-8 nieznany format odrzucony');
reset role; reset app.current_uid;
select pg_temp.assert(
  (:'br_export'::jsonb -> 'incident' ->> 'reference') ~ '^NAR-'
  and not (:'br_export'::jsonb -> 'incident' ? 'client_key')
  and jsonb_array_length(:'br_export'::jsonb -> 'events') = 2,
  'BR490-8b eksport: wpis bez client_key + dwa zdarzenia (created, updated)');
select pg_temp.assert(
  (select count(*) = 1 from public.breach_incident_events where incident_id = :'br1' and event_type = 'exported')
  and (select count(*) = 1 from public.audit_logs where action = 'breach.exported' and entity_id = :'br1'),
  'BR490-8c eksport zapisany w historii i w dzienniku');

-- BR490-9: zawiadomienie osób — treść wymagana w języku KAŻDEGO odbiorcy (Invariant #1).
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_notify_breach_subjects(:'br1', :'BRN1',
  array[:'BRA', 'BRB@test.be', 'nieznany@test.be', :'BRC'],
  '{"pl":{"subject":"Temat PL","body":"Treść PL"},"en":{"subject":"Subject EN","body":"Body EN"}}'::jsonb)::text as br_invalid \gset
reset role; reset app.current_uid;
select pg_temp.assert(
  :'br_invalid'::jsonb ->> 'status' = 'invalid'
  and :'br_invalid'::jsonb -> 'missingLocales' = '["fr", "nl"]'::jsonb
  and :'br_invalid'::jsonb -> 'unknown' = '["nieznany@test.be"]'::jsonb,
  'BR490-9 brak treści nl/fr i nieznany adres → invalid');
select pg_temp.assert(not exists (select 1 from public.email_deliveries where template = 'breachNotice')
  and not exists (select 1 from public.breach_notices),
  'BR490-9b nic nie zakolejkowano przy błędnym zestawie');

set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_notify_breach_subjects(:'br1', :'BRN1', array[:'BRA', 'BRB@test.be', :'BRC'],
  '{"pl":{"subject":"Temat PL","body":"Treść PL"},"nl":{"subject":"Onderwerp NL","body":"Tekst NL"},"fr":{"subject":"Sujet FR","body":"Texte FR"}}'::jsonb)::text as br_ok \gset
select pg_temp.assert(public.admin_notify_breach_subjects(:'br1', :'BRN1', array[:'BRA'], '{}'::jsonb)::jsonb
    -> 'noticeId' = :'br_ok'::jsonb -> 'noticeId',
  'BR490-9c ponowienie z tym samym kluczem zwraca to samo zawiadomienie');
reset role; reset app.current_uid;
select pg_temp.assert(
  :'br_ok'::jsonb ->> 'status' = 'queued' and (:'br_ok'::jsonb ->> 'recipients')::int = 3
  and (:'br_ok'::jsonb ->> 'queued')::int = 2,
  'BR490-9d 3 odbiorców, 2 w kolejce (adres z blokadą pominięty)');
select pg_temp.assert(
  (select count(*) = 2
          and bool_and((profile_id = :'BRA'::uuid and locale = 'pl' and payload ->> 'noticeSubject' = 'Temat PL'
                        and payload ->> 'panel' = 'candidate')
                    or (profile_id = :'BRB'::uuid and locale = 'nl' and payload ->> 'noticeSubject' = 'Onderwerp NL'
                        and payload ->> 'panel' = 'employer'))
     from public.email_deliveries where template = 'breachNotice'),
  'BR490-9e każdy e-mail w języku odbiorcy (pl/nl), nie nadawcy (admin: en)');
select pg_temp.assert(
  (select count(*) = 3 and count(*) filter (where queued) = 2 from public.breach_notice_recipients),
  'BR490-9f lista odbiorców z flagą kolejki');
select pg_temp.assert(
  (select count(*) = 1 from public.breach_incident_events where incident_id = :'br1' and event_type = 'subjects_notified')
  and (select after_data::text not like '%bra@test.be%' from public.audit_logs
        where action = 'breach.subjects_notified' and entity_id = :'br1'),
  'BR490-9g historia i dziennik bez adresów odbiorców');
-- KONTROLA UJEMNA: treść wybierana po języku nadawcy (admin = en) dałaby zły język.
select pg_temp.assert(public.resolve_recipient_locale(:'ADMIN') = 'en'
  and (select payload ->> 'noticeSubject' from public.email_deliveries
        where template = 'breachNotice' and profile_id = :'BRB') <> 'Subject EN',
  'BR490-9h język nadawcy różni się od odbiorcy — test rozróżnia te przypadki');

-- BR490-10: incydent bez decyzji o zawiadomieniu — brak wysyłki; zamknięcie i ponowne otwarcie.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_create_breach_incident(:'BRK2',
  (:'br_form'::jsonb || '{"kind":"security_incident","title":"Skan portów"}')::text::jsonb) as br2 \gset
select pg_temp.expect_error(format('select public.admin_notify_breach_subjects(%L, %L, array[%L], %L::jsonb)',
    :'br2', :'BRN2', :'BRA', '{"pl":{"subject":"a","body":"b"}}'),
  'BREACH_NOTIFY_NOT_DECIDED', 'BR490-10 bez decyzji o zawiadomieniu nie ma wysyłki');
select pg_temp.assert(public.admin_close_breach_incident(:'br2', 1, 'Brak danych osobowych') = 2,
  'BR490-10b incydent bezpieczeństwa zamykany bez decyzji art. 33/34');
select pg_temp.expect_error(format('select public.admin_update_breach_incident(%L, 2, %L::jsonb)', :'br2', :'br_form'),
  'BREACH_CLOSED', 'BR490-10c zamkniętego wpisu nie edytujemy');
select pg_temp.expect_error(format('select public.admin_reopen_breach_incident(%L, 2, %L)', :'br2', ''),
  'reason:required', 'BR490-10d ponowne otwarcie wymaga powodu');
select pg_temp.assert(public.admin_reopen_breach_incident(:'br2', 2, 'Nowe ustalenia') = 3,
  'BR490-10e ponowne otwarcie z powodem');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status = 'open' and closed_at is null and closure_summary = '' from public.breach_incidents where id = :'br2')
  and (select array_agg(event_type order by created_at, version) = array['created','closed','reopened']
         from public.breach_incident_events where incident_id = :'br2')
  and (select note = 'Brak danych osobowych' from public.breach_incident_events
        where incident_id = :'br2' and event_type = 'closed'),
  'BR490-10f podsumowanie zamknięcia zostaje w historii po ponownym otwarciu');

-- BR490-11: panel admina czyta rejestr service-rolem (po potwierdzeniu roli w aplikacji).
set role service_role;
select pg_temp.assert((select count(*) = 2 from public.breach_incidents)
  and (select count(*) >= 6 from public.breach_incident_events)
  and (select count(*) = 1 from public.breach_notices),
  'BR490-11 service_role czyta wpisy, historię i zawiadomienia');
reset role;

-- BR490-12: usunięcie konta admina (FK `on delete set null`) zeruje autora w historii,
-- wpisie i zawiadomieniu; każda inna zmiana tych wierszy nadal odrzucana.
begin;
select pg_temp.assert((select count(*) > 0 from public.breach_incident_events where actor_id = :'ADMIN'),
  'BR490-12 przygotowanie: admin jest autorem wpisów historii');
update public.breach_incident_events set actor_id = null where actor_id = :'ADMIN';
update public.breach_incidents set created_by = null where created_by = :'ADMIN';
update public.breach_notices set created_by = null where created_by = :'ADMIN';
select pg_temp.assert((select count(*) = 0 from public.breach_incident_events where actor_id is not null)
  and (select count(*) = 0 from public.breach_incidents where created_by is not null),
  'BR490-12 autor wyzerowany jak przy usunięciu konta');
select pg_temp.expect_error(format('update public.breach_incident_events set note = %L where incident_id = %L', 'x', :'br1'),
  'BREACH_HISTORY_IMMUTABLE', 'BR490-12b inna zmiana historii nadal odrzucana');
select pg_temp.expect_error(format('update public.breach_incidents set created_by = %L where id = %L', :'ADMIN', :'br1'),
  'BREACH_REGISTER_IMMUTABLE_FIELD', 'BR490-12c autora nie da się podmienić');
select pg_temp.expect_error(format('update public.breach_notices set queued_count = 0 where incident_id = %L', :'br1'),
  'BREACH_HISTORY_IMMUTABLE', 'BR490-12d zawiadomienie nadal niezmienne');
rollback;

-- ============================================================================
-- LOC348. Invariant #1 na żywej bazie (#348): email_deliveries.locale = język ODBIORCY
--   dla każdego szablonu z przepływów (§9 + weryfikacja firmy + zaproszenie do zespołu),
--   nadawca zawsze w innym języku niż odbiorca, oferta w trzecim (default_locale='pl'
--   ≠ preferowane języki stron). Fallback preferred → account → signup → 'en'.
--   Kontrole ujemne: resolve_recipient_locale podmieniony na język SESJI NADAWCY albo
--   na odwróconą kolejność fallbacku → ten sam predykat daje fałsz.
--   Całość w transakcji z rollbackiem — dalsze sekcje nie widzą tych danych. Sekcja stoi
--   na końcu pliku (jak BR490-12): harness rate-limit.test.ts owija cały plik w jedno
--   BEGIN … ROLLBACK, a `rollback` kończy wtedy także tę zewnętrzną transakcję.
-- ============================================================================
\set CAN348 'e3480000-0000-0000-0000-0000000000a1'
\set OWN348 'e3480000-0000-0000-0000-0000000000a2'
\set REC348 'e3480000-0000-0000-0000-0000000000a3'
\set INV348 'e3480000-0000-0000-0000-0000000000a4'
\set SGN348 'e3480000-0000-0000-0000-0000000000a5'
\set NUL348 'e3480000-0000-0000-0000-0000000000a6'
\set COM348 'e3480000-0000-0000-0000-0000000000f1'
\set JOB348 'e3480000-0000-0000-0000-0000000000b1'
\set JOB348B 'e3480000-0000-0000-0000-0000000000b2'
reset role; reset app.current_uid;
begin;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'CAN348','can348@test.be','Clara F','{"role":"candidate","first_name":"Clara","last_name":"Fontaine","locale":"pl"}'),
  (:'OWN348','own348@test.be','Owen E','{"role":"employer","first_name":"Owen","last_name":"Evans","locale":"nl"}'),
  (:'REC348','rec348@test.be','Rita P','{"role":"employer","first_name":"Rita","last_name":"Peeters","locale":"fr"}'),
  (:'INV348','inv348@test.be','Ivo N','{"role":"employer","first_name":"Ivo","last_name":"Nowak","locale":"fr"}'),
  (:'SGN348','sgn348@test.be','Sam S','{"role":"candidate","first_name":"Sam","last_name":"S","locale":"nl"}'),
  (:'NUL348','nul348@test.be','Nel N','{"role":"candidate","first_name":"Nel","last_name":"N"}');
-- Języki: kandydat fr (preferred; signup pl), owner en (preferred; signup nl),
-- rekruter pl (account; signup fr, bez preferred), zapraszany fr (tylko signup),
-- SGN nl (tylko signup), NUL bez żadnego języka → en. Admin w tej transakcji: nl.
update public.profiles set preferred_locale = 'fr' where id = :'CAN348';
update public.profiles set preferred_locale = 'en' where id = :'OWN348';
update public.profiles set preferred_locale = null, account_locale = 'pl', signup_locale = 'fr' where id = :'REC348';
update public.profiles set preferred_locale = null, account_locale = null where id in (:'INV348', :'SGN348');
update public.profiles set preferred_locale = null, account_locale = null, signup_locale = null where id = :'NUL348';
update public.profiles set preferred_locale = 'nl' where id = :'ADMIN';

create temp table loc348_expected(profile_id uuid primary key, locale text not null) on commit drop;
insert into loc348_expected values
  (:'CAN348','fr'), (:'OWN348','en'), (:'REC348','pl'), (:'INV348','fr'), (:'SGN348','nl'), (:'NUL348','en');

-- Predykat wszystkich asercji sekcji (używany także w kontrolach ujemnych):
-- istnieje ≥1 wiersz szablonu dla odbiorcy i KAŻDY ma locale = oczekiwany język odbiorcy.
create function pg_temp.loc348_ok(p_template text, p_profile uuid) returns boolean
language sql as $$
  select count(*) > 0 and bool_and(d.locale = e.locale)
    from public.email_deliveries d join loc348_expected e on e.profile_id = d.profile_id
   where d.template = p_template and d.profile_id = p_profile
$$;

-- LOC348-1: fallback w bazie (ten sam kod, którego używa enqueue_email).
select pg_temp.assert(
  public.resolve_recipient_locale(:'CAN348') = 'fr'
  and public.resolve_recipient_locale(:'REC348') = 'pl'
  and public.resolve_recipient_locale(:'SGN348') = 'nl'
  and public.resolve_recipient_locale(:'NUL348') = 'en'
  and public.resolve_recipient_locale('e3480000-0000-0000-0000-00000000dead') = 'en',
  'LOC348-1 fallback preferred → account → signup → en (także brak profilu)');

-- Firma czeka na weryfikację; admin (nl) weryfikuje → companyVerified do ownera (en).
insert into public.companies(id,name,status) values (:'COM348','Firma 348','pending');
insert into public.company_members(company_id,profile_id,role,is_active) values
  (:'COM348',:'OWN348','owner',true), (:'COM348',:'REC348','recruiter',true);
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  (:'JOB348',:'COM348','job-348','Operator 348','warehouse','permanent','Gent','Flandria','active','pl'),
  (:'JOB348B',:'COM348','job-348b','Operator 348B','warehouse','permanent','Gent','Flandria','active','pl');
select set_config('app.current_uid', :'ADMIN', false);
set role authenticated; select pg_temp.assert_client_role();
select public.admin_set_company_status(:'COM348'::uuid, 'verified', 'pending', null);
reset role; reset app.current_uid;
select pg_temp.assert(pg_temp.loc348_ok('companyVerified', :'OWN348'),
  'LOC348-2 companyVerified w języku ownera (en), nie admina (nl)');

-- Kandydat (fr) aplikuje dwa razy → newApplication do ownera (en) i rekrutera (pl).
select set_config('app.current_uid', :'CAN348', false);
set role authenticated; select pg_temp.assert_client_role();
select public.apply_to_job(:'JOB348'::uuid, 'loc348-app-1', null, null, 'Bonjour') as app348 \gset
select public.apply_to_job(:'JOB348B'::uuid, 'loc348-app-2', null, null, null) as app348b \gset
reset role; reset app.current_uid;
select pg_temp.assert(pg_temp.loc348_ok('newApplication', :'OWN348')
  and pg_temp.loc348_ok('newApplication', :'REC348'),
  'LOC348-3 newApplication: owner en, rekruter pl (nadawca fr, oferta pl)');

-- Rekruter (pl) zmienia statusy i wysyła propozycję → e-maile do kandydata (fr).
select set_config('app.current_uid', :'REC348', false);
set role authenticated; select pg_temp.assert_client_role();
select public.transition_application(:'app348'::uuid, 'viewed');
select public.transition_application(:'app348'::uuid, 'shortlisted');
select public.send_offer(:'JOB348'::uuid, :'CAN348'::uuid, 'loc348-off-1', 'Zapraszamy', null) as off348 \gset
reset role;
-- Drugą propozycję wysyła owner (en): odpowiedź trafia do NADAWCY propozycji.
select set_config('app.current_uid', :'OWN348', false);
set role authenticated; select pg_temp.assert_client_role();
select public.send_offer(:'JOB348B'::uuid, :'CAN348'::uuid, 'loc348-off-2', 'Invitation', null) as off348b \gset
reset role; reset app.current_uid;
select pg_temp.assert(pg_temp.loc348_ok('applicationViewed', :'CAN348'),
  'LOC348-4 applicationViewed w języku kandydata (fr), nie rekrutera (pl)');
select pg_temp.assert(pg_temp.loc348_ok('statusChanged', :'CAN348'),
  'LOC348-5 statusChanged w języku kandydata (fr)');
select pg_temp.assert(pg_temp.loc348_ok('jobOffer', :'CAN348')
  and (select bool_and(locale = 'fr') from public.offers where id in (:'off348', :'off348b')),
  'LOC348-6 jobOffer i offers.locale w języku kandydata (fr)');

-- Kandydat akceptuje propozycję rekrutera i odrzuca propozycję ownera → odpowiedź do nadawcy.
select set_config('app.current_uid', :'CAN348', false);
set role authenticated; select pg_temp.assert_client_role();
select public.respond_to_offer(:'off348'::uuid, true);
select public.respond_to_offer(:'off348b'::uuid, false);
reset role; reset app.current_uid;
select pg_temp.assert(pg_temp.loc348_ok('offerAccepted', :'REC348'),
  'LOC348-7 offerAccepted do rekrutera w jego języku (pl), nie kandydata (fr)');
select pg_temp.assert(pg_temp.loc348_ok('offerDeclined', :'OWN348'),
  'LOC348-8 offerDeclined do ownera w jego języku (en)');

-- Wiadomości w obie strony.
select set_config('app.current_uid', :'REC348', false);
set role authenticated; select pg_temp.assert_client_role();
select public.get_or_create_conversation(:'app348'::uuid, null) as conv348 \gset
select public.send_message(:'conv348'::uuid, 'Dzień dobry', gen_random_uuid()) as msg348a \gset
reset role;
select set_config('app.current_uid', :'CAN348', false);
set role authenticated; select pg_temp.assert_client_role();
select public.send_message(:'conv348'::uuid, 'Merci', gen_random_uuid()) as msg348b \gset
reset role; reset app.current_uid;
select pg_temp.assert(pg_temp.loc348_ok('newMessage', :'CAN348'),
  'LOC348-9 newMessage firma → kandydat w języku kandydata (fr)');
select pg_temp.assert(pg_temp.loc348_ok('newMessage', :'OWN348')
  and pg_temp.loc348_ok('newMessage', :'REC348'),
  'LOC348-9b newMessage kandydat → firma: owner en, rekruter pl');

-- Zaproszenie do zespołu: owner (en) zaprasza konto pracodawcy z samym signup fr.
select set_config('app.current_uid', :'OWN348', false);
set role authenticated; select pg_temp.assert_client_role();
select invitation_id as inv348 from public.invite_company_member(:'COM348'::uuid, 'inv348@test.be', 'recruiter') \gset
reset role; reset app.current_uid;
select pg_temp.assert(pg_temp.loc348_ok('teamInvitation', :'INV348'),
  'LOC348-10 teamInvitation w języku zaproszonego (signup fr), nie zapraszającego (en)');

-- LOC348-11: pokrycie — KAŻDY e-mail wygenerowany w sekcji ma język odbiorcy i żaden
-- szablon z listy nie został pominięty (nowy szablon w tych przepływach = aktualizacja listy).
select pg_temp.assert(
  (select bool_and(d.locale = e.locale) from public.email_deliveries d
     join loc348_expected e on e.profile_id = d.profile_id)
  and (select array_agg(distinct d.template order by d.template) from public.email_deliveries d
     join loc348_expected e on e.profile_id = d.profile_id)
    = array['applicationViewed','companyVerified','jobOffer','newApplication','newMessage',
            'offerAccepted','offerDeclined','statusChanged','teamInvitation'],
  'LOC348-11 wszystkie e-maile sekcji w języku odbiorcy, komplet szablonów');

-- Kontrola ujemna 1: regresja „język sesji nadawcy”. Rekruter (pl) zmienia status →
-- statusChanged do kandydata dostaje pl; ten sam predykat musi to wykryć.
savepoint loc348_neg;
create or replace function public.resolve_recipient_locale(p_profile_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select p.preferred_locale from public.profiles p where p.id = auth.uid()),
                  (select p.account_locale from public.profiles p where p.id = auth.uid()), 'en');
$$;
select set_config('app.current_uid', :'REC348', false);
set role authenticated; select pg_temp.assert_client_role();
select public.transition_application(:'app348b'::uuid, 'viewed');
reset role; reset app.current_uid;
select pg_temp.assert(not pg_temp.loc348_ok('applicationViewed', :'CAN348'),
  'LOC348-N1 kontrola ujemna: język nadawcy (pl) zamiast odbiorcy (fr) wykryty');
rollback to savepoint loc348_neg;

-- Kontrola ujemna 2: odwrócona kolejność fallbacku (signup przed preferred).
savepoint loc348_neg2;
create or replace function public.resolve_recipient_locale(p_profile_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(p.signup_locale, p.account_locale, p.preferred_locale)
                     from public.profiles p where p.id = p_profile_id), 'en');
$$;
select pg_temp.assert(public.resolve_recipient_locale(:'CAN348') <> 'fr'
  and public.resolve_recipient_locale(:'REC348') <> 'pl',
  'LOC348-N2 kontrola ujemna: odwrócony fallback daje inny język niż oczekiwany');
rollback to savepoint loc348_neg2;
select pg_temp.assert(public.resolve_recipient_locale(:'CAN348') = 'fr',
  'LOC348-N3 po kontrolach ujemnych funkcja produkcyjna wróciła');
rollback;

-- ============================================================================
-- SV25. Worker poczty na puli service (#25, 0107): claim_email_batch wykonywalne przez
--       service_role, nadal NIE przez authenticated/anon (kontrola ujemna na obu rolach).
-- ============================================================================
reset role; reset app.current_uid;
select pg_temp.assert(
  has_function_privilege('service_role', 'public.claim_email_batch(integer, integer)', 'EXECUTE'),
  'SV25-1 service_role wykonuje claim_email_batch');
select pg_temp.assert(
  not has_function_privilege('authenticated', 'public.claim_email_batch(integer, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.claim_email_batch(integer, integer)', 'EXECUTE'),
  'SV25-2 authenticated/anon bez EXECUTE na claim_email_batch');
set role service_role;
select pg_temp.assert((select count(*) >= 0 from public.claim_email_batch(1, 60)),
  'SV25-3 claim jako service_role (bez błędu uprawnień)');
reset role;

-- ============================================================================
-- OL112. Linki firmy w publicznym detalu oferty (0114): get_public_job zwraca
--        company_website / company_logo_url tylko dla firmy verified i tylko jako
--        bezwzględny https (public_https_url). Kontrole ujemne w transakcjach cofanych:
--        bez walidacji zły URL wycieka, bez bramki weryfikacji wycieka link firmy
--        niezweryfikowanej (po zdjęciu filtra wierszy).
-- ============================================================================
\set OLV 'c1080000-0000-0000-0000-0000000000a1'
\set OLB 'c1080000-0000-0000-0000-0000000000a2'
\set OLU 'c1080000-0000-0000-0000-0000000000a3'
\set OLN 'c1080000-0000-0000-0000-0000000000a4'
\echo '--- OL112 company links in get_public_job ---'
reset role; reset app.current_uid;
insert into public.companies(id,name,status,is_demo,website,logo_url) values
  (:'OLV','Linki Sp','verified',false,' https://www.linki.example/o-nas?x=1 ','https://cdn.linki.example/logo.png'),
  (:'OLB','Złe Linki Sp','verified',false,'http://zle.example','javascript:alert(1)'),
  (:'OLU','Bez Weryfikacji Sp','unverified',false,'https://bez.example','https://bez.example/logo.png'),
  (:'OLN','Bez Linków Sp','verified',false,null,'');
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale) values
  ('c1080000-0000-0000-0000-0000000000b1',:'OLV','ol-ok','Magazynier linki','warehouse','permanent','Gent','Flandria','active','pl'),
  ('c1080000-0000-0000-0000-0000000000b2',:'OLB','ol-bad','Magazynier złe linki','warehouse','permanent','Gent','Flandria','active','pl'),
  ('c1080000-0000-0000-0000-0000000000b3',:'OLU','ol-unverified','Magazynier bez weryfikacji','warehouse','permanent','Gent','Flandria','active','pl'),
  ('c1080000-0000-0000-0000-0000000000b4',:'OLN','ol-none','Magazynier bez linków','warehouse','permanent','Gent','Flandria','active','pl');

-- OL112-1: walidator — tylko bezwzględny https z hostem; reszta null.
select pg_temp.assert(public.public_https_url(u) is null, 'OL112-1 odrzucony adres: ' || coalesce(u, '<null>'))
from unnest(array[null, '', '   ', 'http://a.example', 'javascript:alert(1)', '//a.example',
                  'https://localhost', 'https://a.example/x y', 'https://a.example/"><script>',
                  'https://user:pw@a.example', 'https://a.example/' || repeat('x', 2048),
                  'HTTPS://A.EXAMPLE', 'data:text/html,x', 'https://-a.example']) u;
select pg_temp.assert(public.public_https_url(' https://a.example/logo.png?v=2#x ') = 'https://a.example/logo.png?v=2#x',
  'OL112-1b poprawny https (obcięte spacje)');
select pg_temp.assert(public.public_https_url('https://a.example:8443') = 'https://a.example:8443',
  'OL112-1c https z portem');

-- OL112-2: gość — poprawne linki firmy verified; złe i puste → null; firma niezweryfikowana → brak wiersza.
set role anon; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select company_website = 'https://www.linki.example/o-nas?x=1'
      and company_logo_url = 'https://cdn.linki.example/logo.png'
   from public.get_public_job('ol-ok', 'pl')),
  'OL112-2 firma verified: website i logo');
select pg_temp.assert(
  (select company_website is null and company_logo_url is null from public.get_public_job('ol-bad', 'pl')),
  'OL112-2b http / javascript: → brak pól');
select pg_temp.assert(
  (select company_website is null and company_logo_url is null from public.get_public_job('ol-none', 'pl')),
  'OL112-2c brak / pusty adres → brak pól');
select pg_temp.assert((select count(*) from public.get_public_job('ol-unverified', 'pl')) = 0,
  'OL112-2d firma niezweryfikowana → brak oferty (i linków)');
reset role;

-- OL112-3: kontrole ujemne (zmiana definicji w transakcji cofanej).
create function pg_temp.ol_patch(p_from text, p_to text) returns void language plpgsql as $$
declare
  v_def text := pg_get_functiondef('public.get_public_job(text, text)'::regprocedure);
begin
  if position(p_from in v_def) = 0 then
    raise exception 'ASSERT FAILED: OL112-3 fragment „%” nie występuje w get_public_job', p_from;
  end if;
  execute replace(v_def, p_from, p_to);
end $$;
-- Bez walidacji adresu zły URL trafia do wyniku (więc OL112-2b wykrywa regresję).
begin; select pg_temp.ol_patch('public.public_https_url(c.website)', 'c.website');
select pg_temp.assert((select company_website from public.get_public_job('ol-bad', 'pl')) = 'http://zle.example',
  'OL112-3 bez walidacji wycieka http'); rollback;
-- Po zdjęciu filtra wierszy bramka kolumny nadal ukrywa link firmy niezweryfikowanej…
begin; select pg_temp.ol_patch(E'and c.status = ''verified''\n', '');
select pg_temp.assert(
  (select company_website is null and company_logo_url is null from public.get_public_job('ol-unverified', 'pl')),
  'OL112-3b bramka kolumny: niezweryfikowana firma bez linków');
-- …a bez niej link wycieka (asercja OL112-3b wykrywa regresję).
select pg_temp.ol_patch('case when c.status = ''verified'' then public.public_https_url(c.website)',
                        'case when true then public.public_https_url(c.website)');
select pg_temp.assert((select company_website from public.get_public_job('ol-unverified', 'pl')) = 'https://bez.example',
  'OL112-3c bez bramki weryfikacji wycieka link'); rollback;
select pg_temp.assert(
  (select company_website is null and company_logo_url is null from public.get_public_job('ol-bad', 'pl'))
  and (select count(*) from public.get_public_job('ol-unverified', 'pl')) = 0,
  'OL112-3d po cofnięciu definicja wróciła');

-- ============================================================================
-- PL109. Payloady e-maili i odczyt historii (0113; #293, #22, #290, #184):
--   send_offer → expiresAt + kwoty oferty (bez treści wiadomości rekrutera, #503),
--   send_message → conversationId, get_applied_jobs_display(p_locale, p_job_ids).
--   Kontrole ujemne (transakcje cofane): definicja bez nowego klucza → asercja pada.
-- ============================================================================
\set PLC  'e1080000-0000-0000-0000-00000000000c'
\set PLC2 'e1080000-0000-0000-0000-00000000000d'
\set PLE  'e1080000-0000-0000-0000-0000000000a1'
\set PLCO 'e1080000-0000-0000-0000-0000000000f1'
\set PLJ1 'e1080000-0000-0000-0000-0000000000b1'
\set PLJ2 'e1080000-0000-0000-0000-0000000000b2'
\set PLJ3 'e1080000-0000-0000-0000-0000000000b3'
reset role; reset app.current_uid;
insert into auth.users(id,email,name,raw_user_meta_data) values
  (:'PLC','plc@test.be','Noor V','{"role":"candidate","first_name":"Noor","last_name":"Vermeulen","locale":"nl"}'),
  (:'PLC2','plc2@test.be','Luc D','{"role":"candidate","first_name":"Luc","last_name":"Dubois","locale":"fr"}'),
  (:'PLE','ple@test.be','Piotr R','{"role":"employer","first_name":"Piotr","last_name":"Rekruter","locale":"pl"}');
insert into public.companies(id,name,status) values (:'PLCO','Firma PL109','verified');
insert into public.company_members(company_id,profile_id,role,is_active) values (:'PLCO',:'PLE','owner',true);
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,
                        salary_min,salary_max,currency,salary_period,expires_at) values
  (:'PLJ1',:'PLCO','job-pl109-1','Magazynier PL109','warehouse','permanent','Gent','Flandria','active','pl',
   2500,3100,'EUR','month', now() + interval '10 days'),
  (:'PLJ2',:'PLCO','job-pl109-2','Kierowca PL109','warehouse','permanent','Gent','Flandria','active','pl',
   null,null,'EUR','hour', null),
  (:'PLJ3',:'PLCO','job-pl109-3','Pomocnik PL109','warehouse','permanent','Gent','Flandria','active','pl',
   null,null,'EUR','month', null);
insert into public.candidate_profiles(profile_id, is_searchable) values (:'PLC', false), (:'PLC2', false);

select set_config('app.current_uid', :'PLC', false);
set role authenticated; select pg_temp.assert_client_role();
select public.apply_to_job(:'PLJ1'::uuid, 'pl109-app-1', null, null, null) as plapp1 \gset
select public.apply_to_job(:'PLJ2'::uuid, 'pl109-app-2', null, null, null) as plapp2 \gset
reset role;
select set_config('app.current_uid', :'PLC2', false);
set role authenticated; select pg_temp.assert_client_role();
select public.apply_to_job(:'PLJ3'::uuid, 'pl109-app-3', null, null, null) as plapp3 \gset
reset role;
select set_config('app.current_uid', :'PLE', false);
set role authenticated; select pg_temp.assert_client_role();
select public.send_offer(:'PLJ1'::uuid, :'PLC'::uuid, 'pl109-off-1', 'Bel me op 0470 12 34 56', null) as ploff1 \gset
select public.send_offer(:'PLJ2'::uuid, :'PLC'::uuid, 'pl109-off-2', null, null) as ploff2 \gset
select public.get_or_create_conversation(:'plapp1'::uuid, null) as plconv \gset
select public.send_message(:'plconv'::uuid, 'Dzień dobry', gen_random_uuid()) as plmsg \gset
reset role; reset app.current_uid;

-- PL109-1: termin = offers.expires_at (ten, który sprawdza respond_to_offer) jako ISO.
select pg_temp.assert(
  (select (d.payload->>'expiresAt')::timestamptz = o.expires_at
     from public.email_deliveries d join public.offers o on o.id = d.entity_id
    where d.entity_id = :'ploff1' and d.template = 'jobOffer'),
  'PL109-1 jobOffer.expiresAt = offers.expires_at');
-- PL109-2: kwoty jako liczby + okres i waluta (tekst składa worker w locale odbiorcy).
select pg_temp.assert(
  (select payload->'salaryMin' = '2500'::jsonb and payload->'salaryMax' = '3100'::jsonb
      and payload->>'salaryPeriod' = 'month' and payload->>'currency' = 'EUR'
      and not payload ? 'salary'
     from public.email_deliveries where entity_id = :'ploff1' and template = 'jobOffer'),
  'PL109-2 jobOffer niesie kwoty oferty, bez gotowego tekstu wynagrodzenia');
-- PL109-3: oferta bez kwot → null (worker pomija pole), okres z danych.
select pg_temp.assert(
  (select payload ? 'salaryMin' and payload->'salaryMin' = 'null'::jsonb
      and payload->'salaryMax' = 'null'::jsonb and payload->>'salaryPeriod' = 'hour'
      and payload->>'expiresAt' is not null
     from public.email_deliveries where entity_id = :'ploff2' and template = 'jobOffer'),
  'PL109-3 oferta bez kwot: null w payloadzie, termin domyślny (+30 dni) obecny');
-- PL109-4: treść wiadomości rekrutera zostaje w offers, NIE trafia do payloadu (#503).
select pg_temp.assert(
  (select o.message from public.offers o where o.id = :'ploff1') = 'Bel me op 0470 12 34 56'
  and (select not payload ? 'message' and payload::text not like '%0470%'
         from public.email_deliveries where entity_id = :'ploff1' and template = 'jobOffer'),
  'PL109-4 payload jobOffer bez treści wiadomości rekrutera');
-- PL109-5: język e-maila = język ODBIORCY (nl), nie nadawcy (pl) — Invariant #1.
select pg_temp.assert(
  (select locale from public.email_deliveries where entity_id = :'ploff1' and template = 'jobOffer') = 'nl',
  'PL109-5 jobOffer w języku kandydata');
-- PL109-6: newMessage niesie identyfikator rozmowy (CTA do wątku).
select pg_temp.assert(
  (select payload->>'conversationId' = :'plconv' and locale = 'nl'
     from public.email_deliveries where entity_id = :'plmsg' and profile_id = :'PLC'),
  'PL109-6 newMessage.conversationId = rozmowa wiadomości');

-- PL109-7: get_applied_jobs_display — filtr p_job_ids wewnątrz RPC, tylko własne aplikacje.
set role authenticated; set app.current_uid = :'PLC'; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.get_applied_jobs_display('pl')) = 2,
  'PL109-7 bez filtra: cała historia własnych aplikacji (zgodność wstecz)');
select pg_temp.assert(
  (select array_agg(job_id::text) from public.get_applied_jobs_display(p_locale => 'pl',
     p_job_ids => array[:'PLJ1'::uuid])) = array[:'PLJ1'::text],
  'PL109-7b filtr zwraca tylko wskazaną ofertę');
select pg_temp.assert(
  (select count(*) from public.get_applied_jobs_display(p_locale => 'pl',
     p_job_ids => array[:'PLJ3'::uuid, gen_random_uuid()])) = 0,
  'PL109-7c cudza aplikacja (PLC2) i nieznany job_id w filtrze → brak wierszy');
select pg_temp.assert(
  (select count(*) from public.get_applied_jobs_display(p_locale => 'pl', p_job_ids => array[]::uuid[])) = 0,
  'PL109-7d pusta lista → brak wierszy');
select pg_temp.expect_error(
  'select count(*) from public.get_applied_jobs_display(''pl'', array(select gen_random_uuid() from generate_series(1, 101)))',
  'VALIDATION_FAILED', 'PL109-7e ponad 100 identyfikatorów odrzucone');
reset role; reset app.current_uid;
select pg_temp.assert(
  to_regprocedure('public.get_applied_jobs_display(text)') is null
  and has_function_privilege('authenticated', 'public.get_applied_jobs_display(text, uuid[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_applied_jobs_display(text, uuid[])', 'EXECUTE'),
  'PL109-7f stary podpis usunięty; EXECUTE tylko authenticated');

-- KONTROLA UJEMNA 1: send_offer bez expiresAt → asercja PL109-1 wykrywa brak.
begin;
do $pl$ begin
  execute regexp_replace(pg_get_functiondef('public.send_offer(uuid, uuid, text, text, timestamptz)'::regprocedure),
    '''expiresAt'', v_expires,', '', 'g');
end $pl$;
select pg_temp.assert(pg_get_functiondef('public.send_offer(uuid, uuid, text, text, timestamptz)'::regprocedure)
  not like '%expiresAt%', 'PL109-N1 mutacja usunęła klucz expiresAt');
select set_config('app.current_uid', :'PLE', false);
set local role authenticated; select pg_temp.assert_client_role();
select public.send_offer(:'PLJ3'::uuid, :'PLC2'::uuid, 'pl109-off-neg', null, null) as ploffneg \gset
reset role;
select pg_temp.assert(
  not coalesce((select (payload->>'expiresAt')::timestamptz is not null
     from public.email_deliveries where entity_id = :'ploffneg' and template = 'jobOffer'), false),
  'PL109-N1b bez klucza predykat PL109-1 jest fałszywy (test wykrywa regresję)');
rollback;
reset role; reset app.current_uid;

-- KONTROLA UJEMNA 2: send_message bez conversationId → asercja PL109-6 wykrywa brak.
begin;
do $pl$ begin
  execute regexp_replace(pg_get_functiondef('public.send_message(uuid, text, uuid)'::regprocedure),
    ',\s*''conversationId'', p_conversation_id', '', 'g');
end $pl$;
select pg_temp.assert(pg_get_functiondef('public.send_message(uuid, text, uuid)'::regprocedure)
  not like '%''conversationId''%', 'PL109-N2 mutacja usunęła klucz conversationId');
select set_config('app.current_uid', :'PLE', false);
set local role authenticated; select pg_temp.assert_client_role();
select public.send_message(:'plconv'::uuid, 'Druga', gen_random_uuid()) as plmsgneg \gset
reset role;
select pg_temp.assert(
  not coalesce((select payload->>'conversationId' = :'plconv'
     from public.email_deliveries where entity_id = :'plmsgneg' and profile_id = :'PLC'), false),
  'PL109-N2b bez klucza predykat PL109-6 jest fałszywy (test wykrywa regresję)');
rollback;
reset role; reset app.current_uid;

-- ============================================================================
-- LOC194. Słownik miejscowości z aliasami (#194, 0112): gminy Belgii + lista kanoniczna,
--         aliasy PL/NL/FR/EN po kluczu cityKey, odczyt publiczny, zapis tylko serwisowy.
-- ============================================================================
reset role; reset app.current_uid;
select pg_temp.assert(
  (select count(*) from public.locations where kind = 'municipality' and is_demo = false) >= 560
  and (select count(*) from public.locations where kind = 'former_municipality') >= 20,
  'LOC194-1 gminy obecne i zniesione przy fuzjach w słowniku');
select pg_temp.assert(not exists (
    select 1 from public.locations l
     where l.country = 'BE' and l.latitude is not null
       and not exists (select 1 from public.location_aliases a where a.location_id = l.id)),
  'LOC194-2 każda miejscowość ma alias');
select pg_temp.assert(
  (select (name, latitude, longitude, sort_order) = ('Brussels', 50.850300, 4.351700, 10)
     from public.locations where slug = 'brussels')
  and (select (name, latitude, longitude, sort_order) = ('Liège', 50.632600, 5.579700, 70)
     from public.locations where slug = 'liege'),
  'LOC194-3 wiersze 0010 bez zmian');

-- Zapytanie loadera (src/lib/data/matching.ts) pod rolą klienta i RLS.
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.assert(
  (select array_agg(format('%s:%s,%s', a.alias_key, l.latitude, l.longitude) order by a.alias_key)
     from public.location_aliases a join public.locations l on l.id = a.location_id
    where l.is_active = true and a.alias_key = any(array['antwerpia', 'luik', 'atlantyda']))
  = array['antwerpia:51.219400,4.402500', 'luik:50.632600,5.579700'],
  'LOC194-4 alias PL/NL → współrzędne, nieznane miasto bez wiersza');
select pg_temp.assert(
  (select location_id from public.location_aliases where alias_key = 'elsene')
  = (select location_id from public.location_aliases where alias_key = 'ixelles'),
  'LOC194-5 nazwy NL/FR gminy spoza listy w kodzie wskazują ten sam wiersz');
select pg_temp.expect_error(
  'insert into public.location_aliases (location_id, alias, alias_key) select id, ''X'', ''x-loc194'' from public.locations limit 1',
  'permission denied', 'LOC194-6 zalogowany nie dodaje aliasu');
select pg_temp.expect_error('update public.location_aliases set alias = alias',
  'permission denied', 'LOC194-6b zalogowany nie zmienia aliasu');
select pg_temp.expect_error('update public.locations set latitude = 0',
  'permission denied', 'LOC194-6c zalogowany nie zmienia współrzędnych');
reset role; reset app.current_uid;
set role anon; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.location_aliases where alias_key = 'bruksela') = 1,
  'LOC194-7 anon czyta aliasy');
select pg_temp.expect_error('delete from public.location_aliases',
  'permission denied', 'LOC194-7b anon nie usuwa aliasów');
reset role;

-- Integralność: jeden klucz = jedna miejscowość, klucz w postaci cityKey, NIS unikalny.
select pg_temp.expect_error(
  'insert into public.location_aliases (location_id, alias, alias_key) select id, ''Antwerpia'', ''antwerpia'' from public.locations where slug = ''ghent''',
  'duplicate key', 'LOC194-8 alias nie wskazuje dwóch miejscowości');
select pg_temp.expect_error(
  'insert into public.location_aliases (location_id, alias, alias_key) select id, ''Sint-X'', ''Sint-X'' from public.locations where slug = ''ghent''',
  'location_aliases_key_format', 'LOC194-8b klucz nie w postaci cityKey');
select pg_temp.expect_error(
  'update public.locations set refnis = (select refnis from public.locations where slug = ''antwerp'') where slug = ''ghent''',
  'duplicate key', 'LOC194-8c kod NIS unikalny');

-- Usunięcie miejscowości usuwa jej aliasy (kaskada), bez sierot.
begin;
delete from public.locations where slug = 'namur';
select pg_temp.assert(not exists (select 1 from public.location_aliases where alias_key in ('namur', 'namen')),
  'LOC194-9 aliasy usuwane kaskadowo');
rollback;

-- Kontrola ujemna: bez polityki odczytu klient nie widzi aliasów (RLS włączone, deny).
begin;
drop policy location_aliases_public_read on public.location_aliases;
set role anon; select pg_temp.assert_client_role();
select pg_temp.assert((select count(*) from public.location_aliases) = 0,
  'LOC194-10 kontrola ujemna: bez polityki RLS brak odczytu');
reset role;
rollback;

-- ============================================================================
-- AC45. Panel admina kampanii e-mail (#45, 0111): admin_activate/cancel_email_campaign —
--       tylko admin (is_admin), CAS statusu (STALE_STATE), macierz przejść
--       (INVALID_TRANSITION), skutek = istniejące RPC z 0101, audyt bez treści i odbiorców.
-- ============================================================================
reset role; reset app.current_uid;
select public.create_email_campaign_revision('ac45-news', :'CMJOBS'::jsonb) as ac_rev1 \gset

-- AC45-1: anon bez EXECUTE; kandydat i pracodawca → PERMISSION_DENIED, bez zmiany stanu.
set role anon; reset app.current_uid; select pg_temp.assert_client_role();
select pg_temp.expect_error(format('select public.admin_activate_email_campaign(%L, ''draft'')', :'ac_rev1'),
  'permission denied', 'AC45-1 anon nie wywoła aktywacji');
reset role;
set role authenticated; set app.current_uid = :'CANDA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(format('select public.admin_activate_email_campaign(%L, ''draft'')', :'ac_rev1'),
  'PERMISSION_DENIED', 'AC45-1b kandydat nie aktywuje');
select pg_temp.expect_error(format('select public.activate_email_campaign(%L)', :'ac_rev1'),
  'permission denied', 'AC45-1c kandydat nie wywoła RPC service_role z 0101');
reset role; reset app.current_uid;
set role authenticated; set app.current_uid = :'EMPA'; select pg_temp.assert_client_role();
select pg_temp.expect_error(format('select public.admin_cancel_email_campaign(%L, ''draft'')', :'ac_rev1'),
  'PERMISSION_DENIED', 'AC45-1d pracodawca nie zatrzyma');
select pg_temp.expect_error('select count(*) from public.email_campaigns', 'permission denied',
  'AC45-1e pracodawca nie czyta tabeli kampanii');
reset role; reset app.current_uid;
select pg_temp.assert((select status from public.email_campaigns where id = :'ac_rev1') = 'draft',
  'AC45-1f odmowy nie zmieniły rewizji');

-- AC45-2: CAS — admin widział inny status → STALE_STATE, bez zmiany i bez audytu.
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select pg_temp.expect_error(format('select public.admin_activate_email_campaign(%L, ''active'')', :'ac_rev1'),
  'STALE_STATE', 'AC45-2 nieaktualny status → STALE_STATE');
select pg_temp.expect_error(format('select public.admin_cancel_email_campaign(%L, null)', :'ac_rev1'),
  'STALE_STATE', 'AC45-2b brak oczekiwanego statusu → STALE_STATE');
select pg_temp.expect_error(format('select public.admin_activate_email_campaign(%L, ''draft'')', gen_random_uuid()),
  'NOT_FOUND', 'AC45-2c nieistniejąca rewizja → NOT_FOUND');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status from public.email_campaigns where id = :'ac_rev1') = 'draft'
  and not exists (select 1 from public.audit_logs where entity_id = :'ac_rev1'::uuid),
  'AC45-2d po odmowie: szkic bez zmian, brak wpisu w dzienniku');

-- AC45-3: aktywacja szkicu przez admina + audyt (aktor = admin, bez treści kampanii).
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_activate_email_campaign(:'ac_rev1', 'draft');
select pg_temp.expect_error(format('select public.admin_activate_email_campaign(%L, ''active'')', :'ac_rev1'),
  'INVALID_TRANSITION', 'AC45-3 aktywna rewizja nie jest ponownie aktywowana');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status = 'active' and activated_at is not null from public.email_campaigns where id = :'ac_rev1'),
  'AC45-3b szkic aktywny');
select pg_temp.assert(
  (select count(*) = 1 and bool_and(actor_id = :'ADMIN'::uuid and entity_type = 'email_campaign'
                                    and before_data ->> 'status' = 'draft' and after_data ->> 'status' = 'active'
                                    and not (after_data ? 'content') and not (before_data ? 'content'))
     from public.audit_logs where action = 'email_campaign.activated' and entity_id = :'ac_rev1'::uuid),
  'AC45-3c audyt aktywacji: admin, statusy, bez treści');

-- AC45-4: aktywacja nowszej rewizji zastępuje poprzednią (skutek 0101), audyt ją wymienia.
select public.create_email_campaign_revision('ac45-news', :'CMJOBS'::jsonb) as ac_rev2 \gset
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_activate_email_campaign(:'ac_rev2', 'draft');
select pg_temp.expect_error(format('select public.admin_cancel_email_campaign(%L, ''superseded'')', :'ac_rev1'),
  'INVALID_TRANSITION', 'AC45-4 zastąpionej rewizji nie da się zatrzymać');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status from public.email_campaigns where id = :'ac_rev1') = 'superseded'
  and (select status from public.email_campaigns where id = :'ac_rev2') = 'active'
  and (select after_data -> 'superseded' -> 0 ->> 'id' from public.audit_logs
        where action = 'email_campaign.activated' and entity_id = :'ac_rev2'::uuid) = :'ac_rev1',
  'AC45-4b poprzednia rewizja zastąpiona i wymieniona w audycie');

-- AC45-5: zatrzymanie aktywnej rewizji — zakolejkowany list wygaszony, odbiorca cancelled,
--         audyt z liczbą wygaszonych listów; ponowienie ze starym statusem → STALE_STATE.
insert into public.email_deliveries(profile_id, to_email, template, status, entity_type, entity_id,
                                    idempotency_key, campaign_id)
values (:'CMN1', 'cmn1@test.be', 'newsletter', 'queued', 'email_campaign', :'ac_rev2',
        'campaign:' || :'ac_rev2' || ':' || :'CMN1', :'ac_rev2')
returning id as ac_delivery \gset
insert into public.email_campaign_recipients(campaign_id, profile_id, status, delivery_id)
values (:'ac_rev2', :'CMN1', 'queued', :'ac_delivery');
set role authenticated; set app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_cancel_email_campaign(:'ac_rev2', 'active');
select pg_temp.expect_error(format('select public.admin_cancel_email_campaign(%L, ''active'')', :'ac_rev2'),
  'STALE_STATE', 'AC45-5 drugi admin ze starym widokiem → STALE_STATE');
reset role; reset app.current_uid;
select pg_temp.assert(
  (select status from public.email_campaigns where id = :'ac_rev2') = 'cancelled'
  and (select status::text || '/' || error_message from public.email_deliveries where id = :'ac_delivery')
      = 'failed/suppressed_campaign_inactive'
  and (select status || '/' || reason from public.email_campaign_recipients
        where campaign_id = :'ac_rev2' and profile_id = :'CMN1') = 'cancelled/cancelled',
  'AC45-5b rewizja zatrzymana, list wygaszony, odbiorca cancelled');
select pg_temp.assert(
  (select (after_data ->> 'suppressed_deliveries')::int = 1 and actor_id = :'ADMIN'::uuid
          and not (after_data ? 'profile_id') and not (after_data ? 'to_email')
     from public.audit_logs where action = 'email_campaign.cancelled' and entity_id = :'ac_rev2'::uuid),
  'AC45-5c audyt zatrzymania: liczba listów, bez danych odbiorcy');

-- AC45-6: KONTROLA UJEMNA — wersja bez porównania statusu przepuściłaby decyzję opartą
--         na nieaktualnym widoku (asercja AC45-2 wykrywa brak CAS).
begin;
create or replace function public.admin_cancel_email_campaign(p_campaign_id uuid, p_expected_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  perform public.cancel_email_campaign(p_campaign_id);
end $$;
select public.create_email_campaign_revision('ac45-neg', :'CMJOBS'::jsonb) as ac_neg \gset
set local role authenticated; set local app.current_uid = :'ADMIN'; select pg_temp.assert_client_role();
select public.admin_cancel_email_campaign(:'ac_neg', 'active');
reset role;
select pg_temp.assert((select status from public.email_campaigns where id = :'ac_neg') = 'cancelled',
  'AC45-6 bez CAS nieaktualny widok (active ≠ draft) zatrzymuje rewizję — test wykrywa błąd');
rollback;
reset role; reset app.current_uid;

-- ============================================================================
-- SU47. Wyszukiwanie ofert bez diakrytyków i z literalnym %/_/\ (0110, #47):
--       get_public_jobs/_count/facety składają tytuł i miasto przez search_fold
--       (lower + unaccent) i escapują wpis użytkownika. Prefiltr po indeksach nie
--       zmienia wyniku (dokładny warunek na wyświetlanym tytule w locale).
-- ============================================================================
\set SUCO  'e8000000-0000-0000-0000-0000000047c0'
\set SUJA  'e8000000-0000-0000-0000-0000000047a1'
\set SUJB  'e8000000-0000-0000-0000-0000000047a2'
\set SUJC  'e8000000-0000-0000-0000-0000000047a3'
\set SUJD  'e8000000-0000-0000-0000-0000000047a4'
reset role; reset app.current_uid;
begin;
insert into public.companies(id, name, status) values (:'SUCO', 'SU47 Firma', 'verified');
insert into public.jobs(id,company_id,slug,title,category,contract_type,city,region,status,default_locale,published_at) values
  (:'SUJA',:'SUCO','su47-a','Pracownik sprzątania SU47X','cleaning','permanent','Liège','Walonia','active','pl', now() - interval '1 hour'),
  (:'SUJB',:'SUCO','su47-b','Rabat 50% SU47X','warehouse','permanent','Bruxelles','Bruksela','active','pl', now() - interval '2 hours'),
  (:'SUJC',:'SUCO','su47-c','Kierowca_C SU47X','transport','permanent','Gent','Flandria','active','pl', now() - interval '3 hours'),
  (:'SUJD',:'SUCO','su47-d','Magazynier SU47X','warehouse','permanent','Namur','Walonia','active','pl', now() - interval '4 hours');
insert into public.job_translations(job_id, locale, title) values
  (:'SUJD','pl','Magazynier SU47X'),
  (:'SUJD','fr','Préparateur de commandes SU47X');

set role anon; reset app.current_uid; select pg_temp.assert_client_role();
-- SU47-1: diakrytyki i wielkość liter po obu stronach.
select pg_temp.assert(
  public.get_public_jobs_count('pl', 'sprzatania su47x') = 1
  and public.get_public_jobs_count('pl', 'SPRZĄTANIA SU47X') = 1
  and (select array_agg(slug) from public.get_public_jobs('pl', 'SPRZATANIA su47x')) = array['su47-a'],
  'SU47-1 słowo kluczowe bez diakrytyków i wielkości liter znajduje ofertę');

-- SU47-2: `%`, `_` i `\` we wpisie są literałami (dotąd `%su47x` pasowało do każdej oferty).
select pg_temp.assert(
  public.get_public_jobs_count('pl', '%su47x') = 0
  and public.get_public_jobs_count('pl', '50% su47x') = 1
  and public.get_public_jobs_count('pl', 'a_c su47x') = 1
  and public.get_public_jobs_count('pl', 'm_gazynier su47x') = 0
  and public.get_public_jobs_count('pl', 'su47x\') = 0
  and public.get_public_jobs_count('pl', 'su47x', '%') = 0,
  'SU47-2 %/_/\ w słowie kluczowym i mieście działają literalnie');

-- SU47-3: miasto bez diakrytyków; wynik listy, licznika i facetów zgodny.
select pg_temp.assert(
  (select array_agg(slug) from public.get_public_jobs('pl', 'su47x', 'liege')) = array['su47-a']
  and public.get_public_jobs_count('pl', 'su47x', 'LIÈGE') = 1
  and (select total from public.get_public_job_filter_facets('pl', 'su47x', 'liege')
       where dimension = 'total') = 1
  and (select total from public.get_public_job_filter_facets('pl', 'sprzatania su47x')
       where dimension = 'total') = 1
  and (select total from public.get_public_job_filter_facets('pl', '%su47x')
       where dimension = 'total') = 0,
  'SU47-3 miasto bez diakrytyków; lista = licznik = facety');

-- SU47-4: dopasowanie liczy się na tytule wyświetlanym w locale — tłumaczenie fr pasuje
-- tylko dla fr, mimo że prefiltr (dowolne tłumaczenie) obejmuje ofertę także dla pl.
select pg_temp.assert(
  public.get_public_jobs_count('fr', 'preparateur de commandes su47x') = 1
  and public.get_public_jobs_count('pl', 'preparateur de commandes su47x') = 0
  and (select array_agg(title) from public.get_public_jobs('fr', 'preparateur de commandes su47x'))
      = array['Préparateur de commandes SU47X'],
  'SU47-4 tytuł w locale zapytania; prefiltr nie dodaje trafień z innego języka');

-- SU47-5 (kontrola ujemna): stary warunek ILIKE z 0091 na tych samych danych nie znajduje
-- zapisu bez diakrytyków i traktuje `%` jako symbol wieloznaczny.
reset role;
select pg_temp.assert(
  (select count(*) from public.jobs where title ilike '%' || 'sprzatania su47x' || '%') = 0
  and (select count(*) from public.jobs where title ilike '%' || '%su47x' || '%') = 4
  and (select count(*) from public.jobs where city ilike '%' || 'liege' || '%' and id = :'SUJA') = 0,
  'SU47-5 kontrola ujemna: ILIKE bez search_fold/escapowania daje inny wynik');
rollback;

-- SU47-6: funkcje pomocnicze — składanie niezmienne (indeks wyrażeniowy), escapowanie.
select pg_temp.assert(
  public.search_fold('Liège ŁÓDŹ Șofer Préparateur') = 'liege lodz sofer preparateur'
  and public.search_like_pattern('50%_\x') = '%50\%\_\\x%'
  and (select provolatile from pg_proc where oid = 'public.search_fold(text)'::regprocedure) = 'i'
  and (select count(*) from pg_indexes where schemaname = 'public' and indexname in (
        'idx_jobs_title_fold_trgm', 'idx_job_translations_title_fold_trgm', 'idx_jobs_city_fold_trgm')) = 3
  and not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_jobs_city_trgm'),
  'SU47-6 search_fold IMMUTABLE, wzorzec escapowany, indeksy fold na miejscu');

-- SU47-7: indeksy obejmują dokładnie wyrażenia prefiltrów (search_fold(kolumna)) i predykat
-- listy ofert — inaczej planista nie mógłby ich użyć. Wybór planu przy realnej liczbie ofert
-- mierzy scripts/db/search-benchmark.sh (plan zależy od statystyk, więc nie tu).
select pg_temp.assert(
  pg_get_indexdef('public.idx_jobs_title_fold_trgm'::regclass)
    like '%USING gin (search_fold(title) gin_trgm_ops) WHERE ((status = ''active''::job_status) AND (deleted_at IS NULL))'
  and pg_get_indexdef('public.idx_jobs_city_fold_trgm'::regclass)
    like '%USING gin (search_fold(city) gin_trgm_ops) WHERE ((status = ''active''::job_status) AND (deleted_at IS NULL))'
  and pg_get_indexdef('public.idx_job_translations_title_fold_trgm'::regclass)
    like '%USING gin (search_fold(title) gin_trgm_ops)',
  'SU47-7 indeksy GIN na search_fold(title/city), częściowe jak predykat listy');

-- SU47-8: funkcje kandydatów tylko dla właściciela RPC (bez EXECUTE dla ról aplikacji);
-- granty RPC bez zmian.
select pg_temp.assert(
  not has_function_privilege('anon', 'public.search_title_candidates(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.search_title_candidates(text)', 'execute')
  and not has_function_privilege('anon', 'public.search_city_candidates(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.search_city_candidates(text)', 'execute')
  and has_function_privilege('anon', 'public.get_public_jobs(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text,integer,integer,text)', 'execute')
  and has_function_privilege('anon', 'public.get_public_job_filter_facets(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text)', 'execute')
  and not has_function_privilege('public', 'public.get_public_jobs_count(text,text,text,text[],text[],text[],integer,integer,boolean,boolean,boolean,timestamptz,text)', 'execute'),
  'SU47-8 funkcje kandydatów bez EXECUTE dla anon/authenticated; granty RPC jak w 0091');

\echo '=================== ALL RLS TESTS PASSED ==================='
