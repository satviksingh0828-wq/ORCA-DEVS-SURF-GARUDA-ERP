ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_splash_screen_mode_check, ADD CONSTRAINT app_settings_splash_screen_mode_check CHECK (splash_screen_mode IN ('system','light','dark','app'));
NOTIFY pgrst, 'reload schema';
