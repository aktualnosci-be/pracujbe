-- 0187_team_invitation_details.sql — oczekujące zaproszenia do zespołu: język, autor i data
-- wysłania na liście w `/employer/zespol` (numer 0187).
--
-- `get_company_invitations` (0086) zwracał tylko adres, rolę i ważność. Panel zespołu nie
-- pokazywał więc, w jakim języku poszło zaproszenie (0121: decyduje o języku e-maila dla
-- adresu bez konta — Invariant #1) ani kto i kiedy je wysłał, a „Odnów zaproszenie” musiałoby
-- zgadywać język. Nowe kolumny wyniku:
--   - `locale`       — `company_invitations.locale` (null dla zaproszeń sprzed 0121),
--   - `inviter_name` — imię i nazwisko zapraszającego (`profile_full_name`, pusty tekst, gdy
--                      konto usunięte albo bez imienia) — owner/admin i tak widzi zespół,
--   - `created_at`   — bez zmian (było w wyniku).
-- Dostęp bez zmian: tylko `is_company_admin(p_company_id)` (owner/admin aktywnej firmy),
-- tylko `pending` i nie wygasłe, najwyżej 100 wierszy. Funkcja nic nie zapisuje.
--
-- Zmiana typu wyniku wymaga DROP + CREATE (jedyny wołający: `src/lib/data/team.ts`,
-- zaktualizowany w tym samym PR).
-- Rollback: odtworzyć definicję z 0086 (DROP + CREATE bez `locale`/`inviter_name`).

drop function if exists public.get_company_invitations(uuid);

create function public.get_company_invitations(p_company_id uuid)
returns table (
  invitation_id uuid, email text, role text, expires_at timestamptz, created_at timestamptz,
  locale text, inviter_name text
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_company_admin(p_company_id) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  return query
    select i.id, i.email::text, i.role::text, i.expires_at, i.created_at,
           i.locale::text,
           coalesce(public.profile_full_name(i.invited_by), '')::text
    from public.company_invitations i
    where i.company_id = p_company_id and i.status = 'pending' and i.expires_at > now()
    order by i.created_at desc, i.id
    limit 100;
end $$;
revoke all on function public.get_company_invitations(uuid) from public, anon;
grant execute on function public.get_company_invitations(uuid) to authenticated;
