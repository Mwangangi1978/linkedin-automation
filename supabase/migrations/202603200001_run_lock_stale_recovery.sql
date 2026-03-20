update public.scrape_runs
set
  status = 'failed',
  completed_at = coalesce(completed_at, now()),
  error_log = coalesce(error_log, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('stage', 'fatal', 'message', 'Run auto-closed as stale lock cleanup.')
  )
where status = 'running'
  and started_at < now() - interval '2 hours';

update public.system_config as sc
set run_lock = false
where sc.id = true
  and sc.run_lock = true
  and not exists (
    select 1
    from public.scrape_runs as sr
    where sr.status = 'running'
  );

create or replace function public.acquire_run_lock()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  has_running boolean;
begin
  select exists(
    select 1
    from public.scrape_runs
    where status = 'running'
  ) into has_running;

  if not has_running then
    update public.system_config
    set run_lock = false
    where id = true;
  end if;

  update public.system_config
  set run_lock = true
  where id = true and run_lock = false;

  return found;
end;
$$;
