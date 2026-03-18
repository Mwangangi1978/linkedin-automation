grant select, insert, update, delete
on table public.system_config
to anon, authenticated;

drop policy if exists system_config_all_authenticated on public.system_config;

create policy system_config_all_authenticated
on public.system_config
for all
to authenticated, anon
using (true)
with check (true);
