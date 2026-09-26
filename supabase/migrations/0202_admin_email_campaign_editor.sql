-- =============================================================================
-- 0202_admin_email_campaign_editor.sql — #45 (otwarte): tworzenie rewizji kampanii
-- e-mail z panelu admina (`/admin/kampanie/nowa`, „Nowa rewizja” w szczególe).
--
-- Numer TYMCZASOWY — ostateczny nada integrator (kolejka migracji).
--
-- 0101 dało create_email_campaign_revision(slug, content) wyłącznie dla service_role
-- (bez sprawdzenia roli, bez idempotencji i bez śladu w dzienniku); 0111 — aktywację
-- i zatrzymanie pod sesją admina. Edytor zapisuje pod SESJĄ admina (auth.uid()), więc
-- potrzebuje osobnego wejścia:
--
-- 1. email_campaigns.client_key (uuid, unikalny gdy ustawiony) — klucz idempotencji
--    operacji z przeglądarki. Ten sam klucz = ta sama rewizja (podwójne kliknięcie,
--    ponowienie po zerwanym połączeniu); ten sam klucz z innym slugiem = VALIDATION_FAILED.
-- 2. email_campaign_jobs_renderable(content) — reguły treści, które sprawdza worker przy
--    renderowaniu (`assertRenderableJobs`, `newsletterJobsFromPayload`): slug oferty,
--    niepusty tytuł i miasto, stawka tekstem albo brak, `isDemo = false`, język oferty =
--    język wpisu, bez placeholderów `{{…}}`, limity długości jak w edytorze
--    (`src/lib/admin/campaign-editor.ts`). Panel nie zapisze rewizji, której worker nie
--    wyrenderuje.
-- 3. admin_create_email_campaign_revision(client_key, slug, content) — is_admin(); slug
--    jak CHECK tabeli; blokada doradcza klucza; skutek = istniejące
--    create_email_campaign_revision (komplet języków serwisu, 1–3 oferty, blokada sluga,
--    kolejny numer rewizji). Nowa rewizja jest SZKICEM — aktywacja dalej osobnym krokiem
--    (admin_activate_email_campaign, 0111). Audyt `email_campaign.revision_created`
--    BEZ treści (id w entity_id, slug, rewizja, status).
--
-- Rollback: drop function public.admin_create_email_campaign_revision(uuid, text, jsonb);
--           drop function public.email_campaign_jobs_renderable(jsonb);
--           drop index public.uq_email_campaigns_client_key;
--           alter table public.email_campaigns drop column client_key;
--           (wpisy audit_logs zostają)
-- =============================================================================

alter table public.email_campaigns add column if not exists client_key uuid;
create unique index if not exists uq_email_campaigns_client_key
  on public.email_campaigns (client_key) where client_key is not null;

create or replace function public.email_campaign_jobs_renderable(p_content jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(p_content) = 'object'
     and coalesce((
       select bool_and(
                jsonb_typeof(j) = 'object'
            and jsonb_typeof(j -> 'slug') = 'string'
            and (j ->> 'slug') ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
            and char_length(j ->> 'slug') <= 200
            and jsonb_typeof(j -> 'title') = 'string'
            and (j ->> 'title') ~ '\S'
            and char_length(j ->> 'title') <= 160
            and jsonb_typeof(j -> 'city') = 'string'
            and (j ->> 'city') ~ '\S'
            and char_length(j ->> 'city') <= 100
            and (j -> 'salary' is null
                 or jsonb_typeof(j -> 'salary') = 'null'
                 or (jsonb_typeof(j -> 'salary') = 'string' and char_length(j ->> 'salary') <= 60))
            and (j -> 'isDemo') = 'false'::jsonb
            and (j ->> 'locale') is not distinct from e.k
            and concat_ws(' ', j ->> 'slug', j ->> 'title', j ->> 'city', j ->> 'salary')
                  !~ '\{\{[^}]+\}\}')
         from jsonb_each(p_content) e(k, v)
         cross join lateral jsonb_array_elements(
           case when jsonb_typeof(v -> 'jobs') = 'array' then v -> 'jobs' else '[]'::jsonb end) j
     ), false);
$$;
revoke all on function public.email_campaign_jobs_renderable(jsonb) from public;

create or replace function public.admin_create_email_campaign_revision(
  p_client_key uuid,
  p_slug text,
  p_content jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.email_campaigns;
  v_id uuid;
  v_revision integer;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;

  if p_client_key is null then
    raise exception 'VALIDATION_FAILED: klucz' using errcode = '22023';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 80 then
    raise exception 'VALIDATION_FAILED: slug' using errcode = '22023';
  end if;

  -- Dwa równoległe wywołania z tym samym kluczem: drugie czeka i zwraca rewizję pierwszego.
  perform pg_advisory_xact_lock(hashtextextended('email_campaign_key:' || p_client_key::text, 0));
  select * into v_existing from public.email_campaigns where client_key = p_client_key;
  if found then
    if v_existing.slug <> p_slug then
      raise exception 'VALIDATION_FAILED: klucz' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  -- Treść, którą worker wyrenderuje w każdym języku (komplet języków sprawdza 0101).
  if not public.email_campaign_jobs_renderable(p_content) then
    raise exception 'VALIDATION_FAILED: kampania' using errcode = '22023';
  end if;

  v_id := public.create_email_campaign_revision(p_slug, p_content);
  update public.email_campaigns set client_key = p_client_key where id = v_id
  returning revision into v_revision;

  perform public.write_audit('email_campaign.revision_created', 'email_campaign', v_id, null,
    jsonb_build_object('status', 'draft', 'slug', p_slug, 'revision', v_revision));
  return v_id;
end $$;
revoke all on function public.admin_create_email_campaign_revision(uuid, text, jsonb) from public, anon;
grant execute on function public.admin_create_email_campaign_revision(uuid, text, jsonb) to authenticated;
