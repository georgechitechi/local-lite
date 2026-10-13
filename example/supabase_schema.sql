-- ==============================================================================
-- Supabase Schema for local-lite (Rental Property Management App)
-- Realtime: ENABLED
-- Row Level Security (RLS): DISABLED
-- ==============================================================================

-- 1. Automatic Timestamp Trigger Function
CREATE OR REPLACE FUNCTION public.set_sync_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 2. Table: properties
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT,
  address TEXT,
  rent NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'Vacant',
  bedrooms NUMERIC DEFAULT 1,
  bathrooms NUMERIC DEFAULT 1,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_properties_updated_at ON public.properties (updated_at);

DROP TRIGGER IF EXISTS trigger_properties_updated_at ON public.properties;
CREATE TRIGGER trigger_properties_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sync_updated_at();

-- Disable RLS explicitly
ALTER TABLE public.properties DISABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 3. Table: tenants
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  property_id TEXT,
  property_name TEXT,
  lease_start TEXT,
  lease_end TEXT,
  rent_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'ACTIVE',
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_tenants_updated_at ON public.tenants (updated_at);

DROP TRIGGER IF EXISTS trigger_tenants_updated_at ON public.tenants;
CREATE TRIGGER trigger_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sync_updated_at();

-- Disable RLS explicitly
ALTER TABLE public.tenants DISABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 4. Table: maintenance_requests
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maintenance_requests (
  id TEXT PRIMARY KEY,
  property_name TEXT,
  title TEXT NOT NULL,
  priority TEXT DEFAULT 'MEDIUM',
  status TEXT DEFAULT 'PENDING',
  estimated_cost NUMERIC DEFAULT 0,
  reported_date TEXT,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_maintenance_requests_updated_at ON public.maintenance_requests (updated_at);

DROP TRIGGER IF EXISTS trigger_maintenance_requests_updated_at ON public.maintenance_requests;
CREATE TRIGGER trigger_maintenance_requests_updated_at
  BEFORE UPDATE ON public.maintenance_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sync_updated_at();

-- Disable RLS explicitly
ALTER TABLE public.maintenance_requests DISABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 5. Table: payments
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id TEXT PRIMARY KEY,
  property_name TEXT,
  tenant_name TEXT,
  amount NUMERIC DEFAULT 0,
  due_date TEXT,
  status TEXT DEFAULT 'PENDING',
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_payments_updated_at ON public.payments (updated_at);

DROP TRIGGER IF EXISTS trigger_payments_updated_at ON public.payments;
CREATE TRIGGER trigger_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sync_updated_at();

-- Disable RLS explicitly
ALTER TABLE public.payments DISABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 6. Enable Supabase Realtime Broadcast Replication
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'properties'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.properties;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'tenants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tenants;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'maintenance_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.maintenance_requests;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 7. Grant Public API Permissions (anon & authenticated roles)
-- ------------------------------------------------------------------------------
GRANT ALL ON TABLE public.properties TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.tenants TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.maintenance_requests TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.payments TO anon, authenticated, service_role;
