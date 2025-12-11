-- Add visible_ads_percentage column to visibility_compliance table
-- This fixes the schema mismatch error seen in worker logs

ALTER TABLE public.visibility_compliance 
ADD COLUMN IF NOT EXISTS visible_ads_percentage numeric DEFAULT 0;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
