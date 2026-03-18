create extension if not exists pgcrypto;

create table if not exists public.tracked_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_url text unique not null,
  display_name text,
  notes text,
  is_active boolean not null default true,
  post_lookback_days integer not null default 30,
  max_posts_per_run integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_scraped_at timestamptz
);

create table if not exists public.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  triggered_by text not null check (triggered_by in ('schedule', 'manual')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  profiles_processed integer not null default 0,
  posts_found integer not null default 0,
  new_posts_scraped integer not null default 0,
  comments_collected integer not null default 0,
  new_unique_authors integer not null default 0,
  crm_pushes_succeeded integer not null default 0,
  crm_pushes_failed integer not null default 0,
  error_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.scraped_posts (
  id uuid primary key default gen_random_uuid(),
  post_url text unique not null,
  source_profile_url text not null,
  post_text_excerpt text,
  posted_at timestamptz,
  total_comments integer,
  comments_scraped boolean not null default false,
  first_seen_run_id uuid references public.scrape_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scraped_authors (
  id uuid primary key default gen_random_uuid(),
  linkedin_profile_url text unique not null,
  linkedin_profile_id text,
  full_name text,
  first_name text,
  last_name text,
  comment_text text,
  source_post_url text,
  source_leader_profile_url text,
  first_seen_run_id uuid references public.scrape_runs (id) on delete set null,
  crm_pushed_at timestamptz,
  crm_record_id text,
  crm_push_status text not null default 'pending' check (crm_push_status in ('pending', 'pushed', 'failed', 'skipped')),
  crm_error text,
  crm_failure_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_scraped_authors_profile_url
  on public.scraped_authors (linkedin_profile_url);

create table if not exists public.system_config (
  id boolean primary key default true,
  run_lock boolean not null default false,
  default_schedule text not null default '0 8 * * *',
  schedule_enabled boolean not null default false,
  default_post_lookback_days integer not null default 30,
  default_comment_count_limit integer not null default 100,
  apify_token text,
  linkedin_cookies text,
  linkedin_user_agent text,
  proxy_country text,
  crm_endpoint text,
  crm_api_key text,
  crm_auth_header text not null default 'Authorization',
  crm_field_mapping jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.system_config (id)
values (true)
on conflict (id) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tracked_profiles_set_updated_at on public.tracked_profiles;
create trigger tracked_profiles_set_updated_at
before update on public.tracked_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists scraped_posts_set_updated_at on public.scraped_posts;
create trigger scraped_posts_set_updated_at
before update on public.scraped_posts
for each row
execute function public.set_updated_at();

drop trigger if exists scraped_authors_set_updated_at on public.scraped_authors;
create trigger scraped_authors_set_updated_at
before update on public.scraped_authors
for each row
execute function public.set_updated_at();

drop trigger if exists system_config_set_updated_at on public.system_config;
create trigger system_config_set_updated_at
before update on public.system_config
for each row
execute function public.set_updated_at();

alter table public.tracked_profiles enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.scraped_posts enable row level security;
alter table public.scraped_authors enable row level security;
alter table public.system_config enable row level security;

drop policy if exists tracked_profiles_all_authenticated on public.tracked_profiles;
create policy tracked_profiles_all_authenticated
on public.tracked_profiles
for all
to authenticated
using (true)
with check (true);

drop policy if exists scrape_runs_all_authenticated on public.scrape_runs;
create policy scrape_runs_all_authenticated
on public.scrape_runs
for all
to authenticated
using (true)
with check (true);

drop policy if exists scraped_posts_all_authenticated on public.scraped_posts;
create policy scraped_posts_all_authenticated
on public.scraped_posts
for all
to authenticated
using (true)
with check (true);

drop policy if exists scraped_authors_all_authenticated on public.scraped_authors;
create policy scraped_authors_all_authenticated
on public.scraped_authors
for all
to authenticated
using (true)
with check (true);

drop policy if exists system_config_all_authenticated on public.system_config;
create policy system_config_all_authenticated
on public.system_config
for all
to authenticated
using (true)
with check (true);

create or replace function public.acquire_run_lock()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  locked boolean;
begin
  update public.system_config
  set run_lock = true
  where id = true and run_lock = false
  returning true into locked;

  return coalesce(locked, false);
end;
$$;

create or replace function public.release_run_lock()
returns void
language sql
security definer
set search_path = public
as $$
  update public.system_config set run_lock = false where id = true;
$$;

grant execute on function public.acquire_run_lock to service_role;
grant execute on function public.release_run_lock to service_role;
