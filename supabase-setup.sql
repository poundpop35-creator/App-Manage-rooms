-- ══════════════════════════════════════════════════════════════════
-- GuestTrack — Supabase Database Setup
-- วิธีใช้: เปิด Supabase → SQL Editor → วางโค้ดนี้ทั้งหมด → Run
-- ══════════════════════════════════════════════════════════════════

-- ─── 1. TABLE: admins ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admins (
  id          bigserial PRIMARY KEY,
  username    text NOT NULL UNIQUE,
  password    text NOT NULL,
  role        text NOT NULL DEFAULT 'sub',   -- 'super' | 'sub'
  status      text NOT NULL DEFAULT 'pending', -- 'active' | 'pending'
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. TABLE: events ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.events (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  subtitle    text,
  logo        text DEFAULT '🏨',
  logo_img    text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── 3. TABLE: guests ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guests (
  id          bigserial PRIMARY KEY,
  event_id    text NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  data        jsonb NOT NULL DEFAULT '{"guests":[],"colors":{},"updatedAt":null}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── 4. TABLE: app_settings ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  id    bigserial PRIMARY KEY,
  data  jsonb NOT NULL DEFAULT '{}'
);

-- ═══════════════════════════════════════════════════════════════
-- RLS (Row Level Security) — เปิดใช้ + อนุญาต anon ทุก operation
-- (แอพใช้ anon key โดยตรง ไม่ได้ใช้ Supabase Auth)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.admins      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- admins
DROP POLICY IF EXISTS "anon_all_admins"       ON public.admins;
CREATE POLICY "anon_all_admins"       ON public.admins       FOR ALL TO anon USING (true) WITH CHECK (true);

-- events
DROP POLICY IF EXISTS "anon_all_events"       ON public.events;
CREATE POLICY "anon_all_events"       ON public.events       FOR ALL TO anon USING (true) WITH CHECK (true);

-- guests
DROP POLICY IF EXISTS "anon_all_guests"       ON public.guests;
CREATE POLICY "anon_all_guests"       ON public.guests       FOR ALL TO anon USING (true) WITH CHECK (true);

-- app_settings
DROP POLICY IF EXISTS "anon_all_app_settings" ON public.app_settings;
CREATE POLICY "anon_all_app_settings" ON public.app_settings FOR ALL TO anon USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- Seed: Super Admin เริ่มต้น
-- !! เปลี่ยน username / password ก่อนใช้งานจริง !!
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.admins (username, password, role, status)
VALUES ('superadmin', 'changeme123', 'super', 'active')
ON CONFLICT (username) DO NOTHING;

-- Seed: app_settings (1 row เท่านั้น)
INSERT INTO public.app_settings (data)
SELECT '{"appName":"GuestTrack","appSub":"ใส่รหัสงาน (Event Code) เพื่อดูรายชื่อผู้เข้าพัก","logo":"🏨"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings);

-- ═══════════════════════════════════════════════════════════════
-- เสร็จแล้ว!  ไปอัพเดต SUPA_URL และ SUPA_KEY ใน index.html ได้เลย
-- ═══════════════════════════════════════════════════════════════
