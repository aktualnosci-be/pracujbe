# Supabase — konfiguracja

Jak utworzyć i skonfigurować projekt Supabase dla Pracuj.be: klucze, migracje,
Storage (buckety prywatne + signed URLs), Auth (potwierdzenie e-mail, redirecty), RLS.

Osobne projekty dla **produkcji** i **staging** (patrz [`STAGING.md`](./STAGING.md)).
Model danych i RLS: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 1. Utworzenie projektu

1. [supabase.com](https://supabase.com) → **New project**.
2. Nazwa: `pracujbe-prod` (oraz osobno `pracujbe-staging`).
3. Region: **EU** (np. Frankfurt `eu-central-1`) — dane w UE (RODO), niższe opóźnienia dla BE.
4. Zapisz **Database password** (menedżer haseł) — potrzebne do migracji przez CLI.
5. Plan: rozważ **Pro** dla produkcji (backupy PITR, brak pauzowania projektu, wyższe limity).

---

## 2. Klucze i zmienne środowiskowe

Supabase → **Settings → API**:

| wartość w panelu | zmienna w `.env.local` / Vercel | uwagi |
|---|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | publiczne |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publiczne (podlega RLS) |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` | **SEKRET — tylko serwer**, NIGDY `NEXT_PUBLIC_*` |

Connection string (Settings → Database) → `SUPABASE_DB_URL` (do CLI/migracji).

> **Krytyczne:** `service_role` omija RLS (`BYPASSRLS`). Nie może trafić do przeglądarki
> (Invariant #6). W kodzie używany wyłącznie przez `@/lib/supabase/admin` po stronie serwera.

Wzorzec zmiennych: [`.env.example`](../.env.example). Lokalnie: `cp .env.example .env.local`.

---

## 3. Supabase CLI

```bash
npm i -g supabase          # lub: brew install supabase/tap/supabase
supabase --version
supabase login             # token z panelu (Account → Access Tokens)
```

Powiązanie repo z projektem zdalnym (w katalogu projektu):

```bash
supabase link --project-ref <PROJECT_REF>     # ref z URL: https://<REF>.supabase.co
```

---

## 4. Migracje

Migracje są wersjonowane w `supabase/migrations/` (kolejność wg prefiksu `0001…0010`):

| plik | zawartość |
|---|---|
| `0001_extensions_and_enums.sql` | pgcrypto, pg_trgm, citext + wszystkie enumy |
| `0002_core_tables.sql` | profiles, candidate/employer_profiles, companies, company_members, słowniki |
| `0003_jobs.sql` | jobs, job_translations, job_requirements, job_skills |
| `0004_candidate_relations.sql` | candidate_skills/languages/certificates, saved_jobs |
| `0005_processes.sql` | applications, matches, offers + historie statusów |
| `0006_messaging.sql` | conversations, messages, notifications, email_deliveries |
| `0007_misc.sql` | files, consents, reports, płatności, audit_logs, system_events |
| `0008_triggers.sql` | `set_updated_at()`, `handle_new_user()` |
| `0009_rls.sql` | funkcje pomocnicze + polityki RLS |
| `0010_seed_dictionaries.sql` | słowniki (kategorie, miasta, języki, …) |

### Zdalnie (staging/produkcja)

```bash
supabase db push        # zastosuj niezaaplikowane migracje na projekcie połączonym `link`
```

### Lokalnie (Docker)

```bash
supabase start          # lokalny stack (Postgres 54322, Studio 54323, API 54321)
supabase db reset       # DROP + wszystkie migracje + supabase/seed.sql (patrz §7)
```

`supabase db reset` jest **destrukcyjny** — używaj TYLKO lokalnie i na czystym staging,
NIGDY na produkcji. Na produkcję wdrażaj wyłącznie przyrostowo przez `db push`.

### Nowa migracja

```bash
supabase migration new <opis>      # tworzy pusty plik z kolejnym prefiksem timestamp
# ...wpisz SQL (idempotentnie: create ... if not exists, drop policy if exists)...
supabase db push
```

Reguły: idempotencja (bezpieczny re-run), guard na enumach (`do $$ ... exception when
duplicate_object`), `create index if not exists`, `drop policy if exists` przed `create policy`.
**Nie edytuj** już zaaplikowanych migracji — dopisuj nowe.

---

## 5. Storage — buckety prywatne + signed URLs

**Invariant #10:** pliki wrażliwe wyłącznie przez signed URLs; żadnych publicznych
bucketów dla danych osobowych. Metadane obiektów trzyma tabela `files`
(`bucket`, `path`, `visibility ∈ {private, public}`, `owner_id`).

### Zalecane buckety

| bucket | public? | zawartość | dostęp |
|---|---|---|---|
| `logos` | **tak** | logotypy firm (dane publiczne) | odczyt publiczny |
| `avatars` | tak | awatary (opcjonalnie) | odczyt publiczny |
| `cv` / `documents` | **nie** | dokumenty kandydatów (wrażliwe) | wyłącznie signed URL |
| `attachments` | nie | załączniki wiadomości | wyłącznie signed URL |
| `invoices` | nie | faktury (PDF) | wyłącznie signed URL |

Utworzenie: Studio → **Storage → New bucket** (odznacz „Public" dla bucketów prywatnych),
albo SQL:

```sql
insert into storage.buckets (id, name, public)
values ('cv','cv',false), ('attachments','attachments',false),
       ('invoices','invoices',false), ('logos','logos',true)
on conflict (id) do nothing;
```

### Signed URLs (dostęp do plików prywatnych)

Generowane **po stronie serwera** (Server Action / Route Handler) po sprawdzeniu
uprawnień. Krótki TTL (np. 60–300 s):

```ts
// tylko serwer
const supabase = await createServerClient();
const { data, error } = await supabase
  .storage.from('cv')
  .createSignedUrl(path, 300); // 5 min
```

### Polityki dostępu do Storage (RLS na `storage.objects`)

Dla bucketów prywatnych dodaj polityki wiążące ścieżkę z właścicielem (np. prefiks
`<auth.uid()>/…`) i egzekwuj dostęp w warstwie aplikacji. Upload — tylko zalogowany
właściciel; odczyt plików prywatnych — wyłącznie przez signed URL generowany serwerowo.
Tabela `files` ma własne polityki: właściciel ma pełny dostęp, `visibility='public'`
jest odczytywalne przez wszystkich.

---

## 6. Auth (uwierzytelnianie)

Supabase → **Authentication**:

1. **Providers → Email**: włącz. **Confirm email = ON** (potwierdzenie adresu przed
   logowaniem).
2. **URL Configuration:**
   - **Site URL:** `https://pracuj.be` (staging: URL staging).
   - **Redirect URLs (allow list):** dodaj wszystkie środowiska i ścieżki callbacku:
     ```
     https://pracuj.be/**
     https://staging.pracuj.be/**
     http://localhost:3000/**
     ```
3. **Email templates** (Confirm signup, Reset password, Magic link): dostosuj branding
   i język. Uwaga: e-maile systemowe Auth są osobne od transakcyjnych (Resend, patrz
   [`RESEND_SETUP.md`](./RESEND_SETUP.md)). Do produkcji rozważ własny SMTP (Auth → SMTP
   settings) na tej samej domenie, by uniknąć limitów wbudowanego mailera.
4. **Rejestracja → profil:** trigger `handle_new_user()` (migracja 0008) automatycznie
   tworzy wiersz w `profiles` (+ `notification_preferences`), czytając
   `raw_user_meta_data` (`role`, `first_name`, `last_name`, `locale`). `signup_locale`
   i `account_locale` ustawiane z `locale` przekazanego przy `signUp` — kluczowe dla
   fallbacku języka odbiorcy (Invariant #1). Rola z self-signup ograniczona do
   `candidate`/`employer` (admin/moderator tylko ręcznie).

### Bezpieczeństwo Auth

- **Rate limiting / anti-abuse:** Authentication → Rate Limits (logowanie, wysyłka
  e-maili, OTP). Ogranicz liczby prób.
- **Nie ujawniaj istnienia e-maila** (Invariant SECURITY): komunikat resetu hasła musi
  być jednakowy niezależnie od tego, czy konto istnieje.
- **Password policy:** ustaw minimalną długość / złożoność.

---

## 7. Seed (dane demonstracyjne)

`supabase/seed.sql` tworzy dane demo (10 firm, 50 ofert + tłumaczenia, 40 kandydatów,
aplikacje, propozycje, wiadomości, powiadomienia, matches). Wszystko oznaczone
`is_demo = true` (Invariant #12) i idempotentne (`ON CONFLICT`). Tworzy też konta
`auth.users` z hasłem demo `DemoPass123!` (deterministyczne UUID).

```bash
supabase db reset          # lokalnie: migracje + seed
```

> **Produkcja:** seed **wyłączony**. Nie uruchamiaj `seed.sql` na produkcji. Przed
> startem produkcyjnym upewnij się, że nie ma rekordów `is_demo = true` (patrz
> [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md)).

---

## 8. RLS — weryfikacja

RLS jest włączony na wszystkich tabelach z danymi (migracja 0009). Po `db push`
sprawdź w Studio → **Authentication → Policies**, że:

- każda tabela z danymi użytkownika ma RLS **enabled**;
- tabele serwisowe (`audit_logs`, `system_events`, `email_deliveries`, `discount_codes`)
  mają RLS enabled i **brak polityk** (deny dla anon/authenticated — dostęp tylko service role);
- funkcje pomocnicze (`is_company_member` itd.) istnieją i są `SECURITY DEFINER`.

Szybki test negatywny (anon nie widzi cudzych danych): zapytaj tabelę `applications`
kluczem anon — powinno zwrócić 0 wierszy.

---

## 9. Powiązane

- Migracje/RLS w kontekście modelu: [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- Wdrożenie migracji przy deployu: [`DEPLOYMENT.md`](./DEPLOYMENT.md).
- Checklisty: [`SECURITY_CHECKLIST.md`](./SECURITY_CHECKLIST.md), [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md).
</content>
