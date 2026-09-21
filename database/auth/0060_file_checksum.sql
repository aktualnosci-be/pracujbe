-- Integralność nowych CV: SHA-256 bajtów potwierdzonych przez adapter storage.
-- Starsze CV i faktury mogą pozostać bez checksumy; nie zgadujemy brakujących hashy.
alter table public.files add column checksum_sha256 text;
alter table public.files add constraint files_checksum_sha256_check
  check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$');

-- Rollback aplikacji: pozostawić nullable kolumnę i CHECK. Usunięcie kolumny
-- skasowałoby dowód integralności; nie wymaga tego zgodność ze starszym kodem.
