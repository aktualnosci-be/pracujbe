-- Atomowy zapis profilu/języka/akceptacji przy rejestracji przez zaufany adapter.
-- Marker pochodzi wyłącznie z walidowanego kontekstu Server Action, nie pola API.
-- Konta administracyjne/fixture bez markera NIE otrzymują fikcyjnych akceptacji.
-- Rollback kodu: pozostawić funkcję i receipty; nie usuwać historii akceptacji.
create function auth.record_signup_receipts()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  meta jsonb := new.raw_user_meta_data;
  loc text := meta->>'locale';
begin
  if not (meta ? 'signup_receipt_version') then return new; end if;
  if meta->'signup_receipt_version' is distinct from '1'::jsonb
    or meta->'agree_terms' is distinct from 'true'::jsonb
    or coalesce(meta->>'role', '') not in ('candidate', 'employer')
    or coalesce(loc, '') not in ('pl', 'nl', 'fr', 'en') then
    raise exception 'VALIDATION_FAILED' using errcode = '23514';
  end if;

  update public.profiles set preferred_locale = loc where id = new.id;
  if not found then raise exception 'Brak profilu rejestracji.'; end if;
  perform public.record_document_acceptance(new.id, array['terms','privacy'], loc, null, null);
  return new;
end $$;
revoke all on function auth.record_signup_receipts() from public, anon, authenticated,
  pracujbe_app, pracujbe_auth, service_role;

-- PostgreSQL wykonuje triggery tego samego rodzaju alfabetycznie.
-- on_auth_user_created tworzy profil przed poniższym zapisem receiptów.
create trigger zz_record_signup_receipts
  after insert on auth.users
  for each row execute function auth.record_signup_receipts();
