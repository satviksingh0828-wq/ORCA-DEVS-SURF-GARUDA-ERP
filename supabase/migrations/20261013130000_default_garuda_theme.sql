-- Make the branded Garuda theme the application default instead of Azure Sky.
ALTER TABLE public.app_settings
  ALTER COLUMN theme SET DEFAULT 'garuda';

-- Move the existing untouched blue default to Garuda.
-- Other explicitly selected themes are preserved.
UPDATE public.app_settings
SET theme = 'garuda'
WHERE theme IS NULL OR theme = 'sky';
