-- =============================================================================
-- 0044_file_scan_status.sql
-- Remediacja audytu produkcyjnego 2026-07-24 — P1-22 (utwardzenie uploadu; AV odłożone).
--
-- Skan antywirusowy wymaga usługi zewnętrznej (decyzja: odłożone). Tu przygotowujemy schemat
-- pod przyszły skaner: kolumna `scan_status` (kwarantanna). Upload ustawia 'skipped' (walidacja
-- treści przeszła, brak AV); po wpięciu skanera pliki startują jako 'pending' i są udostępniane
-- (signed URL) dopiero po 'clean'. Serwowanie może gejtować po tej fladze.
-- =============================================================================

alter table public.files
  add column if not exists scan_status text not null default 'pending';

alter table public.files drop constraint if exists files_scan_status_check;
alter table public.files
  add constraint files_scan_status_check
  check (scan_status in ('pending', 'clean', 'skipped', 'infected'));

create index if not exists idx_files_scan_status on public.files (scan_status);
