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
-- =============================================
-- DATABASE TABLES
-- =============================================
CREATE TABLE IF NOT EXISTS public.businesses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    logo_url TEXT,
    is_system BOOLEAN DEFAULT false,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, email, name)
);

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    name VARCHAR(100),
    avatar_url TEXT,
    phone VARCHAR(20),
    email VARCHAR(255),
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_email CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+[.][A-Za-z]+$'),
    CONSTRAINT valid_phone CHECK (phone IS NULL OR phone <> '')
);

CREATE TABLE IF NOT EXISTS public.totp_secrets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    secret TEXT NOT NULL,
    backup_codes TEXT[],
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT totp_secrets_email_key UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS public.business_shares (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    shared_with VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
    roles TEXT[] DEFAULT ARRAY['tenant']::TEXT[],
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    setting_key VARCHAR(50) NOT NULL,
    setting_value JSONB NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, business_id, setting_key)
);

CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(255),
    gender VARCHAR(20),
    marital_status VARCHAR(20),
    nationality VARCHAR(100),
    next_of_kin JSONB,
    address TEXT,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'former', 'inactive', 'blacklisted')),
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    date DATE NOT NULL,
    remarks TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.gallery_images (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    location TEXT NOT NULL,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, name)
);

CREATE TABLE IF NOT EXISTS public.houses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    house_number VARCHAR(50) NOT NULL,
    type VARCHAR(50) NOT NULL,
    monthly_rent DECIMAL(10,2) NOT NULL,
    is_serviceable BOOLEAN DEFAULT true,
    status VARCHAR(20) DEFAULT 'available',
    amenities JSONB,
    metadata JSONB DEFAULT '{}'::jsonb,
    photos TEXT[],
    deleted BOOLEAN DEFAULT false,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2), -- NULL allowed for full_month type
    type VARCHAR(20) DEFAULT 'fixed' CHECK (type IN ('fixed', 'percentage', 'full_month')),
    scope VARCHAR(20) DEFAULT 'business' CHECK (scope IN ('business', 'property', 'tenant')),
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    valid_from TIMESTAMP WITH TIME ZONE,
    valid_until TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, code)
);

CREATE TABLE IF NOT EXISTS public.contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    rent_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    remarks TEXT,
    documents TEXT[],
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    renewal_reminder_sent_at TIMESTAMP WITH TIME ZONE,
    house_id UUID REFERENCES houses(id) ON DELETE RESTRICT,
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT contracts_status_check CHECK (status IN ('active', 'expired', 'expiring_soon', 'terminated'))
);

CREATE TABLE IF NOT EXISTS public.receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    payment_date DATE NOT NULL,
    payment_period JSONB NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    notes TEXT,
    refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    is_refunded BOOLEAN NOT NULL DEFAULT FALSE,
    refund_reason TEXT,
    refunded_at TIMESTAMP WITH TIME ZONE,
    refunded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
    contract_id UUID REFERENCES contracts(id) ON DELETE RESTRICT,
    promotion_id UUID REFERENCES promotions(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(255),
    gender VARCHAR(20),
    marital_status VARCHAR(20),
    nationality VARCHAR(100),
    next_of_kin JSONB DEFAULT '{}'::jsonb,
    address TEXT,
    documents JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'converted', 'reserved')),
    payment_details JSONB DEFAULT '{"status": "pending"}'::jsonb,
    converted_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    house_id UUID REFERENCES houses(id),
    property_id UUID REFERENCES properties(id),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.maintenance_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
    house_id UUID REFERENCES houses(id) ON DELETE CASCADE,
    affected_houses UUID[] DEFAULT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    priority TEXT NOT NULL DEFAULT 'medium',
    images TEXT[] DEFAULT NULL,
    expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE,
    event_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- 'info_request', 'contract_renewal', 'push_token', etc.
    token TEXT UNIQUE NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.payment_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    message_content TEXT NOT NULL,
    transaction_date DATE,
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.payment_message_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_message_id UUID NOT NULL REFERENCES payment_messages(id) ON DELETE CASCADE,
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(payment_message_id, receipt_id)
);

CREATE TABLE IF NOT EXISTS public.receipt_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS public.reminder_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    reminder_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    status TEXT DEFAULT 'sent',
    message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    tenant_id UUID REFERENCES tenants(id),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.schedules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    schedule_type VARCHAR(100) NOT NULL,
    schedule JSONB NOT NULL DEFAULT '{"day": 1, "time": "03:00:00", "frequency": "daily"}'::jsonb,
    emails JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
    last_run TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    next_run TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 day' + INTERVAL '2 hours'),
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_unique_business_type
ON public.schedules(business_id, schedule_type)
WHERE deleted = FALSE;

CREATE TABLE IF NOT EXISTS public.backup_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    backup_started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    backup_completed_at TIMESTAMP WITH TIME ZONE,
    backup_status VARCHAR(20) NOT NULL CHECK (backup_status IN ('running', 'completed', 'failed')),
    file_name TEXT,
    file_size BIGINT,
    storage_path TEXT,
    storage_url TEXT,
    error_message TEXT,
    error_details JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    provider_reference TEXT,
    amount NUMERIC,
    currency TEXT DEFAULT 'KES',
    phone_number TEXT,
    status TEXT NOT NULL,
    is_success BOOLEAN NOT NULL DEFAULT false,
    transaction_reference TEXT UNIQUE,
    business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
    raw_payload JSONB,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- e.g., 'payment', 'welcome', 'announcement' ...
    channel TEXT NOT NULL, -- 'sms', 'email', 'whatsapp'
    title TEXT, -- For email subjects or internal titles
    content TEXT NOT NULL, -- The template body with placeholders like {{tenant_name}}
    is_html BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, name, channel)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  business_id UUID,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changes JSONB,
  label TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    scopes JSONB DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- =============================================
