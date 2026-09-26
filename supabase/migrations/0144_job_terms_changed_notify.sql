-- 0144_job_terms_changed_notify.sql — powiadomienie kandydatów o istotnej zmianie warunków
-- opublikowanej oferty (numer tymczasowy; ostateczny nada integrator).
--
-- CLAUDE.md „Edycja opublikowanej oferty — Otwarte” (#325): kandydat, który już aplikował,
-- dostaje powiadomienie in-app (bez e-maila — bezpieczny wariant bez decyzji produktowej), gdy
-- rekruter zmieni w opublikowanej ofercie wynagrodzenie, miasto, typ umowy albo godziny pracy.
--
-- 1. `job_material_terms(jobs)` — JEDYNE miejsce z listą pól „istotnych warunków”.
-- 2. Trigger AFTER UPDATE na `jobs`: porównanie starych i nowych warunków w tej samej
--    transakcji co zapis. Treść oferty innej niż szkic zmienia wyłącznie `update_published_job`
--    (strażnik `guard_published_job_content`, 0077), a zmiany statusu (pauza, wznowienie,
--    zamknięcie, wygaśnięcie, moderacja) są wyłączone warunkiem `old.status = new.status`.
--    Błąd walidacji w dalszej części `update_published_job` cofa także powiadomienia.
-- 3. Odbiorcy: kandydaci z AKTYWNĄ aplikacją (submitted, viewed, shortlisted, interview,
--    offer_sent, offer_accepted); bez gości (brak konta = brak in-app), bez szkiców i stanów
--    końcowych. Jedno powiadomienie na kandydata na zapis. Preferencja `in_app_enabled`
--    działa jak dla innych powiadomień (trigger z 0035).
-- 4. Tytuł renderuje aplikacja z klucza i18n w języku panelu odbiorcy (Invariant #1); w bazie
--    tylko `data` = rodzaj, slug oferty i nazwy zmienionych pól (bez kwot i treści).
--
-- Rollback: `drop trigger trg_notify_job_terms_changed on public.jobs;
--            drop function public.notify_job_terms_changed(); drop function public.job_material_terms(public.jobs);`

create or replace function public.job_material_terms(j public.jobs)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'salary', jsonb_build_object('min', j.salary_min, 'max', j.salary_max,
                                 'period', j.salary_period, 'currency', j.currency),
    'city', j.city,
    'contract_type', j.contract_type,
    'working_hours', j.working_hours
  )
$$;
revoke all on function public.job_material_terms(public.jobs) from public;

create or replace function public.notify_job_terms_changed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := public.job_material_terms(old);
  v_new jsonb := public.job_material_terms(new);
  v_fields text[];
begin
  if v_old is not distinct from v_new then
    return null;
  end if;
  select array_agg(k order by k) into v_fields
    from jsonb_object_keys(v_new) k
   where v_old -> k is distinct from v_new -> k;

  insert into public.notifications (profile_id, type, data, entity_type, entity_id)
  select distinct a.candidate_id, 'system'::public.notification_type,
         jsonb_build_object('kind', 'job_terms_changed', 'slug', new.slug, 'fields', to_jsonb(v_fields)),
         'job_terms', new.id
    from public.applications a
   where a.job_id = new.id
     and a.candidate_id is not null
     and a.deleted_at is null
     and a.status::text in ('submitted', 'viewed', 'shortlisted', 'interview',
                            'offer_sent', 'offer_accepted');
  return null;
end $$;
revoke all on function public.notify_job_terms_changed() from public;

create trigger trg_notify_job_terms_changed
  after update on public.jobs
  for each row
  when (old.status in ('active', 'paused') and new.status = old.status and new.deleted_at is null)
  execute function public.notify_job_terms_changed();
