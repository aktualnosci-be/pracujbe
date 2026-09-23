-- Własne zapisy połączone z publicznie widocznymi ofertami przed sortowaniem.
-- Pobranie pierwszych 100 publicznych ofert ukrywało starsze aktywne zapisy.
-- SECURITY DEFINER czyta tylko kolumny widoczne publicznie i wymaga auth.uid().
create function public.get_saved_jobs_display(p_locale text default 'pl')
returns table (
  id uuid, slug text, title text, company_name text, city text
)
language sql stable security definer set search_path = public as $$
  select j.id, j.slug, coalesce(t.title, j.title), c.name, j.city
  from public.saved_jobs s
  join public.jobs j on j.id = s.job_id
  join public.companies c on c.id = j.company_id
  left join lateral (
    select jt.title
    from public.job_translations jt
    where jt.job_id = j.id
    order by
      (jt.locale = case when p_locale in ('pl', 'nl', 'fr', 'en') then p_locale else 'pl' end) desc,
      (jt.locale = j.default_locale) desc,
      (jt.locale = 'en') desc
    limit 1
  ) t on true
  where s.candidate_id = auth.uid()
    and j.status = 'active' and j.deleted_at is null
    and (j.expires_at is null or j.expires_at > now())
    and c.status = 'verified' and c.deleted_at is null
  order by s.created_at desc, j.id desc;
$$;

revoke all on function public.get_saved_jobs_display(text) from public;
grant execute on function public.get_saved_jobs_display(text) to authenticated;
