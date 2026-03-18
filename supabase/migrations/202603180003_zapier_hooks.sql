create table if not exists public.zapier_hooks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  webhook_url text not null,
  auth_header text not null default 'Authorization',
  api_key text,
  lookback_days integer not null default 7,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zapier_hook_deliveries (
  id uuid primary key default gen_random_uuid(),
  hook_id uuid not null references public.zapier_hooks(id) on delete cascade,
  author_id uuid not null references public.scraped_authors(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'pushed', 'failed', 'skipped')),
  failure_count integer not null default 0,
  error text,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hook_id, author_id)
);

create index if not exists idx_zapier_hook_deliveries_hook_status
  on public.zapier_hook_deliveries (hook_id, status);

create index if not exists idx_zapier_hook_deliveries_author
  on public.zapier_hook_deliveries (author_id);

drop trigger if exists zapier_hooks_set_updated_at on public.zapier_hooks;
create trigger zapier_hooks_set_updated_at
before update on public.zapier_hooks
for each row
execute function public.set_updated_at();

drop trigger if exists zapier_hook_deliveries_set_updated_at on public.zapier_hook_deliveries;
create trigger zapier_hook_deliveries_set_updated_at
before update on public.zapier_hook_deliveries
for each row
execute function public.set_updated_at();

alter table public.zapier_hooks enable row level security;
alter table public.zapier_hook_deliveries enable row level security;

drop policy if exists zapier_hooks_all_authenticated on public.zapier_hooks;
create policy zapier_hooks_all_authenticated
on public.zapier_hooks
for all
to authenticated
using (true)
with check (true);

drop policy if exists zapier_hook_deliveries_all_authenticated on public.zapier_hook_deliveries;
create policy zapier_hook_deliveries_all_authenticated
on public.zapier_hook_deliveries
for all
to authenticated
using (true)
with check (true);
