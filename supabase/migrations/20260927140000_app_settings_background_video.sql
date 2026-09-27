-- Add shared, admin-configurable workspace video preferences.
-- Safe to run more than once in Supabase SQL Editor.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS background_video_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS background_video_url text NOT NULL
    DEFAULT 'https://cdn.pixabay.com/video/2024/04/29/209883_large.mp4';

-- Ensure the singleton settings row exists for installations that have not
-- initialized it yet. Existing rows retain their current theme/login settings.
INSERT INTO public.app_settings (theme, login_ui)
SELECT 'sky', 'plain'
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings);

-- Verify the current values after applying this migration.
SELECT id, theme, login_ui, background_video_enabled, background_video_url, updated_at
FROM public.app_settings
LIMIT 5;
