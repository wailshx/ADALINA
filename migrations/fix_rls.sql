-- Migration: Enable Row Level Security on commune_delivery_prices and wishlists
-- Supabase Postgres Linter fix
-- Run against Supabase SQL Editor or via psql

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. commune_delivery_prices — Enable RLS + permissive SELECT for all users
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE commune_delivery_prices ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies to avoid conflicts
DROP POLICY IF EXISTS commune_prices_all_access ON commune_delivery_prices;
DROP POLICY IF EXISTS "Allow public read access on commune_delivery_prices" ON commune_delivery_prices;

-- Allow all users (anon + authenticated) to read delivery prices
CREATE POLICY "Allow public read access on commune_delivery_prices"
    ON commune_delivery_prices
    FOR SELECT
    USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. wishlists — Enable RLS + permissive ALL policy (hash-based, no user_id)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE wishlists ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies to avoid conflicts
DROP POLICY IF EXISTS wishlists_all_access ON wishlists;

-- Permissive policy: all users can SELECT/INSERT/UPDATE/DELETE
-- Wishlists are hash-based (anonymous), not tied to auth users
CREATE POLICY wishlists_all_access ON wishlists
    FOR ALL
    USING (true)
    WITH CHECK (true);
