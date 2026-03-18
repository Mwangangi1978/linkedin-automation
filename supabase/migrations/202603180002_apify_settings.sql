alter table public.system_config
  add column if not exists apify_comment_sort_type text not null default 'RELEVANCE'
    check (apify_comment_sort_type in ('RECENT', 'RELEVANCE')),
  add column if not exists apify_min_delay integer not null default 2,
  add column if not exists apify_max_delay integer not null default 7;
