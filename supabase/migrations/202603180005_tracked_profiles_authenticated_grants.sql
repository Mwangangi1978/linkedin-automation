grant usage on schema public to authenticated;

grant select, insert, update, delete
on table public.tracked_profiles
to authenticated;
