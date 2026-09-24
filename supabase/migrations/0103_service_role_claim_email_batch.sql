-- =============================================================================
-- 0103_service_role_claim_email_batch.sql — #25: worker poczty na puli `service`.
--
-- 0021 odebrało EXECUTE na claim_email_batch roli PUBLIC. Na Supabase klucz service-role
-- i tak mógł ją wołać (domyślne uprawnienia platformy); na PostgreSQL Railway rola
-- service_role (login zadań serwerowych, DATABASE_SERVICE_URL) nie ma tego prawa,
-- więc worker `/api/email/process` nie odebrałby żadnego wiersza kolejki.
-- Nadajemy EXECUTE WYŁĄCZNIE service_role; anon/authenticated nadal bez prawa.
-- Pozostałe funkcje wołane przez pulę service mają już EXECUTE dla service_role
-- (sprawdzone na komplecie migracji 0000–0102).
--
-- Rollback: revoke execute on function public.claim_email_batch(integer, integer)
--           from service_role;  (bez zmian danych)
-- =============================================================================

grant execute on function public.claim_email_batch(integer, integer) to service_role;

do $$
begin
  if not has_function_privilege('service_role', 'public.claim_email_batch(integer, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_email_batch(integer, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_email_batch(integer, integer)', 'EXECUTE') then
    raise exception 'claim_email_batch: niezgodne uprawnienia EXECUTE.';
  end if;
end $$;
