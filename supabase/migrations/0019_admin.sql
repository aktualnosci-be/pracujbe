-- =============================================================================
-- 0019_admin.sql
-- Operacje administratora (Etap 7g) — weryfikacja firm i moderacja przez RPC pod sesją
-- admina (SECURITY DEFINER + kontrola roli), tak by audit_logs (0017) uchwyciło actor_id.
--
-- is_admin(): profiles.role = 'admin' dla auth.uid(). Trigger ochrony statusu firmy
-- (0011) rozluźniony: admin MOŻE zmienić status/verified_*, zwykły user nadal NIE.
-- Odczyty panelu admina idą przez service_role (kod serwerowy) — nie ruszamy RLS odczytu.
-- =============================================================================

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- Rozluźnienie triggera ochrony: admin może zmieniać status/weryfikację firmy.
create or replace function public.protect_company_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.status is distinct from old.status
       or new.verified_at is distinct from old.verified_at
       or new.verified_by is distinct from old.verified_by then
      raise exception 'PERMISSION_DENIED: status/weryfikacja firmy tylko przez backend/admina'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- RPC admina: zmiana statusu firmy (weryfikacja/odrzucenie/zawieszenie). Audyt: trigger 0017.
create or replace function public.admin_set_company_status(p_company_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_to public.company_status := p_status::public.company_status;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  update public.companies
    set status = v_to,
        verified_at = case when v_to = 'verified' then now() else verified_at end,
        verified_by = case when v_to = 'verified' then auth.uid() else verified_by end,
        updated_at = now()
    where id = p_company_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.admin_set_company_status(uuid, text) from public;
grant execute on function public.admin_set_company_status(uuid, text) to authenticated;

-- RPC admina: rozstrzygnięcie zgłoszenia (report) — status z report_status (open/reviewing/resolved/dismissed).
create or replace function public.admin_resolve_report(p_report_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_to public.report_status := p_status::public.report_status;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  update public.reports
    set status = v_to,
        resolved_by = case when v_to in ('resolved','dismissed') then auth.uid() else resolved_by end,
        resolved_at = case when v_to in ('resolved','dismissed') then now() else resolved_at end,
        updated_at = now()
    where id = p_report_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  perform public.write_audit('report.resolved', 'report', p_report_id, null,
                             jsonb_build_object('status', v_to::text));
end $$;
revoke all on function public.admin_resolve_report(uuid, text) from public;
grant execute on function public.admin_resolve_report(uuid, text) to authenticated;
