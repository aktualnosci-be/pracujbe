-- =============================================================================
-- 0027_membership_access_expiry.sql
-- Remediacja audytu 2026-07-24 — Wave D: wygaszanie dostępu wraz z relacją.
--
-- SEC-08 (P1) — dezaktywowany pracownik firmy zachowywał dostęp do STARYCH rozmów:
--   przy tworzeniu konwersacji aktywni członkowie są kopiowani do conversation_members,
--   a dostęp sprawdzał tylko istnienie wiersza uczestnika (is_conversation_member) —
--   NIE aktywność członkostwa. Rekruter po odejściu (company_members.is_active=false)
--   nadal czytał i wysyłał wiadomości w rozmowach firmowych. `is_conversation_member`
--   jest jedynym chokepointem (RLS conversations/messages/members + RPC send_message/
--   mark_conversation_read), więc poprawka w jednym miejscu domyka odczyt i zapis.
--
-- SEC-11 (P2, częściowo) — company_can_view_candidate już wymagał AKTYWNEGO członkostwa,
--   ale nie filtrował soft-delete relacji. Dodajemy `deleted_at is null` na aplikacji/
--   propozycji (usunięta relacja nie może dawać dostępu do PII). Pełne okno retencji
--   (czas od zamknięcia procesu) wymaga decyzji o polityce — poza zakresem tej migracji.
-- =============================================================================

-- --- SEC-08: dostęp do rozmowy firmowej wymaga AKTYWNEGO członkostwa ------------
-- Reguła: uczestnik ma dostęp, gdy jest w conversation_members ORAZ
--   * rozmowa nie jest firmowa (company_id null), LUB
--   * jest AKTYWNYM członkiem tej firmy (is_company_member), LUB
--   * w ogóle NIE jest członkiem tej firmy (strona kandydata).
-- Blokujemy wyłącznie przypadek „jest członkiem, ale nieaktywnym" (były pracownik).
-- SECURITY DEFINER → brak rekurencji RLS na conversation_members.
create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    where m.conversation_id = p_conversation_id
      and m.profile_id = auth.uid()
      and (
        c.company_id is null
        or public.is_company_member(c.company_id)
        or not exists (
          select 1 from public.company_members cm
          where cm.company_id = c.company_id and cm.profile_id = auth.uid()
        )
      )
  );
$$;

-- --- SEC-11: dostęp firmy do PII kandydata nie przez soft-deleted relację -------
create or replace function public.company_can_view_candidate(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.applications a
    join public.company_members cm on cm.company_id = a.company_id
    where a.candidate_id = p_profile_id
      and a.deleted_at is null
      and cm.profile_id = auth.uid()
      and cm.is_active = true
  ) or exists (
    select 1
    from public.offers o
    join public.company_members cm on cm.company_id = o.company_id
    where o.candidate_id = p_profile_id
      and o.deleted_at is null
      and cm.profile_id = auth.uid()
      and cm.is_active = true
  );
$$;