-- FUNCTIONS
-- =============================================
-- =============================================
-- REUSABLE DUPLICATE FINDER FUNCTION
-- Returns duplicates for a given table and column as JSONB
-- =============================================
CREATE OR REPLACE FUNCTION public.fn_find_duplicates(
    p_table_name TEXT,
    p_column_name TEXT
)
RETURNS SETOF JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY EXECUTE format('
        SELECT to_jsonb(t.*)
        FROM public.%I t
        JOIN (
            SELECT business_id, %I
            FROM public.%I
            WHERE deleted = false
            GROUP BY business_id, %I
            HAVING COUNT(*) > 1
        ) dupes ON t.business_id = dupes.business_id AND t.%I = dupes.%I
        WHERE t.deleted = false;
    ', p_table_name, p_column_name, p_table_name, p_column_name, p_column_name, p_column_name);
END;
$$;

-- Combined function to create default settings for a business
CREATE OR REPLACE FUNCTION create_default_business_settings(
    p_business_id UUID DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_skip_existing BOOLEAN DEFAULT FALSE
)
RETURNS VOID AS $$
DECLARE
    business_id_val UUID;
    user_id_val UUID;
BEGIN
    -- Handle both trigger and direct call scenarios
    IF p_business_id IS NULL THEN
        business_id_val := NEW.id;
        user_id_val := NEW.user_id;
    ELSE
        business_id_val := p_business_id;
        user_id_val := p_user_id;
    END IF;

    -- Insert all default settings for the business
    INSERT INTO settings (business_id, user_id, setting_key, setting_value)
    SELECT business_id_val, user_id_val, setting_key, setting_value
    FROM (VALUES 
        ('house_types', '[
            {"id": gen_random_uuid(), "value": "single", "label": "Single Room", "active": true, "amenities": ["water", "electricity", "security", "garbage_collection"]},
            {"id": gen_random_uuid(), "value": "bedsitter", "label": "Bedsitter", "active": true, "amenities": ["water", "electricity", "security", "parking", "garbage_collection"]},
            {"id": gen_random_uuid(), "value": "one_bedroom", "label": "One Bedroom", "active": true, "amenities": ["water", "electricity", "security", "parking", "garbage_collection", "kitchen"]},
            {"id": gen_random_uuid(), "value": "two_bedroom", "label": "Two Bedroom", "active": true, "amenities": ["water", "electricity", "security", "parking", "garbage_collection", "kitchen", "living_room"]},
            {"id": gen_random_uuid(), "value": "other", "label": "Other", "active": true, "amenities": ["water", "electricity"]}
        ]'::JSONB),
        
        ('amenities', '[
            {"id": gen_random_uuid(), "value": "water", "label": "Water", "active": true},
            {"id": gen_random_uuid(), "value": "electricity", "label": "Electricity", "active": true},
            {"id": gen_random_uuid(), "value": "security", "label": "Security", "active": true},
            {"id": gen_random_uuid(), "value": "parking", "label": "Parking", "active": true},
            {"id": gen_random_uuid(), "value": "garbage_collection", "label": "Garbage Collection", "active": true},
            {"id": gen_random_uuid(), "value": "kitchen", "label": "Kitchen", "active": true},
            {"id": gen_random_uuid(), "value": "living_room", "label": "Living Room", "active": true},
            {"id": gen_random_uuid(), "value": "balcony", "label": "Balcony", "active": true},
            {"id": gen_random_uuid(), "value": "garden", "label": "Garden", "active": true},
            {"id": gen_random_uuid(), "value": "internet", "label": "Internet", "active": true}
        ]'::JSONB),
        
        ('currency_settings', '[
            {"code": "KES", "symbol": "KSh", "name": "Kenyan Shilling", "default": true},
            {"code": "USD", "symbol": "$", "name": "US Dollar", "default": false},
            {"code": "EUR", "symbol": "€", "name": "Euro", "default": false},
            {"code": "GBP", "symbol": "£", "name": "British Pound", "default": false}
        ]'::JSONB),
        
        ('contract_settings', '{
            "securityDeposit": {"required": false, "amount": 1, "refundable": true},
            "paymentTerms": {"dueDate": 5, "gracePeriod": 3, "lateFee": 500},
            "restrictions": {
                "pets": {"allowed": true, "details": "Only domesticated pets are allowed"},
                "guests": {"allowed": true, "details": "Maximum 2 nights"},
                "subletting": {"allowed": false, "details": "No subletting"},
                "modifications": {"allowed": false, "details": "No structural modifications"}
            },
            "maintenance": {
                "utilities": [
                    {"id": "water", "label": "Water Supply", "tenant": false, "landlord": true},
                    {"id": "electricity", "label": "Electricity", "tenant": false, "landlord": true},
                    {"id": "internet", "label": "Internet", "tenant": true, "landlord": false},
                    {"id": "garbage", "label": "Garbage Collection", "tenant": false, "landlord": true},
                    {"id": "parking", "label": "Parking", "tenant": true, "landlord": false}
                ],
                "extras": [
                    {"id": "major_repairs", "label": "Major Repairs", "tenant": false, "landlord": true},
                    {"id": "minor_repairs", "label": "Minor Repairs", "tenant": true, "landlord": false},
                    {"id": "roof", "label": "Roof Repairs", "tenant": false, "landlord": true},
                    {"id": "plumbing", "label": "Plumbing Issues", "tenant": false, "landlord": true},
                    {"id": "electrical", "label": "Electrical Issues", "tenant": false, "landlord": true},
                    {"id": "light_bulbs", "label": "Light Bulbs", "tenant": true, "landlord": false},
                    {"id": "cleaning", "label": "Cleaning", "tenant": true, "landlord": false}
                ]
            }
        }'::JSONB),
        
        ('notification_settings', '{
            "enabled": false
        }'::JSONB),
        
        ('links', '{
            "whatsapp_group": "",
            "facebook": "",
            "instagram": "",
            "twitter": "",
            "youtube": ""
        }'::JSONB),
        
        ('payment_methods', '[
            {"id": gen_random_uuid(), "name": "Cash", "active": true, "default": true},
            {"id": gen_random_uuid(), "name": "M-Pesa", "active": true, "default": false},
            {"id": gen_random_uuid(), "name": "Bank Transfer", "active": true, "default": false},
            {"id": gen_random_uuid(), "name": "Cheque", "active": false, "default": false}
        ]'::JSONB)
    ) AS new_settings(setting_key, setting_value)
    WHERE NOT p_skip_existing OR NOT EXISTS (
        SELECT 1 FROM settings s 
        WHERE s.business_id = business_id_val 
        AND s.setting_key = new_settings.setting_key
    );

EXCEPTION
    WHEN OTHERS THEN
        RAISE LOG 'Error creating default settings for business %: %', business_id_val, SQLERRM;
        IF p_business_id IS NULL THEN
            -- This is a trigger call, re-raise the exception
            RAISE;
        END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a trigger-specific function that calls the main function
CREATE OR REPLACE FUNCTION trigger_create_default_business_settings()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM create_default_business_settings(NEW.id, NEW.user_id, false);
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE LOG 'Error creating default settings for business %: %', NEW.id, SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create default settings for existing businesses that don't have them
CREATE OR REPLACE FUNCTION initialize_missing_business_settings()
RETURNS TABLE (
    business_id UUID,
    business_name TEXT,
    settings_created INTEGER,
    message TEXT
) AS $$
DECLARE
    business_record RECORD;
    settings_count INTEGER;
    total_created INTEGER := 0;
BEGIN
    -- Loop through all businesses missing settings
    FOR business_record IN
        SELECT b.id, b.name, b.user_id
        FROM businesses b
        WHERE NOT EXISTS (
            SELECT 1 FROM settings s 
            WHERE s.business_id = b.id 
            AND s.setting_key IN ('house_types', 'amenities', 'currency_settings')
        )
    LOOP
        -- Create default settings for this business
        PERFORM create_default_business_settings(
            business_record.id, 
            business_record.user_id,
            true  -- skip_existing = true
        );
        
        -- Count how many settings were created
        SELECT COUNT(*) INTO settings_count
        FROM settings 
        WHERE settings.business_id = business_record.id;
        
        total_created := total_created + settings_count;
        
        RETURN QUERY SELECT
            business_record.id,
            business_record.name::TEXT,
            settings_count,
            'Default settings created successfully'::TEXT;
    END LOOP;
    
    -- If no businesses needed initialization
    IF total_created = 0 THEN
        RETURN QUERY SELECT
            NULL::UUID,
            'N/A'::TEXT,
            0,
            'All businesses already have default settings'::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to seed all existing businesses with default settings
CREATE OR REPLACE FUNCTION seed_all_businesses_with_defaults()
RETURNS TABLE (
    business_id UUID,
    business_name TEXT,
    settings_created INTEGER,
    message TEXT
) AS $$
DECLARE
    business_record RECORD;
    settings_count INTEGER;
    total_created INTEGER := 0;
BEGIN
    -- Loop through all businesses and create missing settings
    FOR business_record IN
        SELECT b.id, b.name, b.user_id
        FROM businesses b
    LOOP
        -- Create default settings for this business
        PERFORM create_default_business_settings(
            business_record.id, 
            business_record.user_id,
            true  -- skip_existing = true
        );
        
        -- Count how many settings were created for this business
        SELECT COUNT(*) INTO settings_count
        FROM settings 
        WHERE settings.business_id = business_record.id;
        
        total_created := total_created + settings_count;
        
        RETURN QUERY SELECT
            business_record.id,
            business_record.name::TEXT,
            settings_count,
            'Default settings created/updated successfully'::TEXT;
    END LOOP;
    
    -- If no businesses exist
    IF total_created = 0 THEN
        RETURN QUERY SELECT
            NULL::UUID,
            'N/A'::TEXT,
            0,
            'No businesses found to seed'::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check for existing active contracts per house
CREATE OR REPLACE FUNCTION check_single_active_contract_per_house()
RETURNS TRIGGER AS $$
BEGIN
  -- Only check if the contract is being set to active
  IF NEW.status = 'active' THEN
    -- Check if this house already has an active contract (excluding current contract on update)
    IF EXISTS (
      SELECT 1 FROM contracts 
      WHERE house_id = NEW.house_id
        AND status = 'active' 
        AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN
      RAISE EXCEPTION 'This house already has an active contract. Please terminate or expire the existing contract first.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- Function to get pending rent for a specific date (historical or current)
CREATE OR REPLACE FUNCTION get_pending_rent_for_date(target_date DATE, target_business_id UUID)
RETURNS TABLE (
    tenant_id UUID,
    business_id UUID,
    tenant_name VARCHAR,
    tenant_phone VARCHAR,
    tenant_email VARCHAR,
    house_number VARCHAR,
    property_name VARCHAR,
    contract_id UUID,
    contract_amount DECIMAL,
    contract_start_date DATE,
    contract_end_date DATE,
    target_month INTEGER,
    target_year INTEGER,
    amount_paid DECIMAL,
    amount_pending DECIMAL,
    payment_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    t_month INTEGER;
    t_year INTEGER;
BEGIN
    t_month := EXTRACT(MONTH FROM target_date);
    t_year := EXTRACT(YEAR FROM target_date);

    RETURN QUERY
    WITH target_contracts AS (
        SELECT
            t.id AS t_id,
            c.business_id AS b_id,
            t.name AS t_name,
            t.phone AS t_phone,
            t.email AS t_email,
            h.house_number AS h_number,
            p.name AS p_name,
            c.id AS c_id,
            c.rent_amount AS c_amount,
            c.start_date AS c_start,
            c.end_date AS c_end
        FROM tenants t
        JOIN contracts c ON t.id = c.tenant_id
        JOIN houses h ON c.house_id = h.id
        JOIN properties p ON h.property_id = p.id
        WHERE
            c.business_id = target_business_id
            AND c.status IN ('active', 'expiring_soon') 
            -- Check if contract covered the target date
            AND c.start_date <= target_date
            AND c.end_date >= target_date
            -- Check for breaks (holiday breaks)
            AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(c.metadata->'breaks', '[]'::jsonb)) AS b
                WHERE (b->>'start_date')::date <= target_date
                AND (b->>'end_date')::date >= target_date
            )
    ),
    contract_payments AS (
        SELECT
            tc.c_id,
            COALESCE(SUM(r.amount), 0) AS total_paid,
            CASE
                WHEN SUM(CASE WHEN r.status = 'partial' THEN 1 ELSE 0 END) > 0 THEN 'partial'
                WHEN SUM(r.amount) >= tc.c_amount THEN 'complete'
                ELSE 'unpaid'
            END AS p_status
        FROM target_contracts tc
        LEFT JOIN receipts r ON r.contract_id = tc.c_id
            AND (r.payment_period->>'month')::int = t_month
            AND (r.payment_period->>'year')::int = t_year
        GROUP BY tc.c_id, tc.c_amount
    )
    SELECT
        tc.t_id,
        tc.b_id,
        tc.t_name,
        tc.t_phone,
        tc.t_email,
        tc.h_number,
        tc.p_name,
        tc.c_id,
        tc.c_amount,
        tc.c_start,
        tc.c_end,
        t_month,
        t_year,
        COALESCE(cp.total_paid, 0) AS amount_paid,
        (tc.c_amount - COALESCE(cp.total_paid, 0)) AS amount_pending,
        COALESCE(cp.p_status, 'unpaid') AS payment_status
    FROM target_contracts tc
    LEFT JOIN contract_payments cp ON cp.c_id = tc.c_id
    WHERE COALESCE(cp.total_paid, 0) < tc.c_amount
    ORDER BY tc.t_name;
END;
$$;


-- Generate renewal token
CREATE OR REPLACE FUNCTION create_contract_renewal_token(
    p_contract_id UUID,
    p_expires_hours INTEGER DEFAULT 168
)
RETURNS TEXT AS $$
DECLARE
    token_value TEXT;
    v_tenant_id UUID;
    v_business_id UUID;
BEGIN
    -- Get contract info
    SELECT tenant_id, business_id INTO v_tenant_id, v_business_id
    FROM contracts WHERE id = p_contract_id;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Contract not found';
    END IF;

    token_value := encode(extensions.gen_random_bytes(16), 'hex');
    
    -- Insert into tokens table
    INSERT INTO tokens (
        business_id,
        user_id,
        type,
        token,
        metadata
    ) VALUES (
        v_business_id,
        (SELECT auth.uid()),
        'contract_renewal',
        token_value,
        jsonb_build_object(
            'contract_id', p_contract_id,
            'tenant_id', v_tenant_id,
            'expires_at', (CURRENT_TIMESTAMP + (p_expires_hours || ' hours')::INTERVAL)
        )
    );

    -- Update contract status to ensure it's in a valid state for renewal
    UPDATE contracts
    SET status = CASE WHEN status = 'expired' THEN 'active' ELSE status END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_contract_id;
    
    RETURN token_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated: validate_renewal_token
CREATE OR REPLACE FUNCTION validate_renewal_token(p_token TEXT)
RETURNS TABLE(
    is_valid BOOLEAN, contract_id UUID, tenant_id UUID, end_date DATE,
    rent_amount DECIMAL, tenant_name TEXT, tenant_email TEXT,
    property_name TEXT, house_number TEXT
) AS $$
DECLARE
    token_record RECORD;
BEGIN
    SELECT (t.metadata->>'contract_id')::uuid as contract_id,
           (t.metadata->>'tenant_id')::uuid as tenant_id,
           c.end_date, c.rent_amount,
           ten.name::TEXT as tenant_name, ten.email::TEXT as tenant_email,
           p.name::TEXT as property_name, h.house_number::TEXT as house_number
    INTO token_record
    FROM tokens t
    INNER JOIN contracts c ON (t.metadata->>'contract_id')::uuid = c.id
    INNER JOIN tenants ten ON c.tenant_id = ten.id
    INNER JOIN houses h ON c.house_id = h.id
    INNER JOIN properties p ON h.property_id = p.id
    WHERE t.token = p_token
      AND t.type = 'contract_renewal'
      AND (t.metadata->>'expires_at')::timestamptz > CURRENT_TIMESTAMP
      AND (t.metadata->>'used_at') IS NULL
      AND c.status IN ('active', 'expiring_soon');
    
    IF token_record.contract_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::DATE, NULL::DECIMAL,
                             NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    ELSE
        RETURN QUERY SELECT true, token_record.contract_id, token_record.tenant_id, token_record.end_date,
                             token_record.rent_amount, token_record.tenant_name, token_record.tenant_email,
                             token_record.property_name, token_record.house_number;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated: renew_contract
CREATE OR REPLACE FUNCTION renew_contract(
    p_token TEXT, p_new_end_date DATE, p_new_rent_amount DECIMAL DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    token_record RECORD;
    v_contract_id UUID;
BEGIN
    -- Validate token
    SELECT t.id as token_internal_id, (t.metadata->>'contract_id')::uuid as contract_id
    INTO token_record
    FROM tokens t
    INNER JOIN contracts c ON (t.metadata->>'contract_id')::uuid = c.id
    WHERE t.token = p_token
      AND t.type = 'contract_renewal'
      AND (t.metadata->>'expires_at')::timestamptz > CURRENT_TIMESTAMP
      AND (t.metadata->>'used_at') IS NULL
      AND c.status IN ('active', 'expiring_soon');
    
    IF token_record.contract_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid or expired renewal token');
    END IF;
    
    v_contract_id := token_record.contract_id;
    
    -- Update token as used inside metadata
    UPDATE tokens 
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('used_at', CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = token_record.token_internal_id;
    
    -- Update contract
    UPDATE contracts
    SET end_date = p_new_end_date,
        rent_amount = COALESCE(p_new_rent_amount, rent_amount),
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_contract_id;
    
    RETURN jsonb_build_object(
        'success', true, 
        'message', 'Contract renewed successfully',
        'contract_id', v_contract_id, 
        'new_end_date', p_new_end_date
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Find expiring contracts
CREATE OR REPLACE FUNCTION find_expiring_contracts(p_days_before_expiry INTEGER DEFAULT 30)
RETURNS TABLE(
    contract_id UUID, tenant_id UUID, tenant_name TEXT, tenant_email TEXT,
    property_name TEXT, house_number TEXT, end_date DATE,
    days_until_expiry INTEGER, rent_amount DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT c.id, t.id, t.name::TEXT, t.email::TEXT, p.name::TEXT, h.house_number::TEXT,
           c.end_date, (c.end_date - CURRENT_DATE)::INTEGER, c.rent_amount
    FROM contracts c
    INNER JOIN tenants t ON c.tenant_id = t.id
    INNER JOIN houses h ON c.house_id = h.id
    INNER JOIN properties p ON h.property_id = p.id
    WHERE c.end_date IS NOT NULL
      AND c.end_date <= CURRENT_DATE + (p_days_before_expiry || ' days')::INTERVAL
      AND c.end_date > CURRENT_DATE
      AND c.status IN ('active', 'expiring_soon')
      AND (c.renewal_reminder_sent_at IS NULL
           OR c.renewal_reminder_sent_at < CURRENT_TIMESTAMP - INTERVAL '7 days')
    ORDER BY c.end_date ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Mark expired contracts
CREATE OR REPLACE FUNCTION mark_expired_contracts()
RETURNS INTEGER AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    UPDATE contracts SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE end_date < CURRENT_DATE AND status IN ('active', 'expiring_soon');
    
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated: create_info_request_token
CREATE OR REPLACE FUNCTION create_info_request_token(
    p_tenant_id UUID,
    p_expires_hours INTEGER DEFAULT 168
)
RETURNS TEXT AS $$
DECLARE
    v_business_id UUID;
    v_token TEXT;
BEGIN
    -- Get business ID from tenant
    SELECT business_id INTO v_business_id
    FROM tenants
    WHERE id = p_tenant_id;

    IF v_business_id IS NULL THEN
        RAISE EXCEPTION 'Tenant not found or has no business associated';
    END IF;

    -- Generate a unique token
    v_token := encode(extensions.gen_random_bytes(16), 'hex');

    -- Insert into tokens table
    INSERT INTO tokens (
        business_id,
        user_id,
        type,
        token,
        metadata
    )
    VALUES (
        v_business_id,
        (SELECT auth.uid()),
        'info_request',
        v_token,
        jsonb_build_object(
            'tenant_id', p_tenant_id,
            'expires_at', (CURRENT_TIMESTAMP + (p_expires_hours || ' hours')::INTERVAL)
        )
    );

    RETURN v_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Find tenants with missing information
CREATE OR REPLACE FUNCTION find_tenants_with_missing_info()
RETURNS TABLE (
    tenant_id UUID,
    tenant_name TEXT,
    tenant_email TEXT,
    business_name TEXT,
    missing_fields TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id,
        t.name::TEXT,
        t.email::TEXT,
        b.name::TEXT,
        ARRAY(
            SELECT unnest(ARRAY[
                CASE WHEN t.email IS NULL OR t.email LIKE 'placeholder%' THEN 'email' ELSE NULL END,
                CASE WHEN t.phone IS NULL OR trim(t.phone) = '' THEN 'phone' ELSE NULL END
            ]) WHERE unnest IS NOT NULL
        ) as missing_fields
    FROM tenants t
    JOIN businesses b ON t.business_id = b.id
    WHERE t.deleted = FALSE
      AND t.status = 'active'
      AND (
          t.email IS NULL 
          OR t.email LIKE 'placeholder%' 
          OR t.phone IS NULL 
          OR trim(t.phone) = ''
      );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- HELPER FUNCTIONS
-- =============================================
-- Function to get table columns for schema validation
CREATE OR REPLACE FUNCTION get_table_columns(table_name text)
RETURNS TABLE(column_name text, data_type text, is_nullable text, column_default text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    c.column_name::text,
    c.data_type::text,
    c.is_nullable::text,
    c.column_default::text
  FROM information_schema.columns c
  WHERE c.table_name = $1
    AND c.table_schema = 'public'
  ORDER BY c.ordinal_position;
$$;

-- Function to list all tables in public schema
CREATE OR REPLACE FUNCTION list_tables()
RETURNS TABLE(table_name text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT t.table_name::text
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
  ORDER BY t.table_name;
$$;

-- Function to calculate next run time
CREATE OR REPLACE FUNCTION calculate_next_run_time(
    p_schedule JSONB,
    p_last_run TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS TIMESTAMP WITH TIME ZONE AS $$
DECLARE
    next_time TIMESTAMP WITH TIME ZONE;
    current_time TIMESTAMP WITH TIME ZONE := CURRENT_TIMESTAMP;
    base_time TIMESTAMP WITH TIME ZONE;
    frequency TEXT;
    schedule_time_str TEXT;
    schedule_time TIME;
BEGIN
    frequency := p_schedule->>'frequency';
    schedule_time_str := p_schedule->>'time';

    -- Safely convert time string to TIME
    BEGIN
        IF schedule_time_str IS NOT NULL AND schedule_time_str ~ '^\d{2}:\d{2}:\d{2}' THEN
            schedule_time_str := regexp_replace(schedule_time_str, '^(\d{2}:\d{2}:\d{2}).*', '\1');
            schedule_time := schedule_time_str::TIME;
        ELSE
            schedule_time := '02:00:00'::TIME;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to parse time string: %', schedule_time_str;
        schedule_time := '02:00:00'::TIME;
    END;

    -- If no last run, start from current time
    IF p_last_run IS NULL THEN
        base_time := current_time;
    ELSE
        base_time := p_last_run;
    END IF;

    -- Calculate next run based on frequency
    CASE frequency
        WHEN 'daily' THEN
            next_time := DATE_TRUNC('day', base_time) + INTERVAL '1 day' + schedule_time::INTERVAL;
        WHEN 'weekly' THEN
            next_time := DATE_TRUNC('week', base_time) + INTERVAL '1 week' + schedule_time::INTERVAL;
        WHEN 'monthly' THEN
            next_time := DATE_TRUNC('month', base_time) + INTERVAL '1 month' + schedule_time::INTERVAL;
        ELSE
            next_time := DATE_TRUNC('day', base_time) + INTERVAL '1 day' + schedule_time::INTERVAL;
    END CASE;

    -- If calculated time is in the past, add the frequency interval
    IF next_time <= base_time THEN
        CASE frequency
            WHEN 'daily' THEN next_time := next_time + INTERVAL '1 day';
            WHEN 'weekly' THEN next_time := next_time + INTERVAL '1 week';
            WHEN 'monthly' THEN next_time := next_time + INTERVAL '1 month';
            ELSE next_time := next_time + INTERVAL '1 day';
        END CASE;
    END IF;

    RETURN next_time;
END;
$$ LANGUAGE plpgsql;

-- Handle Times Function (Manages created_at and updated_at)
CREATE OR REPLACE FUNCTION handle_times()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        IF NEW.created_at IS NULL THEN
            NEW.created_at := now();
        END IF;
        IF NEW.updated_at IS NULL THEN
            NEW.updated_at := now();
        END IF;
    ELSEIF (TG_OP = 'UPDATE') THEN
        NEW.created_at := OLD.created_at;

        IF NEW.updated_at IS NULL OR NEW.updated_at = OLD.updated_at THEN
            NEW.updated_at := now();
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to get user by email
CREATE OR REPLACE FUNCTION get_user_by_email(user_email text)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT json_build_object(
    'id', id,
    'email', email
  )
  FROM auth.users
  WHERE email = user_email;
$$;
-- =============================================
-- BUSINESS LOGIC FUNCTIONS
-- =============================================
-- Function to check business access
CREATE OR REPLACE FUNCTION check_business_access(p_business_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_email TEXT := auth.jwt()->>'email';
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM businesses c
        WHERE c.id = p_business_id
        AND (
            c.user_id = v_uid
            OR EXISTS (
                SELECT 1 FROM business_shares cs
                WHERE cs.business_id = c.id
                AND cs.shared_with = v_email
                AND cs.status IN ('active', 'pending')
            )
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to safely delete business data by business ID
CREATE OR REPLACE FUNCTION public.delete_business_data( p_business_id UUID )
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Log the business being deleted
    RAISE NOTICE 'delete_business_data called with business_id: %', p_business_id;
    
    -- Check if business exists
    IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business_id) THEN
        RAISE NOTICE 'Business not found: %', p_business_id;
        RETURN;
    END IF;
    
    -- Bypass audit logging to avoid foreign key violations during cascade
    PERFORM set_config('app.skip_audit', 'true', true);
    
    DELETE FROM public.businesses 
    WHERE id = p_business_id;
    
    RAISE NOTICE 'Deleted business: %', p_business_id;
END;
$$;

-- Function to truncate all tables in the public schema
CREATE OR REPLACE FUNCTION public.truncate_all_tables()
RETURNS void AS $$
BEGIN
    EXECUTE (
        SELECT 'TRUNCATE TABLE ' ||
               string_agg(format('%I.%I', schemaname, tablename), ', ') ||
               ' CASCADE'
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename NOT IN ('profiles', 'resumes')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- To run this function, use:
-- SELECT public.truncate_all_tables();

-- Function to handle property deletion
CREATE OR REPLACE FUNCTION handle_property_deletion()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE houses
    SET
        status = 'property_deleted',
        property_id = NULL
    WHERE property_id = OLD.id;

    UPDATE contracts c
    SET status = 'expired',
        end_date = CURRENT_DATE
    FROM houses h
    WHERE c.house_id = h.id
    AND h.property_id = OLD.id
    AND c.status = 'active';

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
-- =============================================
-- BACKUP SYSTEM FUNCTIONS
-- =============================================
-- Function to safely update next backup times for existing schedules
CREATE OR REPLACE FUNCTION update_all_next_backup_times()
RETURNS TEXT AS $$
BEGIN
    -- Update next_run for all system_backup schedules using the safe calculation function
    UPDATE schedules
    SET next_run = calculate_next_run_time(schedule, last_run)
    WHERE (next_run IS NULL OR next_run <= CURRENT_TIMESTAMP) AND schedule_type = 'system_backup';
    
    RETURN 'Backup times updated successfully';
END;
$$ LANGUAGE plpgsql;

-- Function to ensure default business exists
CREATE OR REPLACE FUNCTION ensure_default_business()
RETURNS UUID AS $$
DECLARE
    default_business_id UUID;
BEGIN
    INSERT INTO businesses (id, name, address, phone, email, user_id, is_system)
    VALUES (
        '00000000-0000-0000-0000-000000000000'::UUID,
        'Default Business',
        'System Default Address',
        '+254 720 000000',
        'system@default.com',
        NULL,
        true
    )
    ON CONFLICT (id) DO UPDATE 
    SET name = EXCLUDED.name 
    RETURNING id INTO default_business_id;

    RETURN default_business_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to handle auth user changes
CREATE OR REPLACE FUNCTION handle_auth_user()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO profiles (
            user_id, 
            email, 
            name
        )
        VALUES (
            NEW.id,
            COALESCE(NEW.email, ''), 
            COALESCE(
                NEW.raw_user_meta_data->>'name', 
                NEW.raw_user_meta_data->>'full_name',
                COALESCE(NEW.email, ''), 
                ''
            )
        );
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE profiles
        SET 
            email = COALESCE(NEW.email, ''),
            name = COALESCE(
                NEW.raw_user_meta_data->>'name', 
                NEW.raw_user_meta_data->>'full_name',
                COALESCE(NEW.email, ''), 
                ''
            )
        WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error handling user profile: %', SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Robust Realtime Control
CREATE OR REPLACE FUNCTION public.set_realtime_enabled(p_enabled boolean)
RETURNS void AS $$
DECLARE
    r record;
BEGIN
    IF NOT p_enabled THEN
        -- Disable Realtime: Drop all tables from publication
        FOR r IN (
            SELECT tablename 
            FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        ) LOOP
            BEGIN
                EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS %I', r.tablename);
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Could not drop table % from publication', r.tablename;
            END;
        END LOOP;
    ELSE
        -- Enable Realtime: Add all public tables from information_schema
        FOR r IN (
            SELECT t.table_name as tablename
            FROM information_schema.tables t
            WHERE t.table_schema = 'public'
              AND t.table_type = 'BASE TABLE'
              AND NOT EXISTS (
                  SELECT 1 
                  FROM pg_publication_tables pt
                  WHERE pt.pubname = 'supabase_realtime' 
                    AND pt.tablename = t.table_name
              )
        ) LOOP
            BEGIN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', r.tablename);
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Could not add table % to publication', r.tablename;
            END;
        END LOOP;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger Control
CREATE OR REPLACE FUNCTION public.set_all_triggers_enabled(p_enabled boolean)
RETURNS void AS $$
DECLARE
    r record;
BEGIN
    FOR r IN (
        SELECT c.relname AS tablename, t.tgname AS triggername
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND t.tgisinternal = false
          AND t.tgname NOT LIKE 'handle_times_%'
          AND t.tgname NOT LIKE 'trigger_%_metadata_history'
    ) LOOP
        IF p_enabled THEN
            EXECUTE format('ALTER TABLE %I ENABLE TRIGGER %I', r.tablename, r.triggername);
        ELSE
            EXECUTE format('ALTER TABLE %I DISABLE TRIGGER %I', r.tablename, r.triggername);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RLS Control
CREATE OR REPLACE FUNCTION public.set_rls_enabled(p_enabled boolean)
RETURNS void AS $$
DECLARE
    v_sql text;
BEGIN
    IF p_enabled THEN
        SELECT string_agg(
            format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;', relname),
            ' '
        ) INTO v_sql
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' 
          AND c.relkind = 'r'
          AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
    ELSE
        SELECT string_agg(
            format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY, NO FORCE ROW LEVEL SECURITY;', relname),
            ' '
        ) INTO v_sql
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' 
          AND c.relkind = 'r'
          AND (c.relrowsecurity OR c.relforcerowsecurity);
    END IF;

    IF v_sql IS NOT NULL THEN
        EXECUTE v_sql;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- TRIGGERS (After functions are created)
-- =============================================
-- =============================================
-- REPORTING FUNCTIONS
-- =============================================
-- =============================================
-- TOTP & RENEWAL FUNCTIONS
-- =============================================
-- Generate backup codes
CREATE OR REPLACE FUNCTION generate_backup_codes()
RETURNS TEXT[] AS $$
DECLARE
    codes TEXT[] := '{}';
    i INTEGER;
    code TEXT;
BEGIN
    FOR i IN 1..10 LOOP
        code := '';
        FOR j IN 1..8 LOOP
            code := code || chr(ascii('0') + floor(random() * 10)::int);
        END LOOP;
        codes := array_append(codes, code);
    END LOOP;
    RETURN codes;
END;
$$ LANGUAGE plpgsql;

-- Create TOTP secret
CREATE OR REPLACE FUNCTION create_totp_secret(p_email TEXT, p_secret TEXT)
RETURNS TABLE(secret TEXT, backup_codes TEXT[], qr_code_url TEXT) AS $$
DECLARE
    v_backup_codes TEXT[];
    v_qr_url TEXT;
BEGIN
    -- Security check: Ensure user is only managing their own TOTP
    IF lower(p_email) != lower(auth.jwt()->>'email') THEN
        RAISE EXCEPTION 'Not authorized to create TOTP secret for another user';
    END IF;

    v_backup_codes := generate_backup_codes();
    v_qr_url := 'otpauth://totp/Bookings Manager:' || p_email || 
                '?secret=' || p_secret || '&issuer=Bookings Manager&algorithm=SHA1&digits=6&period=30';
    
    INSERT INTO totp_secrets (email, secret, backup_codes, is_enabled, is_verified)
    VALUES (p_email, p_secret, v_backup_codes, false, false)
    ON CONFLICT (email) DO UPDATE SET 
        secret = EXCLUDED.secret, backup_codes = EXCLUDED.backup_codes,
        is_enabled = false, is_verified = false, updated_at = CURRENT_TIMESTAMP;
    
    RETURN QUERY SELECT p_secret, v_backup_codes, v_qr_url;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify TOTP setup
CREATE OR REPLACE FUNCTION verify_totp_setup(p_email TEXT, p_code TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Security check
    IF lower(p_email) != lower(auth.jwt()->>'email') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    IF NOT EXISTS(SELECT 1 FROM totp_secrets WHERE email = p_email AND is_verified = false) THEN
        RETURN false;
    END IF;
    
    UPDATE totp_secrets SET is_verified = true, is_enabled = true, updated_at = CURRENT_TIMESTAMP WHERE email = p_email;
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify TOTP code
CREATE OR REPLACE FUNCTION verify_totp_code(
    p_email TEXT, p_code TEXT, p_ip_address INET DEFAULT NULL, p_user_agent TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Security check
    IF lower(p_email) != lower(auth.jwt()->>'email') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    IF NOT EXISTS(SELECT 1 FROM totp_secrets WHERE email = p_email AND is_enabled = true AND is_verified = true) THEN
        RETURN false;
    END IF;
    
    UPDATE totp_secrets SET last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE email = p_email;
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Use backup code
CREATE OR REPLACE FUNCTION use_backup_code(
    p_email TEXT, p_backup_code TEXT, p_ip_address INET DEFAULT NULL, p_user_agent TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    totp_record RECORD;
    updated_codes TEXT[];
BEGIN
    -- Security check
    IF lower(p_email) != lower(auth.jwt()->>'email') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    SELECT * INTO totp_record FROM totp_secrets 
    WHERE email = p_email AND is_enabled = true AND is_verified = true;
    
    IF NOT FOUND THEN RETURN false; END IF;
    IF NOT (p_backup_code = ANY(totp_record.backup_codes)) THEN RETURN false; END IF;
    
    SELECT array_agg(code) INTO updated_codes
    FROM unnest(totp_record.backup_codes) AS code WHERE code != p_backup_code;
    
    UPDATE totp_secrets SET backup_codes = COALESCE(updated_codes, '{}'),
        last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE email = p_email;
    
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Disable TOTP
CREATE OR REPLACE FUNCTION disable_totp(p_email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Security check
    IF lower(p_email) != lower(auth.jwt()->>'email') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    UPDATE totp_secrets SET is_enabled = false, updated_at = CURRENT_TIMESTAMP WHERE email = p_email;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get TOTP status
CREATE OR REPLACE FUNCTION get_totp_status(p_email TEXT)
RETURNS TABLE(is_enabled BOOLEAN, is_verified BOOLEAN, backup_codes_count INTEGER, last_used_at TIMESTAMP WITH TIME ZONE) AS $$
BEGIN
    -- Security check
    IF lower(p_email) != lower(auth.jwt()->>'email') THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    RETURN QUERY
    SELECT COALESCE(ts.is_enabled, false), COALESCE(ts.is_verified, false),
           COALESCE(array_length(ts.backup_codes, 1), 0), ts.last_used_at
    FROM totp_secrets ts WHERE ts.email = p_email;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, false, 0, NULL::TIMESTAMP WITH TIME ZONE;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- =============================================
-- CONTRACT RENEWAL FUNCTIONS
-- =============================================
-- =============================================
-- CLEANUP FUNCTIONS
-- =============================================
-- =============================================
-- =============================================
-- Reusable Function to Apply Handle Times Triggers
-- =============================================
CREATE OR REPLACE FUNCTION handle_times_triggers()
RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
    t RECORD;
    updated_tables text[] := '{}';
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND column_name = 'updated_at'
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS handle_times_%1$I ON %1$I;
            CREATE TRIGGER handle_times_%1$I 
                BEFORE INSERT OR UPDATE ON %1$I 
                FOR EACH ROW 
                EXECUTE FUNCTION handle_times();
        ', t.table_name);
        
        updated_tables := array_append(updated_tables, t.table_name::text);
    END LOOP;
    
    RETURN updated_tables;
END;
$$;

CREATE OR REPLACE FUNCTION has_renewal_contract(check_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM tokens t
        INNER JOIN contracts c ON (t.metadata->>'contract_id')::uuid = c.id
        WHERE c.tenant_id = check_tenant_id
          AND t.type = 'contract_renewal'
          AND (t.metadata->>'expires_at')::timestamptz > CURRENT_TIMESTAMP
          AND (t.metadata->>'used_at') IS NULL
          AND c.status IN ('active', 'expiring_soon')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update TOTP secrets timestamp
CREATE OR REPLACE FUNCTION update_totp_secrets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- =============================================
-- STORAGE MIGRATION
-- Purpose: Setup storage buckets and security policies
-- =============================================
-- =============================================
-- 1. CLEANUP EXISTING OBJECTS AND POLICIES
-- =============================================
-- HELPER FUNCTION: Drop all storage policies
CREATE OR REPLACE FUNCTION drop_storage_policies()
RETURNS void AS $$
DECLARE
    _policy record;
BEGIN
    FOR _policy IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'storage'
        AND tablename = 'objects'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects;', _policy.policyname);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 2. DEFINE POLICIES

-- HELPER FUNCTION: Create standard storage policies for a bucket
CREATE OR REPLACE FUNCTION create_storage_policies(bucket_name text)
RETURNS void AS $$
BEGIN
    IF bucket_name = 'public-assets' THEN
        EXECUTE 'CREATE POLICY "Admin upload to public-assets" ON storage.objects 
            FOR INSERT TO authenticated 
            WITH CHECK (bucket_id = ''public-assets'');';
        EXECUTE 'CREATE POLICY "Admin delete from public-assets" ON storage.objects 
            FOR DELETE TO authenticated 
            USING (bucket_id = ''public-assets'');';
        EXECUTE 'CREATE POLICY "Admin update to public-assets" ON storage.objects 
            FOR UPDATE TO authenticated 
            USING (bucket_id = ''public-assets'');';
    ELSIF bucket_name = 'private-assets' THEN
        EXECUTE 'CREATE POLICY "Admin access to private-assets" ON storage.objects 
            FOR SELECT TO authenticated 
            USING (bucket_id = ''private-assets'');';
        EXECUTE 'CREATE POLICY "Public upload to private booking-documents" ON storage.objects 
            FOR INSERT TO anon, authenticated 
            WITH CHECK (
                bucket_id = ''private-assets'' 
                AND (
                    position(''bookings/'' in name) = 1 
                    OR position(''booking-documents/'' in name) = 1
                )
            );';
        EXECUTE 'CREATE POLICY "Admin manage private-assets" ON storage.objects 
            FOR ALL TO authenticated 
            USING (bucket_id = ''private-assets'') 
            WITH CHECK (bucket_id = ''private-assets'');';
    END IF;
END;
$$ LANGUAGE plpgsql;
-- =============================================
-- HELPER FUNCTION: Validate Cron Schedule
-- =============================================
CREATE OR REPLACE FUNCTION cron_management.validate_cron_schedule(schedule TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF schedule IS NULL OR btrim(schedule) = '' THEN
        RETURN FALSE;
    END IF;

    -- Allow interval formats (e.g., '3 hours', '30 minutes', '45 seconds')
    IF schedule ~* '^\s*\d+\s+(second|seconds|minute|minutes|hour|hours|day|days)\s*$' THEN
        RETURN TRUE;
    END IF;

    -- Allow standard cron format (5 fields separated by spaces)
    IF schedule ~ '^(\*|[0-9,\-\*/]+)\s+(\*|[0-9,\-\*/]+)\s+(\*|[0-9,\-\*/]+)\s+(\*|[0-9,\-\*/]+)\s+(\*|[0-9,\-\*/]+)$' THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;
-- =============================================
-- FUNCTION: Create/Schedule a Cron Job
-- =============================================
CREATE OR REPLACE FUNCTION cron_management.create_cron_job(
    p_job_name TEXT,
    p_schedule TEXT,
    p_command TEXT,
    p_database TEXT DEFAULT 'postgres',
    p_username TEXT DEFAULT 'postgres'
)
RETURNS JSONB AS $$
DECLARE
    v_job_id BIGINT;
    v_result JSONB;
BEGIN
    -- Validate inputs
    IF p_job_name IS NULL OR btrim(p_job_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Job name is required');
    END IF;

    IF NOT cron_management.validate_cron_schedule(p_schedule) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid cron schedule format. Use standard cron format (e.g., ''0 */3 * * *'') or interval format (e.g., ''3 hours'')'
        );
    END IF;

    IF p_command IS NULL OR btrim(p_command) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Command is required');
    END IF;

    -- Check if job with same name already exists
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = p_job_name) THEN
        RETURN jsonb_build_object('success', false, 'error', 'A job with this name already exists. Use update_cron_job or remove it first.');
    END IF;

    -- Create the cron job
    BEGIN
        -- Use schema-qualified function in case of non-default search_path
        SELECT cron.schedule(p_job_name, p_schedule, p_command) INTO v_job_id;

        v_result := jsonb_build_object(
            'success', true,
            'job_id', v_job_id,
            'job_name', p_job_name,
            'schedule', p_schedule,
            'command', p_command,
            'message', 'Cron job created successfully'
        );

        RETURN v_result;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- =============================================
-- FUNCTION: List All Cron Jobs
-- =============================================
CREATE OR REPLACE FUNCTION cron_management.list_cron_jobs()
RETURNS TABLE(
    job_id BIGINT,
    job_name TEXT,
    schedule TEXT,
    command TEXT,
    nodename TEXT,
    nodeport INTEGER,
    database TEXT,
    username TEXT,
    active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        j.jobid,
        j.jobname,
        j.schedule,
        j.command,
        j.nodename,
        j.nodeport,
        j.database,
        j.username,
        j.active
    FROM cron.job j
    ORDER BY j.jobid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- =============================================
-- FUNCTION: Get Cron Job Details
-- =============================================
CREATE OR REPLACE FUNCTION cron_management.get_cron_job(p_job_name TEXT)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'job_id', j.jobid,
        'job_name', j.jobname,
        'schedule', j.schedule,
        'command', j.command,
        'database', j.database,
        'username', j.username,
        'active', j.active,
        'nodename', j.nodename,
        'nodeport', j.nodeport
    ) INTO v_result
    FROM cron.job j
    WHERE j.jobname = p_job_name
    LIMIT 1;

    IF v_result IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Job not found');
    END IF;

    RETURN jsonb_build_object('success', true, 'job', v_result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- =============================================
-- FUNCTION: Remove/Delete a Cron Job
-- =============================================
CREATE OR REPLACE FUNCTION cron_management.remove_cron_job(p_job_name TEXT)
RETURNS JSONB AS $$
DECLARE
    v_job_exists BOOLEAN;
BEGIN
    -- Check if job exists
    SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = p_job_name) INTO v_job_exists;

    IF NOT v_job_exists THEN
        RETURN jsonb_build_object('success', false, 'error', 'Job not found');
    END IF;

    -- Remove the job
    BEGIN
        PERFORM cron.unschedule(p_job_name);

        RETURN jsonb_build_object('success', true, 'message', 'Cron job removed successfully', 'job_name', p_job_name);
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- =============================================
-- FUNCTION: Update Cron Job Schedule
-- =============================================
CREATE OR REPLACE FUNCTION cron_management.update_cron_job(
    p_job_name TEXT,
    p_new_schedule TEXT DEFAULT NULL,
    p_new_command TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_current_schedule TEXT;
    v_current_command TEXT;
    v_job_id BIGINT;
BEGIN
    -- Get current job details; handle case where job doesn't exist
    SELECT schedule, command INTO v_current_schedule, v_current_command
    FROM cron.job
    WHERE jobname = p_job_name
    LIMIT 1;

    IF v_current_schedule IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Job not found');
    END IF;

    -- Use current values if new ones not provided
    IF p_new_schedule IS NULL THEN
        p_new_schedule := v_current_schedule;
    END IF;

    IF p_new_command IS NULL THEN
        p_new_command := v_current_command;
    END IF;

    -- Validate new schedule
    IF NOT cron_management.validate_cron_schedule(p_new_schedule) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid cron schedule format');
    END IF;

    -- Remove old job and create new one with updated values
    BEGIN
        PERFORM cron.unschedule(p_job_name);

        SELECT cron.schedule(p_job_name, p_new_schedule, p_new_command) INTO v_job_id;

        RETURN jsonb_build_object(
            'success', true,
            'job_id', v_job_id,
            'job_name', p_job_name,
            'schedule', p_new_schedule,
            'command', p_new_command,
            'message', 'Cron job updated successfully'
        );
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- =============================================
-- FUNCTION: Create Job with Supabase URL Context
-- =============================================
-- This function creates a cron job that can use the Supabase URL
-- for making HTTP requests to edge functions or webhooks (requires pg_net or similar HTTP extension)
CREATE OR REPLACE FUNCTION cron_management.create_scheduled_job_with_url(
    p_job_name TEXT,
    p_schedule TEXT,
    p_function_name TEXT,
    p_supabase_url TEXT,
    p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
    v_command TEXT;
    v_result JSONB;
    v_service_key TEXT;
    v_body_text TEXT;
    v_url TEXT;
    v_headers_json TEXT;
BEGIN
    IF p_supabase_url IS NULL OR btrim(p_supabase_url) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Supabase URL is required');
    END IF;

    IF p_function_name IS NULL OR btrim(p_function_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Function name is required');
    END IF;

    -- Try to get a service role key from a setting; if not present, leave header without Bearer
    BEGIN
        v_service_key := current_setting('app.settings.service_role_key', true);
    EXCEPTION WHEN OTHERS THEN
        v_service_key := NULL;
    END;

    -- Build URL (avoid double slash)
    v_url := rtrim(p_supabase_url, '/') || '/functions/v1/' || p_function_name;

    -- Build headers JSON; include Authorization only if key present
    IF v_service_key IS NOT NULL THEN
        v_headers_json := format('{"Content-Type":"application/json","Authorization":"Bearer %s"}', v_service_key);
    ELSE
        v_headers_json := '{"Content-Type":"application/json"}';
    END IF;

    -- Build the command to call a Supabase Edge Function using pg_net (net.http_post)
    -- Note: adjust if your environment uses pg_http or another extension
    -- format() with %L safely escapes strings for SQL literals
    v_command := format(
        'SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
        v_url,
        v_headers_json,
        p_payload::text
    );

    -- Create the cron job using existing create_cron_job helper
    v_result := cron_management.create_cron_job(p_job_name := p_job_name, p_schedule := p_schedule, p_command := v_command);

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- =============================================
-- FUNCTION: Get Cron Job Run History
-- =============================================
CREATE OR REPLACE FUNCTION cron_management.get_cron_job_history(
    p_job_name TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE(
    job_id BIGINT,
    run_id BIGINT,
    job_name TEXT,
    database TEXT,
    username TEXT,
    command TEXT,
    status TEXT,
    return_message TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        jrd.jobid,
        jrd.runid,
        j.jobname,
        jrd.database,
        jrd.username,
        jrd.command,
        jrd.status,
        jrd.return_message,
        jrd.start_time,
        jrd.end_time
    FROM cron.job_run_details jrd
    LEFT JOIN cron.job j ON jrd.jobid = j.jobid
    WHERE p_job_name IS NULL OR j.jobname = p_job_name
    ORDER BY jrd.start_time DESC
    LIMIT GREATEST(1, COALESCE(p_limit, 100));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- =============================================
-- PUBLIC SCHEMA WRAPPERS
-- =============================================
-- These functions call the schema-qualified versions for easier access
CREATE OR REPLACE FUNCTION create_cron_job(
    p_job_name TEXT,
    p_schedule TEXT,
    p_command TEXT,
    p_database TEXT DEFAULT 'postgres',
    p_username TEXT DEFAULT 'postgres'
)
RETURNS JSONB AS $$
BEGIN
    RETURN cron_management.create_cron_job(p_job_name, p_schedule, p_command, p_database, p_username);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION list_cron_jobs()
RETURNS TABLE(
    job_id BIGINT,
    job_name TEXT,
    schedule TEXT,
    command TEXT,
    nodename TEXT,
    nodeport INTEGER,
    database TEXT,
    username TEXT,
    active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY SELECT * FROM cron_management.list_cron_jobs();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_cron_job(p_job_name TEXT)
RETURNS JSONB AS $$
BEGIN
    RETURN cron_management.get_cron_job(p_job_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION remove_cron_job(p_job_name TEXT)
RETURNS JSONB AS $$
BEGIN
    RETURN cron_management.remove_cron_job(p_job_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_cron_job(
    p_job_name TEXT,
    p_new_schedule TEXT DEFAULT NULL,
    p_new_command TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
    RETURN cron_management.update_cron_job(p_job_name, p_new_schedule, p_new_command);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_scheduled_job_with_url(
    p_job_name TEXT,
    p_schedule TEXT,
    p_function_name TEXT,
    p_supabase_url TEXT,
    p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
BEGIN
    RETURN cron_management.create_scheduled_job_with_url(p_job_name, p_schedule, p_function_name, p_supabase_url, p_payload);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_cron_job_history(
    p_job_name TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE(
    job_id BIGINT,
    run_id BIGINT,
    job_name TEXT,
    database TEXT,
    username TEXT,
    command TEXT,
    status TEXT,
    return_message TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY SELECT * FROM cron_management.get_cron_job_history(p_job_name, p_limit);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a wrapper function to enqueue unified messages
CREATE OR REPLACE FUNCTION enqueue_bulk_message(payload JSONB, delay_seconds INTEGER DEFAULT 0)
RETURNS BIGINT AS $$
DECLARE
  msg_id BIGINT;
BEGIN
  IF delay_seconds > 0 THEN
    SELECT * INTO msg_id FROM pgmq.send('bulk_messages', payload, delay_seconds);
  ELSE
    SELECT * INTO msg_id FROM pgmq.send('bulk_messages', payload);
  END IF;
  RETURN msg_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update get_pending_queue_jobs to only query bulk_messages
CREATE OR REPLACE FUNCTION get_pending_queue_jobs(queue_name text, limit_count int DEFAULT 50)
RETURNS TABLE (
    msg_id bigint,
    enqueued_at timestamp with time zone,
    vt timestamp with time zone,
    message jsonb
)
SECURITY DEFINER
AS $$
BEGIN
    IF queue_name = 'bulk_messages' THEN
        RETURN QUERY SELECT q.msg_id, q.enqueued_at, q.vt, q.message
        FROM pgmq.q_bulk_messages q
        ORDER BY q.msg_id DESC
        LIMIT limit_count;
    ELSE
        RETURN QUERY SELECT NULL::bigint, NULL::timestamp with time zone, NULL::timestamp with time zone, NULL::jsonb LIMIT 0;
    END IF;
END;
$$ LANGUAGE plpgsql;
-- =============================================
-- BATCH ENQUEUE FUNCTION
-- =============================================
-- Create a generic batch enqueue function
CREATE OR REPLACE FUNCTION enqueue_batch_items(queue_name TEXT, payloads JSONB[], delay_seconds INTEGER DEFAULT 0)
RETURNS SETOF BIGINT AS $$
BEGIN
  IF delay_seconds > 0 THEN
    RETURN QUERY SELECT * FROM pgmq.send_batch(queue_name, payloads, delay_seconds);
  ELSE
    RETURN QUERY SELECT * FROM pgmq.send_batch(queue_name, payloads);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to manage queue jobs (archive or process now)
CREATE OR REPLACE FUNCTION manage_queue_job(queue_name text, message_id bigint, action_type text)
RETURNS boolean AS $$
DECLARE
  success boolean := false;
  msg_record record;
BEGIN
  IF action_type = 'archive' THEN
    SELECT pgmq.archive(queue_name, message_id) INTO success;
  ELSIF action_type = 'process_now' THEN
    EXECUTE format('UPDATE pgmq.q_%I SET vt = clock_timestamp() WHERE msg_id = $1 RETURNING msg_id', queue_name)
    USING message_id
    INTO msg_record;
    success := FOUND;
  END IF;
  
  RETURN success;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION manage_queue_job(text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION manage_queue_job(text, bigint, text) TO service_role;

-- Function to check if a booking exists by email/phone
CREATE OR REPLACE FUNCTION check_booking_existence(
    p_email TEXT, 
    p_phone TEXT DEFAULT NULL,
    p_business_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_booking RECORD;
    v_tenant_data JSONB;
    v_latest_contract JSONB;
    v_receipts JSONB;
    v_business JSONB;
BEGIN
    -- 1. Fetch the booking
    -- Search by email if provided, otherwise by phone
    SELECT 
        b.id, b.name, b.email, b.phone, b.status, b.business_id, b.property_id, b.house_id, b.converted_tenant_id, b.user_id
    INTO v_booking
    FROM bookings b
    WHERE (
        (p_email IS NOT NULL AND b.email = LOWER(TRIM(p_email)))
        OR
        (p_email IS NULL AND p_phone IS NOT NULL AND b.phone IS NOT NULL AND regexp_replace(b.phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g'))
      )
      AND (p_business_id IS NULL OR b.business_id = p_business_id)
      AND b.deleted = false 
    ORDER BY b.created_at DESC
    LIMIT 1;

    IF v_booking.id IS NULL THEN
        RETURN jsonb_build_object('exists', false);
    END IF;

    -- 2. Verify phone if BOTH were provided
    IF p_email IS NOT NULL AND p_phone IS NOT NULL THEN
        -- Basic numeric comparison, handle NULL phone in record
        IF v_booking.phone IS NULL OR regexp_replace(v_booking.phone, '\D', '', 'g') != regexp_replace(p_phone, '\D', '', 'g') THEN
             RETURN jsonb_build_object('exists', false, 'message', 'Invalid credentials');
        END IF;
    END IF;

    -- 3. Fetch linked data if tenant exists
    IF v_booking.converted_tenant_id IS NOT NULL THEN
        -- Fetch tenant basic info
        SELECT jsonb_build_object(
            'id', t.id,
            'name', t.name,
            'email', t.email,
            'phone', t.phone,
            'status', t.status,
            'created_at', t.created_at
        ) INTO v_tenant_data
        FROM tenants t
        WHERE t.id = v_booking.converted_tenant_id;

        -- Fetch latest contract
        SELECT jsonb_build_object(
            'id', c.id,
            'start_date', c.start_date,
            'end_date', c.end_date,
            'rent_amount', c.rent_amount,
            'status', c.status,
            'house', jsonb_build_object(
                'house_number', h.house_number,
                'property_name', p.name
            )
        ) INTO v_latest_contract
        FROM contracts c
        LEFT JOIN houses h ON c.house_id = h.id
        LEFT JOIN properties p ON h.property_id = p.id
        WHERE c.tenant_id = v_booking.converted_tenant_id
          AND c.deleted = false
        ORDER BY c.created_at DESC
        LIMIT 1;

        -- Fetch all receipts
        SELECT jsonb_agg(r_data) INTO v_receipts
        FROM (
            SELECT 
                r.id,
                r.amount,
                r.payment_date,
                r.payment_method,
                r.status,
                r.type,
                r.payment_period,
                r.notes,
                r.is_refunded,
                r.refunded_amount
            FROM receipts r
            WHERE r.tenant_id = v_booking.converted_tenant_id
              AND r.deleted = false
              AND r.is_refunded = false
              AND r.status NOT IN ('promo', 'waiver')
            ORDER BY r.payment_date DESC
        ) r_data;
    END IF;

    -- Fetch business information
    SELECT jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'email', b.email,
        'phone', b.phone,
        'address', b.address
    ) INTO v_business
    FROM businesses b
    WHERE b.id = v_booking.business_id;

    -- 4. Return combined result
    RETURN jsonb_build_object(
        'exists', true,
        'businesses', v_business,
        'booking', jsonb_build_object(
            'id', v_booking.id,
            'name', v_booking.name,
            'email', v_booking.email,
            'phone', v_booking.phone,
            'status', v_booking.status,
            'business_id', v_booking.business_id,
            'property_id', v_booking.property_id,
            'house_id', v_booking.house_id,
            'tenant_id', v_booking.converted_tenant_id,
            'user_id', v_booking.user_id,
            'tenant', v_tenant_data,
            'latest_contract', v_latest_contract,
            'receipts', COALESCE(v_receipts, '[]'::jsonb)
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to submit/upsert a booking request
-- Uses SECURITY DEFINER to bypass RLS for public submissions
CREATE OR REPLACE FUNCTION submit_booking_request(
    p_name TEXT,
    p_phone TEXT,
    p_email TEXT,
    p_gender TEXT DEFAULT NULL,
    p_marital_status TEXT DEFAULT NULL,
    p_nationality TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_next_of_kin JSONB DEFAULT '{}'::jsonb,
    p_business_id UUID DEFAULT NULL,
    p_property_id UUID DEFAULT NULL,
    p_house_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_booking_id UUID;
    v_email TEXT := LOWER(TRIM(p_email));
BEGIN
    -- Basic validation
    IF p_name IS NULL OR p_name = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Name is required');
    END IF;

    IF p_email IS NULL OR p_email = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Email is required');
    END IF;

    -- Find existing booking by email or phone to handle multi-column uniqueness
    SELECT id INTO v_booking_id
    FROM public.bookings
    WHERE (
        (email IS NOT NULL AND email = v_email)
        OR
        (phone IS NOT NULL AND p_phone IS NOT NULL AND regexp_replace(phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g'))
      )
      AND business_id = p_business_id
      AND deleted = false
    ORDER BY (email = v_email) DESC -- Prioritize email match if both match different records
    LIMIT 1;

    IF v_booking_id IS NOT NULL THEN
        -- Update existing
        UPDATE public.bookings SET
            name = p_name,
            phone = p_phone,
            gender = p_gender,
            marital_status = p_marital_status,
            nationality = p_nationality,
            address = p_address,
            next_of_kin = p_next_of_kin,
            property_id = p_property_id,
            house_id = p_house_id,
            status = 'pending', -- Reset to pending on re-submission
            deleted = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_booking_id;
    ELSE
        -- Insert new
        INSERT INTO public.bookings (
            name, phone, email, gender, marital_status, nationality, 
            address, next_of_kin, business_id, property_id, house_id,
            status, deleted
        )
        VALUES (
            p_name, p_phone, v_email, p_gender, p_marital_status, p_nationality, 
            p_address, p_next_of_kin, p_business_id, p_property_id, p_house_id,
            'pending', false
        )
        RETURNING id INTO v_booking_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true, 
        'message', 'Booking request submitted successfully',
        'id', v_booking_id
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false, 
        'error', SQLERRM,
        'details', SQLSTATE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to generate a new API key
CREATE OR REPLACE FUNCTION generate_api_key(
    p_business_id UUID,
    p_name TEXT,
    p_scopes JSONB DEFAULT '[]'::jsonb,
    p_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_raw_key TEXT;
    v_key_part TEXT;
    v_hash TEXT;
    v_encrypted TEXT;
    v_id UUID;
    v_encryption_key TEXT := 'pa_internal_vault_key'; -- In production, use Supabase Vault
BEGIN
    -- Verify the caller has access to the business
    IF NOT check_business_access(p_business_id) THEN
        RAISE EXCEPTION 'Unauthorized: You do not have access to this business.';
    END IF;

    -- Generate 16 bytes of random data and hex encode it (32 characters)
    v_key_part := encode(extensions.gen_random_bytes(16), 'hex');
    v_raw_key := v_key_part;
    
    -- Hash for fast verification
    v_hash := crypt(v_raw_key, gen_salt('bf'));

    -- Encrypt for later retrieval (revealing)
    v_encrypted := encode(extensions.encrypt(v_raw_key::bytea, v_encryption_key::bytea, 'aes'), 'hex');

    INSERT INTO public.api_keys (
        business_id,
        name,
        key_prefix,
        key_hash,
        encrypted_key,
        scopes,
        expires_at
    )
    VALUES (
        p_business_id,
        p_name,
        left(v_raw_key, 4) || '...',
        v_hash,
        v_encrypted,
        p_scopes,
        p_expires_at
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'id', v_id,
        'name', p_name,
        'api_key', v_raw_key
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to reveal an API key
CREATE OR REPLACE FUNCTION reveal_api_key(p_key_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_encrypted TEXT;
    v_business_id UUID;
    v_decrypted BYTEA;
    v_encryption_key TEXT := 'pa_internal_vault_key';
BEGIN
    SELECT encrypted_key, business_id INTO v_encrypted, v_business_id
    FROM api_keys
    WHERE id = p_key_id AND deleted = false;

    IF v_encrypted IS NULL THEN
        RETURN NULL;
    END IF;

    -- Verify the caller has access to the business
    IF NOT check_business_access(v_business_id) THEN
        RAISE EXCEPTION 'Unauthorized: You do not have access to this business.';
    END IF;

    v_decrypted := extensions.decrypt(decode(v_encrypted, 'hex'), v_encryption_key::bytea, 'aes');
    RETURN convert_from(v_decrypted, 'utf8');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Optimized verification function
CREATE OR REPLACE FUNCTION verify_api_key(p_api_key TEXT)
RETURNS JSONB AS $$
DECLARE
    v_search_prefix TEXT;
    v_key_record RECORD;
BEGIN
    -- Extract the first 4 chars + ... as stored in key_prefix
    v_search_prefix := left(p_api_key, 4) || '...'; 

    -- Fast Indexed Lookup
    SELECT id, business_id, key_hash, scopes, expires_at 
    INTO v_key_record
    FROM api_keys 
    WHERE key_prefix = v_search_prefix
      AND deleted = false 
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    LIMIT 1;

    -- Validation
    IF v_key_record.id IS NOT NULL THEN
        -- Verify bcrypt hash
        IF v_key_record.key_hash = crypt(p_api_key, v_key_record.key_hash) THEN
            -- Update last used
            UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = v_key_record.id;
            
            RETURN jsonb_build_object(
                'valid', true,
                'business_id', v_key_record.business_id,
                'scopes', v_key_record.scopes
            );
        END IF;
    END IF;

    RETURN jsonb_build_object('valid', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Refine bulk_restore_data to handle both JSON arrays and stringified JSON arrays
-- This makes the function more resilient to different client-side encoding methods
CREATE OR REPLACE FUNCTION public.bulk_restore_data(
    p_table_name text,
    p_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_row_count integer := 0;
    v_start_time timestamp := clock_timestamp();
    v_columns text;
    v_sql text;
    v_target_data jsonb := p_data;
BEGIN
    -- Bypass RLS
    SET LOCAL row_security = off;
    
    -- Detect if p_data is a stringified JSON array (happens with some client libs)
    IF jsonb_typeof(v_target_data) = 'string' THEN
        BEGIN
            v_target_data := (v_target_data#>>'{}')::jsonb;
        EXCEPTION WHEN OTHERS THEN
            -- If it's not valid JSON, keep it as is (might just be a string column value, 
            -- though here we expect an array)
        END;
    END IF;

    -- Ensure we have an array for jsonb_populate_recordset
    IF jsonb_typeof(v_target_data) != 'array' THEN
        RETURN jsonb_build_object(
            'success', false,
            'table', p_table_name,
            'error', format('Input data must be a JSON array, got %s', jsonb_typeof(v_target_data)),
            'detail', v_target_data
        );
    END IF;

    -- Get columns for the table
    SELECT string_agg(quote_ident(column_name), ', ')
    INTO v_columns
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND table_name = p_table_name;
      
    IF v_columns IS NULL THEN
        RAISE EXCEPTION 'Table % not found', p_table_name;
    END IF;

    -- Construct and execute the dynamic insert
    v_sql := format(
        'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1) ON CONFLICT DO NOTHING',
        p_table_name, v_columns, v_columns, p_table_name
    );
    
    EXECUTE v_sql USING v_target_data;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    
    RETURN jsonb_build_object(
        'success', true,
        'table', p_table_name,
        'count', v_row_count,
        'duration_ms', floor(extract(epoch from (clock_timestamp() - v_start_time)) * 1000)
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'table', p_table_name,
        'error', SQLERRM,
        'detail', SQLSTATE
    );
END;
$$;
-- =============================================
-- TRIGGERS
-- =============================================
-- Create trigger to automatically create default settings when a business is created
CREATE TRIGGER create_default_settings_trigger
    AFTER INSERT ON businesses
    FOR EACH ROW
    EXECUTE FUNCTION trigger_create_default_business_settings();

-- Trigger to enforce single active contract per house
CREATE TRIGGER trigger_check_single_active_contract_per_house
  BEFORE INSERT OR UPDATE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION check_single_active_contract_per_house();

-- Property Deletion Trigger
CREATE TRIGGER before_property_delete
    BEFORE DELETE ON properties
    FOR EACH ROW
    EXECUTE FUNCTION handle_property_deletion();

-- Auth User Change Trigger
CREATE TRIGGER on_auth_user_changed
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_auth_user();

CREATE TRIGGER update_totp_secrets_updated_at
    BEFORE UPDATE ON totp_secrets
    FOR EACH ROW
    EXECUTE FUNCTION update_totp_secrets_updated_at();

-- =============================================
-- BLACKLIST ENFORCEMENT & TRIGGERS
-- =============================================

-- 1. Security Definer function to ban/unban users via auth.users
CREATE OR REPLACE FUNCTION public.set_user_ban_status(target_user_id UUID, is_banned BOOLEAN)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE auth.users 
    SET banned_until = CASE WHEN is_banned THEN CURRENT_TIMESTAMP + INTERVAL '100 years' ELSE NULL END
    WHERE id = target_user_id;
END;
$$;

-- 2. Trigger function for tenants table to enforce ban on status change
CREATE OR REPLACE FUNCTION public.handle_tenant_blacklist_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.user_id IS NOT NULL THEN
        IF NEW.status = 'blacklisted' THEN
            PERFORM public.set_user_ban_status(NEW.user_id, true);
        ELSE
            PERFORM public.set_user_ban_status(NEW.user_id, false);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 3. Create Triggers on tenants table (optimized with WHEN clause)
DROP TRIGGER IF EXISTS tr_tenant_blacklist_status_insert ON public.tenants;
CREATE TRIGGER tr_tenant_blacklist_status_insert
AFTER INSERT ON public.tenants
FOR EACH ROW
WHEN (NEW.status = 'blacklisted')
EXECUTE FUNCTION public.handle_tenant_blacklist_status();

DROP TRIGGER IF EXISTS tr_tenant_blacklist_status_update ON public.tenants;
CREATE TRIGGER tr_tenant_blacklist_status_update
AFTER UPDATE OF status ON public.tenants
FOR EACH ROW
WHEN (NEW.status = 'blacklisted' OR OLD.status = 'blacklisted')
EXECUTE FUNCTION public.handle_tenant_blacklist_status();

-- 4. Trigger function to prevent insertion if blacklisted
CREATE OR REPLACE FUNCTION public.prevent_blacklisted_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Check if there's any tenant with the same email or phone that is blacklisted
    IF EXISTS (
        SELECT 1 FROM public.tenants
        WHERE status = 'blacklisted'
        AND (
            (NEW.email IS NOT NULL AND email = NEW.email) OR
            (NEW.phone IS NOT NULL AND phone = NEW.phone)
        )
    ) THEN
        RAISE EXCEPTION 'Creation rejected: User is blacklisted.';
    END IF;

    RETURN NEW;
END;
$$;

-- 5. Create Trigger on bookings table (optimized with WHEN clause)
DROP TRIGGER IF EXISTS tr_prevent_blacklisted_booking ON public.bookings;
CREATE TRIGGER tr_prevent_blacklisted_booking
BEFORE INSERT ON public.bookings
FOR EACH ROW
WHEN (NEW.email IS NOT NULL OR NEW.phone IS NOT NULL)
EXECUTE FUNCTION public.prevent_blacklisted_creation();

-- 6. Create Trigger on tenants table (optimized with WHEN clause)
DROP TRIGGER IF EXISTS tr_prevent_blacklisted_tenant ON public.tenants;
CREATE TRIGGER tr_prevent_blacklisted_tenant
BEFORE INSERT ON public.tenants
FOR EACH ROW
WHEN (NEW.email IS NOT NULL OR NEW.phone IS NOT NULL)
EXECUTE FUNCTION public.prevent_blacklisted_creation();

-- 7. Trigger function to prevent auth.users creation if email is blacklisted in tenants
CREATE OR REPLACE FUNCTION public.prevent_blacklisted_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.tenants
        WHERE status = 'blacklisted'
        AND email = NEW.email
    ) THEN
        RAISE EXCEPTION 'User creation rejected: Email is blacklisted.';
    END IF;

    RETURN NEW;
END;
$$;

-- 8. Create the trigger on auth.users
DROP TRIGGER IF EXISTS tr_prevent_blacklisted_auth_user ON auth.users;
CREATE TRIGGER tr_prevent_blacklisted_auth_user
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.prevent_blacklisted_auth_user();

-- 9. RPC function to check blacklist status bypassing RLS
CREATE OR REPLACE FUNCTION public.is_email_blacklisted(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.tenants
        WHERE status = 'blacklisted'
        AND email ILIKE p_email
        AND (deleted IS NULL OR deleted = false)
    );
END;
$$;

-- =============================================
-- INDEXES
-- =============================================

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_business ON public.audit_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);

CREATE INDEX IF NOT EXISTS idx_tokens_contract_renewal ON tokens(((metadata->>'contract_id')::uuid), type) WHERE type = 'contract_renewal' AND (metadata->>'used_at') IS NULL AND deleted = false;
CREATE INDEX IF NOT EXISTS idx_api_keys_business_id ON api_keys(business_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_transactions_business_id ON public.transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_provider_reference ON public.transactions(provider_reference);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_id ON public.transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_contract_id ON public.transactions(contract_id);


CREATE INDEX IF NOT EXISTS idx_message_templates_business_id ON message_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_name ON message_templates(name);

-- Businesses indexes
CREATE INDEX IF NOT EXISTS idx_businesses_is_system ON businesses(is_system);
CREATE INDEX IF NOT EXISTS idx_businesses_user_id ON businesses(user_id);

-- Properties indexes
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_business_id ON properties(business_id);

-- Houses indexes
CREATE INDEX IF NOT EXISTS idx_houses_status ON houses(status);
CREATE INDEX IF NOT EXISTS idx_houses_property ON houses(property_id);
CREATE INDEX IF NOT EXISTS idx_houses_business_id ON houses(business_id);

-- Tenants indexes
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_business_id ON tenants(business_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_business_email ON tenants (business_id, email) WHERE deleted = false AND email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_business_phone ON tenants (business_id, phone) WHERE deleted = false AND phone IS NOT NULL;

-- Contracts indexes
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_dates ON contracts(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_contracts_house_id ON contracts(house_id);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_id ON contracts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contracts_business_id ON contracts(business_id);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_status ON contracts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_business_status ON contracts(tenant_id, business_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_house_status ON contracts(house_id, status);

-- Unique partial index to enforce one active contract per house
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_contract_per_house 
  ON contracts(house_id) 
  WHERE status = 'active' AND deleted = false;

-- Receipts indexes
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(payment_date);
CREATE INDEX IF NOT EXISTS idx_receipts_tenant ON receipts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_receipts_contract ON receipts(contract_id);
CREATE INDEX IF NOT EXISTS idx_receipts_business_id ON receipts(business_id);
CREATE INDEX IF NOT EXISTS idx_receipts_type ON receipts(type);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(status);
CREATE INDEX IF NOT EXISTS idx_receipts_payment_period ON receipts USING gin(payment_period);

-- Payment Messages indexes
CREATE INDEX IF NOT EXISTS idx_payment_messages_business_id ON payment_messages(business_id);
CREATE INDEX IF NOT EXISTS idx_payment_messages_user_id ON payment_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_messages_transaction_date ON payment_messages(transaction_date);

-- Payment Message Receipts Junction Table indexes
CREATE INDEX IF NOT EXISTS idx_payment_message_receipts_payment_message_id ON payment_message_receipts(payment_message_id);
CREATE INDEX IF NOT EXISTS idx_payment_message_receipts_receipt_id ON payment_message_receipts(receipt_id);
CREATE INDEX IF NOT EXISTS idx_payment_message_receipts_created_at ON payment_message_receipts(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_message_receipts_business_id ON payment_message_receipts(business_id);
CREATE INDEX IF NOT EXISTS idx_payment_message_receipts_user_id ON payment_message_receipts(user_id);

-- Receipt Refunds indexes
CREATE INDEX IF NOT EXISTS idx_receipt_refunds_receipt_id ON receipt_refunds(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_refunds_business_id ON receipt_refunds(business_id);
CREATE INDEX IF NOT EXISTS idx_receipt_refunds_created_at ON receipt_refunds(created_at);

-- Settings indexes
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(setting_key);
CREATE INDEX IF NOT EXISTS idx_settings_value ON settings USING gin(setting_value);
CREATE INDEX IF NOT EXISTS idx_settings_business_id ON settings(business_id);

-- Business shares indexes
CREATE INDEX IF NOT EXISTS idx_business_shares_business_id ON business_shares(business_id);
CREATE INDEX IF NOT EXISTS idx_business_shares_shared_with ON business_shares(shared_with);
CREATE INDEX IF NOT EXISTS idx_business_shares_status ON business_shares(status);

-- Expenses indexes
CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON expenses(business_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

-- Maintenance Requests indexes
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_property_id ON maintenance_requests(property_id);

-- Promotions indexes
CREATE INDEX IF NOT EXISTS idx_promotions_business_id ON promotions(business_id);
CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(code);
CREATE INDEX IF NOT EXISTS idx_promotions_property_id ON promotions(property_id);
CREATE INDEX IF NOT EXISTS idx_promotions_tenant_id ON promotions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_receipts_promotion_id ON receipts(promotion_id);

-- Tokens indexes
CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_tokens_type ON tokens(type);
CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token);
CREATE INDEX IF NOT EXISTS idx_tokens_business_id ON tokens(business_id);

-- Profiles indexes
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

-- Reminder logs indexes
CREATE INDEX IF NOT EXISTS idx_reminder_logs_business_id ON reminder_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_tenant_id ON reminder_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_contract_id ON reminder_logs(contract_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_type ON reminder_logs(reminder_type);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_sent_at ON reminder_logs(sent_at);

-- Schedules indexes
CREATE INDEX IF NOT EXISTS idx_schedules_business_id ON schedules(business_id);
CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run);
CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status);
CREATE INDEX IF NOT EXISTS idx_schedules_type ON schedules(schedule_type);
CREATE INDEX IF NOT EXISTS idx_schedules_schedule ON schedules USING GIN (schedule);
CREATE INDEX IF NOT EXISTS idx_schedules_emails ON schedules USING GIN (emails);

-- Backup logs indexes
CREATE INDEX IF NOT EXISTS idx_backup_logs_business_id ON backup_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_backup_logs_user_id ON backup_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_backup_logs_business_user ON backup_logs(business_id, user_id);
CREATE INDEX IF NOT EXISTS idx_backup_logs_status ON backup_logs(backup_status);

-- Reminder logs indexes
CREATE INDEX IF NOT EXISTS idx_reminder_logs_user_id ON reminder_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_business_user ON reminder_logs(business_id, user_id);
CREATE INDEX IF NOT EXISTS idx_backup_logs_completed_at ON backup_logs(backup_completed_at);
CREATE INDEX IF NOT EXISTS idx_backup_logs_created_at ON backup_logs(created_at);

-- Bookings indexes
CREATE INDEX IF NOT EXISTS idx_bookings_house_id ON bookings(house_id);
CREATE INDEX IF NOT EXISTS idx_bookings_property_id ON bookings(property_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_business_email ON bookings (business_id, email) WHERE deleted = false AND email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_business_phone ON bookings (business_id, phone) WHERE deleted = false AND phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_phone_normalized ON bookings (regexp_replace(phone, '\D', '', 'g'));

-- Security table indexes
CREATE INDEX IF NOT EXISTS idx_totp_secrets_email ON totp_secrets(email);
CREATE INDEX IF NOT EXISTS idx_totp_secrets_enabled ON totp_secrets(email, is_enabled) WHERE is_enabled = true;

-- Contract renewal indexes
CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON contracts(end_date) WHERE status IN ('active', 'expiring_soon');
CREATE INDEX IF NOT EXISTS idx_contracts_reminder_check ON contracts(end_date, status, renewal_reminder_sent_at) WHERE status IN ('active', 'expiring_soon');
-- =============================================
-- INDEXES (After all tables are created)
-- =============================================
-- =============================================
-- UNIVERSAL AUDIT INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_businesses_deleted ON businesses(deleted);
CREATE INDEX IF NOT EXISTS idx_businesses_updated_at ON businesses(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_profiles_deleted ON profiles(deleted);
CREATE INDEX IF NOT EXISTS idx_profiles_updated_at ON profiles(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_business_shares_deleted ON business_shares(deleted);
CREATE INDEX IF NOT EXISTS idx_business_shares_updated_at ON business_shares(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_business_shares_business_updated ON business_shares(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_settings_deleted ON settings(deleted);
CREATE INDEX IF NOT EXISTS idx_settings_updated_at ON settings(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_settings_business_updated ON settings(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_tenants_deleted ON tenants(deleted);
CREATE INDEX IF NOT EXISTS idx_tenants_updated_at ON tenants(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_tenants_business_updated ON tenants(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_expenses_deleted ON expenses(deleted);
CREATE INDEX IF NOT EXISTS idx_expenses_updated_at ON expenses(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_expenses_business_updated ON expenses(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_properties_deleted ON properties(deleted);
CREATE INDEX IF NOT EXISTS idx_properties_updated_at ON properties(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_properties_business_updated ON properties(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_houses_deleted ON houses(deleted);
CREATE INDEX IF NOT EXISTS idx_houses_updated_at ON houses(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_houses_business_updated ON houses(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_contracts_deleted ON contracts(deleted);
CREATE INDEX IF NOT EXISTS idx_contracts_updated_at ON contracts(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_contracts_business_updated ON contracts(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_receipts_deleted ON receipts(deleted);
CREATE INDEX IF NOT EXISTS idx_receipts_updated_at ON receipts(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_receipts_business_updated ON receipts(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_bookings_deleted ON bookings(deleted);
CREATE INDEX IF NOT EXISTS idx_bookings_updated_at ON bookings(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_bookings_business_updated ON bookings(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_payment_messages_deleted ON payment_messages(deleted);
CREATE INDEX IF NOT EXISTS idx_payment_messages_updated_at ON payment_messages(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_payment_messages_business_updated ON payment_messages(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_payment_message_receipts_deleted ON payment_message_receipts(deleted);
CREATE INDEX IF NOT EXISTS idx_payment_message_receipts_updated_at ON payment_message_receipts(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_payment_message_receipts_business_updated ON payment_message_receipts(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_receipt_refunds_deleted ON receipt_refunds(deleted);
CREATE INDEX IF NOT EXISTS idx_receipt_refunds_updated_at ON receipt_refunds(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_receipt_refunds_business_updated ON receipt_refunds(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_tokens_deleted ON tokens(deleted);
CREATE INDEX IF NOT EXISTS idx_tokens_updated_at ON tokens(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_tokens_business_updated ON tokens(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_reminder_logs_deleted ON reminder_logs(deleted);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_updated_at ON reminder_logs(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_reminder_logs_business_updated ON reminder_logs(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_schedules_deleted ON schedules(deleted);
CREATE INDEX IF NOT EXISTS idx_schedules_updated_at ON schedules(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_schedules_business_updated ON schedules(business_id, updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_backup_logs_deleted ON backup_logs(deleted);
CREATE INDEX IF NOT EXISTS idx_backup_logs_updated_at ON backup_logs(updated_at) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_backup_logs_business_updated ON backup_logs(business_id, updated_at) WHERE deleted = FALSE;
-- =============================================
-- ROW LEVEL SECURITY (RLS) POLICIES

-- AUDIT LOG TABLE POLICIES

CREATE POLICY "Users can view audit logs for their businesses"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (check_business_access(business_id));

CREATE POLICY "Service role can insert audit logs"
  ON public.audit_logs FOR INSERT TO service_role
  WITH CHECK (true);


-- =============================================
-- =============================================
-- BUSINESSES TABLE POLICIES
-- =============================================
CREATE POLICY "Public can view non-system businesses for booking requests"
    ON businesses FOR SELECT
    USING (is_system = false);

CREATE POLICY "Users can manage their own non-system businesses"
    ON businesses FOR ALL
    USING (user_id = (SELECT auth.uid()) AND is_system = false)
    WITH CHECK (user_id = (SELECT auth.uid()) AND is_system = false);
-- =============================================
-- BOOKINGS TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business bookings"
    ON bookings FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- GALLERY IMAGES TABLE POLICIES
-- =============================================
CREATE POLICY "Public can view business gallery images"
    ON gallery_images FOR SELECT
    USING (true);

CREATE POLICY "Users can manage business gallery images"
    ON gallery_images FOR ALL
    USING (check_business_access(business_id))
    WITH CHECK (check_business_access(business_id));
-- =============================================
-- PROPERTIES TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business properties"
    ON properties FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- HOUSES TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business houses"
    ON houses FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- TENANTS TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business tenants"
    ON tenants FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- CONTRACTS TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business contracts"
    ON contracts FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- RECEIPTS TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business receipts"
    ON receipts FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- PAYMENT MESSAGES TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business payment messages"
    ON payment_messages FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- PAYMENT MESSAGE RECEIPTS TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business payment message receipts"
    ON payment_message_receipts FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- RECEIPT REFUNDS TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage receipt refunds and those of their businesses"
    ON receipt_refunds FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- SETTINGS TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business settings"
    ON settings FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));

-- =============================================
-- REMINDER LOGS TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business reminder logs"
    ON reminder_logs FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- SCHEDULES TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business schedules"
    ON schedules FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- EXPENSES TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business expenses"
    ON expenses FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- MAINTENANCE REQUESTS TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business maintenance requests"
    ON maintenance_requests FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- PROMOTIONS TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business promotions" 
    ON promotions FOR ALL 
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- BACKUP LOGS TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage own and business backup logs"
    ON backup_logs FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- PROFILES TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage their own profile"
    ON profiles FOR ALL
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);
-- =============================================
-- TOTP SECRETS TABLE POLICIES
-- =============================================
CREATE POLICY "Users can manage their own TOTP secrets"
    ON totp_secrets FOR ALL
    USING (lower(email) = lower(auth.jwt()->>'email'))
    WITH CHECK (lower(email) = lower(auth.jwt()->>'email'));
-- =============================================
-- BUSINESS SHARES TABLE POLICIES
-- =============================================
CREATE POLICY "Users can view their own business shares"
    ON business_shares FOR SELECT
    USING (business_id IN ( 
        SELECT id FROM businesses 
        WHERE user_id = (SELECT auth.uid()) OR check_business_access(id)
    ));

CREATE POLICY "Users can manage business shares"
    ON business_shares FOR ALL
    USING (
        business_id IN (
            SELECT id FROM businesses 
            WHERE user_id = (SELECT auth.uid())
        )
        OR shared_with = (select auth.jwt()->>'email')
    )
    WITH CHECK (
        business_id IN (
            SELECT id FROM businesses 
            WHERE user_id = (SELECT auth.uid())
        )
        OR shared_with = (select auth.jwt()->>'email')
    );
-- =============================================
-- TRANSACTIONS TABLE POLICIES
-- =============================================
-- Allow users to see their own transactions or transactions for businesses they have access to
CREATE POLICY "Users can manage own and business transactions" ON transactions
    FOR ALL USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- MESSAGE TEMPLATES POLICIES
-- =============================================
CREATE POLICY "Users can view business message templates"
    ON message_templates FOR SELECT
    USING (
        (select auth.uid()) = user_id OR 
        check_business_access(business_id)
    );

CREATE POLICY "Users can insert business message templates"
    ON message_templates FOR INSERT
    WITH CHECK (
        (select auth.uid()) = user_id OR 
        check_business_access(business_id)
    );

CREATE POLICY "Users can update business message templates"
    ON message_templates FOR UPDATE
    USING (
        (select auth.uid()) = user_id OR 
        check_business_access(business_id)
    );

CREATE POLICY "Users can delete business message templates"
    ON message_templates FOR DELETE
    USING (
        (select auth.uid()) = user_id OR 
        check_business_access(business_id)
    );
-- =============================================
-- API KEYS POLICIES
-- =============================================
CREATE POLICY "Users can manage API keys for their businesses"
    ON api_keys FOR ALL
    USING (
        check_business_access(business_id)
    );
-- =============================================
-- BOOKING SYSTEM RLS
-- =============================================
-- 1. Property & House visibility (allow public viewing for booking flow)
CREATE POLICY "Public can view properties" ON properties 
    FOR SELECT USING (true);

CREATE POLICY "Public can view houses" ON houses 
    FOR SELECT USING (true);

-- 2. Refined Booking policies
CREATE POLICY "Anyone can create bookings" ON bookings
    FOR INSERT TO anon, authenticated
    WITH CHECK (true);

CREATE POLICY "Users can view their own bookings" ON bookings
    FOR SELECT TO authenticated
    USING (email::TEXT = (auth.jwt()->>'email')::TEXT);

CREATE POLICY "Users can update their own bookings" ON bookings
    FOR UPDATE TO authenticated
    USING (email::TEXT = (auth.jwt()->>'email')::TEXT)
    WITH CHECK (email::TEXT = (auth.jwt()->>'email')::TEXT);

-- 4. Tenant Data Access (Restricted to Owned Records)
CREATE POLICY "Users can view their own tenant profile" ON tenants
    FOR SELECT USING (email::TEXT = (auth.jwt()->>'email')::TEXT);

-- 5. Contract & Receipt Access (Linked by Tenant ID & Email)
CREATE POLICY "Users can view their own contracts" ON contracts
    FOR SELECT USING (tenant_id IN (SELECT id FROM tenants WHERE email::TEXT = (auth.jwt()->>'email')::TEXT));

CREATE POLICY "Users can view their own receipts" ON receipts
    FOR SELECT USING (tenant_id IN (SELECT id FROM tenants WHERE email::TEXT = (auth.jwt()->>'email')::TEXT));

-- 6. Contract Renewal (Token-based & Identity-based)
-- Always allow access if a valid, non-expired renewal token is provided
CREATE POLICY "Allow public access to contracts with valid renewal tokens" ON contracts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM tokens t
            WHERE (t.metadata->>'contract_id')::uuid = contracts.id
              AND t.type = 'contract_renewal'
              AND (t.metadata->>'expires_at')::timestamptz > CURRENT_TIMESTAMP
              AND (t.metadata->>'used_at') IS NULL
              AND contracts.status IN ('active', 'expiring_soon')
        )
    );

CREATE POLICY "Allow public access to tenants for contract renewal" ON tenants
    FOR SELECT USING (has_renewal_contract(id));

-- 7. Essential Business Settings
CREATE POLICY "Allow public read access to essential business settings"
    ON settings FOR SELECT
    USING (setting_key IN ('payment_methods', 'contract_settings', 'business_profile'));
-- =============================================
-- TOKENS TABLE POLICIES
-- =============================================
CREATE POLICY "Allow anonymous access to tokens by token value"
    ON tokens FOR SELECT
    USING (
        type != 'push_token' 
        AND (metadata->>'expires_at' IS NULL OR (metadata->>'expires_at')::timestamptz > CURRENT_TIMESTAMP) 
        AND (metadata->>'used_at') IS NULL
    );

CREATE POLICY "Allow anonymous update to tokens by token value"
    ON tokens FOR UPDATE
    USING (
        type != 'push_token' 
        AND (metadata->>'expires_at' IS NULL OR (metadata->>'expires_at')::timestamptz > CURRENT_TIMESTAMP) 
        AND (metadata->>'used_at') IS NULL
    )
    WITH CHECK (
        type != 'push_token' 
        AND (metadata->>'expires_at' IS NULL OR (metadata->>'expires_at')::timestamptz > CURRENT_TIMESTAMP) 
        AND (metadata->>'used_at') IS NULL
    );

CREATE POLICY "Users can manage tokens for their businesses"
    ON tokens FOR ALL
    USING ((SELECT auth.uid()) = user_id OR check_business_access(business_id))
    WITH CHECK ((SELECT auth.uid()) = user_id OR check_business_access(business_id));
-- =============================================
-- GRANTS
-- =============================================
-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION create_default_business_settings(UUID, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION trigger_create_default_business_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION initialize_missing_business_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION seed_all_businesses_with_defaults() TO authenticated;
-- =============================================
-- 7. GRANT PERMISSIONS
-- =============================================
-- Apply grants to all existing tables in public schema
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, anon, service_role;

-- Ensure future tables get the same grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, anon, service_role;

-- Contract renewal permissions
GRANT EXECUTE ON FUNCTION validate_renewal_token(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION renew_contract(TEXT, DATE, DECIMAL) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_contract_renewal_token(UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION find_expiring_contracts(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION mark_expired_contracts() TO service_role;
GRANT EXECUTE ON FUNCTION create_info_request_token(UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION find_tenants_with_missing_info() TO authenticated, service_role;
GRANT USAGE ON SCHEMA cron_management TO service_role;
-- =============================================
-- EXAMPLE: Create a job that runs every 3 hours
-- =============================================
-- =============================================
-- Uncomment to create:
-- SELECT create_cron_job(p_job_name := 'example_3_hour_job', p_schedule := '0 */3 * * *', p_command := 'SELECT 1');
-- =============================================
-- =============================================
-- GRANT EXECUTE PERMISSIONS
-- =============================================
-- Grant execute permissions to service_role only (restrict from authenticated users)
GRANT EXECUTE ON FUNCTION cron_management.create_cron_job TO service_role;
GRANT EXECUTE ON FUNCTION cron_management.list_cron_jobs TO service_role;
GRANT EXECUTE ON FUNCTION cron_management.get_cron_job TO service_role;
GRANT EXECUTE ON FUNCTION cron_management.remove_cron_job TO service_role;
GRANT EXECUTE ON FUNCTION cron_management.update_cron_job TO service_role;
GRANT EXECUTE ON FUNCTION cron_management.create_scheduled_job_with_url TO service_role;
GRANT EXECUTE ON FUNCTION cron_management.get_cron_job_history TO service_role;
GRANT EXECUTE ON FUNCTION cron_management.validate_cron_schedule TO service_role;

-- Grant execute permissions on wrapper functions to service_role only
GRANT EXECUTE ON FUNCTION create_cron_job TO service_role;
GRANT EXECUTE ON FUNCTION list_cron_jobs TO service_role;
GRANT EXECUTE ON FUNCTION get_cron_job TO service_role;
GRANT EXECUTE ON FUNCTION remove_cron_job TO service_role;
GRANT EXECUTE ON FUNCTION update_cron_job TO service_role;
GRANT EXECUTE ON FUNCTION create_scheduled_job_with_url TO service_role;
GRANT EXECUTE ON FUNCTION get_cron_job_history TO service_role;
GRANT EXECUTE ON FUNCTION enqueue_bulk_message(JSONB, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION enqueue_bulk_message(JSONB, INTEGER) TO service_role;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION enqueue_batch_items(TEXT, JSONB[], INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION enqueue_batch_items(TEXT, JSONB[], INTEGER) TO service_role;

-- Grant access to anonymous and authenticated users so the API route can call it
GRANT EXECUTE ON FUNCTION check_booking_existence(TEXT, TEXT, UUID) TO anon, authenticated;

-- Grant access to anonymous and authenticated users
GRANT EXECUTE ON FUNCTION submit_booking_request(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION reveal_api_key(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_api_key(UUID, TEXT, JSONB, TIMESTAMP WITH TIME ZONE) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_api_key(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_email_blacklisted(TEXT) TO anon, authenticated, service_role;

-- Restrict administrative/introspection functions to service_role only.
REVOKE EXECUTE ON FUNCTION public.fn_find_duplicates(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_rls_enabled(BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_find_duplicates(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_rls_enabled(BOOLEAN) TO service_role;
-- ==============================================================================
-- JSONB UTILITY FUNCTIONS
-- ==============================================================================
CREATE OR REPLACE FUNCTION remove_jsonb_key_from_all_tables(target_column text, key_to_remove text)
RETURNS void AS $$
DECLARE
    t_name text;
BEGIN
    FOR t_name IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND column_name = target_column 
          AND data_type = 'jsonb'
    LOOP
        EXECUTE format(
            'UPDATE public.%I SET %I = %I - %L WHERE %I ? %L;', 
            t_name, target_column, target_column, key_to_remove, target_column, key_to_remove
        );
        RAISE NOTICE 'Removed key "%" from column "%" in table: %', key_to_remove, target_column, t_name;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Run the function to remove 'is_demo' from 'metadata'
-- SELECT remove_jsonb_key_from_all_tables('metadata', 'is_demo');

-- ==============================================================================
-- SEED STORAGE BUCKETS & RLS
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES 
    ('public-assets', 'public-assets', true),
    ('private-assets', 'private-assets', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- =============================================
-- GENERIC AUDIT TRIGGER FUNCTION
-- =============================================
CREATE OR REPLACE FUNCTION public.record_audit_log()
RETURNS TRIGGER AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_user_id uuid;
  v_business uuid;
  v_entity_id uuid;
  v_key text;
  v_label text;
  v_action text := lower(TG_OP);
BEGIN
  -- ── Resolve actor ──────────────────────────────────────────────
  v_user_id := NULLIF(
    current_setting('request.jwt.claims', true)::jsonb->>'sub', ''
  )::uuid;

  -- ── Resolve entity id + business id from the row ───────────────
  IF TG_OP = 'DELETE' THEN
    v_entity_id := OLD.id;
    v_business  := (to_jsonb(OLD)->>'business_id')::uuid;
  ELSE
    v_entity_id := NEW.id;
    v_business  := (to_jsonb(NEW)->>'business_id')::uuid;
    -- Fallback actor: use the row's user_id when no JWT session
    IF v_user_id IS NULL AND to_jsonb(NEW) ? 'user_id' THEN
      v_user_id := (to_jsonb(NEW)->>'user_id')::uuid;
    END IF;
  END IF;

  -- If the entity is a business itself, its business_id is its own id
  IF TG_TABLE_NAME = 'businesses' THEN
    v_business := v_entity_id;
  END IF;

  -- ── Compute field-level diff for UPDATE ────────────────────────
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);

    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF v_key IN ('metadata', 'created_at', 'updated_at') THEN
        CONTINUE;
      END IF;

      IF v_old->v_key IS DISTINCT FROM v_new->v_key THEN
        v_changes := v_changes || jsonb_build_object(
          v_key,
          jsonb_build_object('old', v_old->v_key, 'new', v_new->v_key)
        );
      END IF;
    END LOOP;

    IF v_changes = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    IF v_changes ? 'status' THEN
      v_label := 'Status changed to ' || initcap(v_changes->'status'->>'new');
    ELSIF (SELECT count(*) FROM jsonb_object_keys(v_changes)) = 1 THEN
      v_label := initcap(replace((SELECT key FROM jsonb_object_keys(v_changes) AS key LIMIT 1), '_', ' ')) || ' updated';
    END IF;
  END IF;

  -- ── Write to audit_logs ────────────────────────────────────────
  INSERT INTO public.audit_logs (
    entity_type, entity_id, business_id, user_id, action, changes, label
  ) VALUES (
    TG_TABLE_NAME, v_entity_id, v_business, v_user_id, v_action,
    CASE WHEN TG_OP = 'UPDATE' THEN v_changes ELSE NULL END, v_label
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- One AFTER trigger per audited table
-- =============================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contracts', 'tenants', 'bookings', 'expenses', 'receipts',
    'maintenance_requests', 'houses', 'properties', 'businesses'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trigger_%I_audit ON %I;
       CREATE TRIGGER trigger_%I_audit
         AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW
         EXECUTE FUNCTION public.record_audit_log();',
      t, t, t, t
    );
  END LOOP;
END $$;

-- =============================================
-- SEED DATA
-- =============================================
-- =============================================
-- SEED BACKUP SCHEDULES
-- =============================================
-- Insert default backup schedules for all existing businesses
INSERT INTO schedules (business_id, user_id, schedule_type, status, schedule, emails, next_run)
SELECT
    b.id as business_id,
    b.user_id,
    'system_backup' as schedule_type,
    'active' as status,
    '{"frequency": "daily", "time": "02:00:00"}'::jsonb as schedule,
    '[]'::jsonb as emails,
    (CURRENT_TIMESTAMP + INTERVAL '1 day' + INTERVAL '2 hours') as next_run
FROM businesses b
ON CONFLICT (business_id, schedule_type) WHERE deleted = FALSE DO NOTHING;
-- =============================================
-- CRONS & JOBS
-- =============================================
-- Apply to all currently existing tables
SELECT handle_times_triggers();
-- =============================================
-- FINAL SAFETY CHECK
-- =============================================
-- Ensure ALL tables in the public schema have a 'deleted' column
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
    LOOP
        -- Add the column if it doesn't exist
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT false', t);
    END LOOP;
END $$;

-- Enable RLS on all tables
SELECT set_rls_enabled(true);

DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime;

-- Enable realtime for all tables
SELECT public.set_realtime_enabled(true);

-- Execute the helper function to clean up ALL existing policies
SELECT drop_storage_policies();

-- Initialize policies for all buckets
SELECT create_storage_policies('public-assets');
SELECT create_storage_policies('private-assets');

-- =============================================
-- CRON JOB MANAGEMENT FUNCTIONS
-- CREATE DEDICATED SCHEMA FOR CRON MANAGEMENT
CREATE SCHEMA IF NOT EXISTS cron_management;

-- Create the unified queue
SELECT pgmq.create('bulk_messages');

-- Update next_backup times for all schedules using the safe calculation function
SELECT update_all_next_backup_times();
