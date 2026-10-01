-- =============================================================================
-- Rollback 0983_web_push_subscriptions.sql (#724) — usuwa kanał Web Push.
-- Urządzenia i kolejka wysyłek znikają; `notification_preferences.push_enabled` zostaje
-- (kolumna z 0006), ale wraca na false, bo bez rejestru urządzeń nie opisuje żadnego stanu.
-- =============================================================================
drop trigger if exists trg_notifications_push_enqueue on public.notifications;
drop function if exists public.trg_push_enqueue_notification();
drop function if exists public.purge_push_data();
drop function if exists public.finish_push_delivery(uuid, text, text, integer);
drop function if exists public.claim_push_deliveries(integer, integer);
drop function if exists public.unregister_push_subscription(text);
drop function if exists public.revoke_push_subscription(uuid);
drop function if exists public.push_revoke_own(uuid, uuid);
drop function if exists public.register_push_subscription(text, text, text, text);
drop function if exists public.push_suppress_queued(uuid);
drop table if exists public.push_deliveries;
drop table if exists public.push_subscriptions;
drop function if exists public.push_max_devices();
drop function if exists public.push_notification_allowed(text, text);
drop function if exists public.push_endpoint_allowed(text);
update public.notification_preferences set push_enabled = false where push_enabled;
