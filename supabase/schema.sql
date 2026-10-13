-- ==============================================================================
-- outbox-sync Production Supabase Setup Script (deleted: true Soft Deletes)
--
-- Run this in your Supabase SQL Editor (Dashboard -> SQL Editor).
-- Uses standard `deleted = true` soft deletes for reliable offline-first sync.
-- ==============================================================================

-- 1. Automatic Timestamp Trigger
CREATE OR REPLACE FUNCTION public.set_sync_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- EXAMPLE: How to create a synced table (e.g. 'todos')
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  deleted BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for fast delta sync
CREATE INDEX IF NOT EXISTS idx_todos_sync ON public.todos (updated_at);

-- Auto-update updated_at on changes (including soft deletes)
CREATE OR REPLACE TRIGGER trigger_todos_updated_at
BEFORE UPDATE ON public.todos
FOR EACH ROW EXECUTE FUNCTION public.set_sync_updated_at();

-- Enable Supabase Realtime replication
ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;
