-- ==============================================================================
-- outbox-sync Production Supabase Setup Script
--
-- Run this in your Supabase SQL Editor (Dashboard -> SQL Editor)
-- to make your database 100% bulletproof for offline-first sync.
-- ==============================================================================

-- 1. Automatic Timestamp Trigger
CREATE OR REPLACE FUNCTION public.set_sync_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Tombstones Table for Hard Deletes (Reliable Offline Delete Delivery)
CREATE TABLE IF NOT EXISTS public.sync_tombstones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  deleted_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_tombstones_lookup 
ON public.sync_tombstones (table_name, deleted_at);

-- 3. Tombstone Trigger Function
CREATE OR REPLACE FUNCTION public.capture_sync_tombstone()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.sync_tombstones (table_name, row_id, deleted_at)
  VALUES (TG_TABLE_NAME, OLD.id::text, timezone('utc'::text, now()));
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Enable Realtime Replication on sync_tombstones
ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_tombstones;

-- ==============================================================================
-- EXAMPLE: How to hook up a table (e.g. 'todos')
-- ==============================================================================
-- 
-- CREATE TABLE IF NOT EXISTS public.todos (
--   id TEXT PRIMARY KEY,
--   title TEXT NOT NULL,
--   completed INTEGER DEFAULT 0,
--   created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
--   updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
-- );
-- 
-- -- Auto-update updated_at on change
-- CREATE OR REPLACE TRIGGER trigger_todos_updated_at
-- BEFORE UPDATE ON public.todos
-- FOR EACH ROW EXECUTE FUNCTION public.set_sync_updated_at();
-- 
-- -- Capture hard deletes into tombstones for offline clients
-- CREATE OR REPLACE TRIGGER trigger_todos_tombstone
-- AFTER DELETE ON public.todos
-- FOR EACH ROW EXECUTE FUNCTION public.capture_sync_tombstone();
-- 
-- -- Enable Realtime replication
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;
-- ==============================================================================
