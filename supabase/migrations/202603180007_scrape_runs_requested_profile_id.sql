alter table public.scrape_runs
add column if not exists requested_profile_id uuid references public.tracked_profiles (id) on delete set null;

create index if not exists idx_scrape_runs_requested_profile_id_started_at
on public.scrape_runs (requested_profile_id, started_at desc);

grant select, insert, update, delete on table public.scrape_runs to authenticated;
