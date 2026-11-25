ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS splash_screen_mode text NOT NULL DEFAULT 'system' CHECK (splash_screen_mode IN ('system','light','dark'));
NOTIFY pgrst, 'reload schema';
