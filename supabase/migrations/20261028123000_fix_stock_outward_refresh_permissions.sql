-- Allow the Stock Outward frontend workflow to refresh its source-income snapshot.
-- The function remains SECURITY DEFINER and keeps its server-side validation.
GRANT EXECUTE ON FUNCTION public.refresh_stock_outward_source_income(UUID)
  TO anon, authenticated, service_role;
