-- Shared readability controls for the automatic glass treatment used with the workspace video.
-- Safe to run more than once in the Supabase SQL Editor.
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS glass_surface_opacity integer NOT NULL DEFAULT 92
    CHECK (glass_surface_opacity BETWEEN 50 AND 98),
  ADD COLUMN IF NOT EXISTS glass_background_veil integer NOT NULL DEFAULT 25
    CHECK (glass_background_veil BETWEEN 0 AND 70),
  ADD COLUMN IF NOT EXISTS glass_text_color text NOT NULL DEFAULT '#172033'
    CHECK (glass_text_color ~ '^#[0-9A-Fa-f]{6}$');

SELECT id, glass_surface_opacity, glass_background_veil, glass_text_color, updated_at
FROM public.app_settings
LIMIT 5;
