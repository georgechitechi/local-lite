-- ==============================================================================
-- Supabase Schema for local-lite
-- Realtime: ENABLED
-- Row Level Security (RLS): DISABLED
-- ==============================================================================
SET client_min_messages = 'WARNING';
-- =============================================
-- INITIAL SETUP & CLEANUP
-- =============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "pgmq";
CREATE EXTENSION IF NOT EXISTS "pg_net";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- =============================================
-- CLEANUP EXISTING OBJECTS
-- =============================================
-- Drop all base tables in schema public
DO $$
DECLARE
  r RECORD;
  sql TEXT;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    sql := format('DROP TABLE IF EXISTS public.%I CASCADE;', r.table_name);
    EXECUTE sql;
  END LOOP;
END;
$$;

-- Drop all functions in schema public
DO $$
DECLARE
  r RECORD;
  sql TEXT;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
  LOOP
    sql := format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE;', r.proname, r.args);
    EXECUTE sql;
  END LOOP;
END;
$$;

-- This will DROP every RLS policy on tables in schemas "public" and "storage".
DO $$
DECLARE
  r RECORD;
  sql TEXT;
BEGIN
  FOR r IN
    SELECT p.polname AS policy_name,
           n.nspname  AS schema_name,
           c.relname  AS table_name
    FROM pg_policy p
    JOIN pg_class c ON p.polrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname = 'objects')
  LOOP
    sql := format('DROP POLICY IF EXISTS %I ON %I.%I;', r.policy_name, r.schema_name, r.table_name);
    EXECUTE sql;
  END LOOP;
END;
$$;

-- Drop all non-internal triggers on tables in schema public
DO $$
DECLARE
  r RECORD;
  sql TEXT;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name, t.tgname AS trigger_name
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
  LOOP
    sql := format('DROP TRIGGER IF EXISTS %I ON public.%I CASCADE;', r.trigger_name, r.table_name);
    EXECUTE sql;
  END LOOP;
END;
$$;

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
