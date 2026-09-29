-- 0965_public_jobs_sitemap_cursor.sql — numer tymczasowy (ostateczny nada integrator).
--
-- #1042 (PERF-04, reszta): sitemap ofert czytała katalog przez `get_public_jobs` — na każde
-- żądanie osobny licznik (`get_public_jobs_count`) i stronicowanie OFFSET po 100 ofert,
-- na wspólnej puli połączeń. Offset rośnie liniowo z głębokością strony (partia nr 3 to
-- ~10 000 przeskoczonych wierszy na każdej stronie), a `get_public_jobs` ma sufit offsetu
-- 10 000, więc katalog większy niż ~10 100 ofert był poza sitemapą.
--
-- Zmiana: dwie lekkie funkcje tylko dla sitemapy, NIEZALEŻNE od `get_public_jobs` (zmiana
-- filtrów listy nie wymaga ich modyfikacji poza warunkiem „oferta publiczna”, patrz niżej):
--   1. get_public_jobs_sitemap_shard_starts(p_shard_size)
--        jeden wiersz na partię sitemap: kursor (published_at, id) OSTATNIEJ oferty poprzedniej
--        partii (dla partii nr 1: NULL). Bez licznika i bez OFFSET — numerowanie okienkowe
--        po indeksie, zwracane są tylko granice (1 wiersz na `p_shard_size` ofert).
--   2. get_public_jobs_sitemap_page(p_after_*, p_until_*, p_limit)
--        strona ofert kursorem (published_at desc, id desc): id, slug, slug firmy, daty oraz
--        języki z własnym tłumaczeniem (#301) w JEDNYM zapytaniu — sitemap nie woła już
--        osobno odczytu `job_translations`. Górna granica `p_until_*` (włącznie) pozwala
--        partii kończyć się dokładnie na kursorze następnej, więc partie są rozłączne i bez
--        dziur nawet przy wyścigu z wygasaniem/publikacją oferty między żądaniami.
--
-- Kursor = para (published_at, id): `id` (PK, unikalny) rozstrzyga remis `published_at`, więc na
-- granicy strony/partii nie ma dziur ani duplikatów. Znaczniki czasu wracają jako tekst ISO
-- z mikrosekundami (przez to_jsonb w warstwie aplikacji) — obcięcie do milisekund w JS
-- przesunęłoby kursor względem wierszy o tej samej milisekundzie.
--
-- Warunek „oferta publiczna” = kopia warunków `get_public_jobs` (0167): active, nieusunięta,
-- niewygasła, firma verified i nieusunięta; plus `published_at is not null` (klucz kursora,
-- jak w 0158). Oferta aktywna bez daty publikacji (nie powstaje przez `publish_job`) nie trafia do
-- sitemapy. Rozjazd z listą łapie test `public-jobs` (integracja) i `rls.sql` sekcja SM1042.
--
-- Częściowy indeks pod kursor (published_at desc, id desc) dla ofert aktywnych.
--
-- Rollback: supabase/rollback/0965_public_jobs_sitemap_cursor.down.sql
--   (test: supabase/tests/sitemap-cursor-rollback.sql).

create index if not exists idx_jobs_sitemap_cursor
  on public.jobs (published_at desc, id desc)
  where status = 'active' and deleted_at is null and published_at is not null;

-- --- Granice partii sitemap ------------------------------------------------------------
create or replace function public.get_public_jobs_sitemap_shard_starts(
  p_shard_size integer default 5000
)
returns table (
  shard_index      integer,
  after_published_at timestamptz,
  after_id         uuid
)
language sql stable security definer set search_path = public, pg_temp as $$
  with ordered as (
    select
      row_number() over w as rn,
      lag(j.published_at) over w as prev_published_at,
      lag(j.id) over w as prev_id
    from public.jobs j
    join public.companies c on c.id = j.company_id
    where j.status = 'active' and j.deleted_at is null
      and (j.expires_at is null or j.expires_at > now())
      and c.status = 'verified' and c.deleted_at is null
      and j.published_at is not null
    window w as (order by j.published_at desc, j.id desc)
  ), size as (
    -- Dolna granica chroni przed zapytaniem „partia = 1 oferta” (anon): wynik to zawsze
    -- najwyżej (liczba ofert / 50) wierszy.
    select least(greatest(coalesce(p_shard_size, 5000), 50), 20000) as n
  )
  select (((o.rn - 1) / s.n) + 1)::integer as shard_index,
         o.prev_published_at as after_published_at,
         o.prev_id as after_id
  from ordered o cross join size s
  where (o.rn - 1) % s.n = 0
  order by o.rn;
$$;
revoke all on function public.get_public_jobs_sitemap_shard_starts(integer) from public;
grant execute on function public.get_public_jobs_sitemap_shard_starts(integer) to anon, authenticated;

-- --- Strona ofert kursorem --------------------------------------------------------------
create or replace function public.get_public_jobs_sitemap_page(
  p_after_published_at timestamptz default null,
  p_after_id           uuid        default null,
  p_until_published_at timestamptz default null,
  p_until_id           uuid        default null,
  p_limit              integer     default 1000
)
returns table (
  id           uuid,
  slug         text,
  company_slug text,
  published_at timestamptz,
  updated_at   timestamptz,
  locales      text[]
)
language sql stable security definer set search_path = public, pg_temp as $$
  with page as (
    select j.id, j.slug, c.slug as company_slug, j.published_at, j.updated_at
    from public.jobs j
    join public.companies c on c.id = j.company_id
    where j.status = 'active' and j.deleted_at is null
      and (j.expires_at is null or j.expires_at > now())
      and c.status = 'verified' and c.deleted_at is null
      and j.published_at is not null
      -- Kursor „po”: obie części albo żadna. Niepełny kursor (jedna część) = brak wyników
      -- (fail-closed), nigdy cicho pierwsza strona.
      and ((p_after_published_at is null and p_after_id is null)
           or (j.published_at, j.id) < (p_after_published_at, p_after_id))
      -- Kursor „do” (włącznie), analogicznie.
      and ((p_until_published_at is null and p_until_id is null)
           or (j.published_at, j.id) >= (p_until_published_at, p_until_id))
    order by j.published_at desc, j.id desc
    limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
  )
  select p.id, p.slug, p.company_slug, p.published_at, p.updated_at,
         coalesce((
           select array_agg(distinct jt.locale order by jt.locale)
           from public.job_translations jt
           where jt.job_id = p.id and public.is_supported_locale(jt.locale)
         ), '{}'::text[]) as locales
  from page p
  order by p.published_at desc, p.id desc;
$$;
revoke all on function public.get_public_jobs_sitemap_page(
  timestamptz, uuid, timestamptz, uuid, integer) from public;
grant execute on function public.get_public_jobs_sitemap_page(
  timestamptz, uuid, timestamptz, uuid, integer) to anon, authenticated;
