-- =====================================================================
-- Sicherheitswarnungen aus dem Security Advisor beheben (Frankfurt)
-- Ausgeführt von Olli am 01.11.2026 im Projekt leistungsnachweis-eu.
-- Offen bleibt nur „Leaked Password Protection“ (erst im Pro-Tarif).
-- =====================================================================

-- 1. Feste Suchwege für die beiden Hilfsfunktionen
alter function public.setze_updated_at() set search_path = public;
alter function public.datensaetze_tx_setzen() set search_path = public;

-- 2. rls_auto_enable nur für die Datenbank selbst, nicht von außen aufrufbar
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
