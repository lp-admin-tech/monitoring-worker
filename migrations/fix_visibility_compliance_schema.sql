-- Add recommendations column to visibility_compliance table
ALTER TABLE public.visibility_compliance 
ADD COLUMN IF NOT EXISTS recommendations jsonb DEFAULT '[]'::jsonb;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
