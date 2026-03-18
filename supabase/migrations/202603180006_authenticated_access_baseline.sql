grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.tracked_profiles to authenticated;
grant select, insert, update, delete on table public.scrape_runs to authenticated;
grant select, insert, update, delete on table public.scraped_posts to authenticated;
grant select, insert, update, delete on table public.scraped_authors to authenticated;
grant select, insert, update, delete on table public.system_config to authenticated;
grant select, insert, update, delete on table public.zapier_hooks to authenticated;
grant select, insert, update, delete on table public.zapier_hook_deliveries to authenticated;

alter table public.tracked_profiles enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.scraped_posts enable row level security;
alter table public.scraped_authors enable row level security;
alter table public.system_config enable row level security;
alter table public.zapier_hooks enable row level security;
alter table public.zapier_hook_deliveries enable row level security;

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

alter default privileges in schema public
grant select, insert, update, delete on tables to authenticated;