-- Rollback 0971 (opis firmy z zatwierdzaniem przez admina). Zatwierdzony opis (`description`)
-- zostaje; znikają tylko propozycje oczekujące/odrzucone (niezatwierdzone teksty).
drop function if exists public.admin_decide_company_description(uuid, text, timestamptz, text);
drop function if exists public.submit_company_description(uuid, text);
drop trigger if exists trg_guard_company_description on public.companies;
drop function if exists public.guard_company_description();
drop index if exists public.idx_companies_description_pending;
alter table public.companies drop constraint if exists companies_description_review_state_check;
alter table public.companies drop constraint if exists companies_description_review_status_check;
alter table public.companies drop constraint if exists companies_description_pending_len;
alter table public.companies
  drop column if exists description_pending,
  drop column if exists description_review_status,
  drop column if exists description_pending_at,
  drop column if exists description_review_reason,
  drop column if exists description_reviewed_at;
