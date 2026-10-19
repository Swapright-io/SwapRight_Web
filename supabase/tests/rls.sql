-- Run with `supabase test db` after linking a local Supabase project.
-- The suite should be expanded with pgTAP assertions for every policy and RPC.
begin;
select plan(4);
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'listings', 'listings exists');
select has_table('public', 'reservations', 'reservations exists');
select has_function('public', 'claim_listing', array['uuid']::text[], 'claim_listing RPC exists');
select * from finish();
rollback;
