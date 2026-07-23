-- =============================================================================
-- 0017_audit_logs.sql
-- Ślad audytowy wrażliwych operacji (append-only) — domknięcie „Audit logs" (Etap 7).
--
-- Podejście: triggery AFTER (SECURITY DEFINER), a NIE ręczne wstawki w każdym RPC.
-- Dzięki temu audyt łapie zmianę NIEZALEŻNIE od ścieżki (RPC domenowy, bezpośredni
-- UPDATE pod RLS, operacja admina przez service_role) i nie duplikuje ciał RPC.
-- Funkcje są SECURITY DEFINER (właściciel = postgres), więc INSERT do audit_logs
-- powodzi się mimo braku uprawnień roli klienta (audit_logs: RLS deny + revoke, 0009);
-- actor_id = auth.uid() (NULL dla operacji service_role/systemowych — to prawidłowe).
--
-- audit_logs pozostaje NIECZYTELNE dla anon/authenticated (odczyt: panel admina przez
-- service_role — Etap 7g). Rekordy są tylko dopisywane (bez UPDATE/DELETE ze ścieżki app).
-- =============================================================================

-- --- Aplikacje: zmiana statusu (np. viewed/shortlisted/interview/hired/rejected/withdrawn) ---
create or replace function public.audit_application_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (auth.uid(), 'application.status_changed', 'application', new.id,
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status, 'company_id', new.company_id, 'job_id', new.job_id));
  end if;
  return new;
end $$;

drop trigger if exists trg_audit_application_status on public.applications;
create trigger trg_audit_application_status
  after update on public.applications
  for each row execute function public.audit_application_status();

-- --- Propozycje: utworzenie (wysłanie) + zmiana statusu (accepted/declined/expired) --------
create or replace function public.audit_offer_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
    values (auth.uid(), 'offer.sent', 'offer', new.id,
            jsonb_build_object('status', new.status, 'candidate_id', new.candidate_id,
                               'company_id', new.company_id, 'job_id', new.job_id));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (auth.uid(), 'offer.status_changed', 'offer', new.id,
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status));
  end if;
  return new;
end $$;

drop trigger if exists trg_audit_offer_insert on public.offers;
create trigger trg_audit_offer_insert
  after insert on public.offers
  for each row execute function public.audit_offer_change();

drop trigger if exists trg_audit_offer_update on public.offers;
create trigger trg_audit_offer_update
  after update on public.offers
  for each row execute function public.audit_offer_change();

-- --- Firmy: utworzenie + zmiana statusu weryfikacji (unverified->pending->verified/...) -----
create or replace function public.audit_company_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
    values (auth.uid(), 'company.created', 'company', new.id,
            jsonb_build_object('status', new.status, 'name', new.name));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
    values (auth.uid(), 'company.status_changed', 'company', new.id,
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status));
  end if;
  return new;
end $$;

drop trigger if exists trg_audit_company_insert on public.companies;
create trigger trg_audit_company_insert
  after insert on public.companies
  for each row execute function public.audit_company_change();

drop trigger if exists trg_audit_company_update on public.companies;
create trigger trg_audit_company_update
  after update on public.companies
  for each row execute function public.audit_company_change();

-- --- Jawny helper audytu dla operacji admina (service_role) — Etap 7g -----------------------
-- Wołany z zaufanego kodu serwerowego (service role) przy akcjach nietabelarycznych.
create or replace function public.write_audit(
  p_action text,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_before jsonb default null,
  p_after jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after);
end $$;
revoke all on function public.write_audit(text, text, uuid, jsonb, jsonb) from public;
-- Tylko zaufany serwer (service_role omija RLS) — brak grantu dla anon/authenticated.
