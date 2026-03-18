export type CrmPushStatus = 'pending' | 'pushed' | 'failed' | 'skipped';

export interface TrackedProfile {
  id: string;
  profile_url: string;
  display_name: string | null;
  notes: string | null;
  is_active: boolean;
  post_lookback_days: number;
  max_posts_per_run: number;
  last_scraped_at: string | null;
  created_at: string;
}

export interface ScrapeRun {
  id: string;
  triggered_by: 'manual' | 'schedule';
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'completed' | 'failed';
  profiles_processed: number;
  posts_found: number;
  new_posts_scraped: number;
  comments_collected: number;
  new_unique_authors: number;
  crm_pushes_succeeded: number;
  crm_pushes_failed: number;
  error_log: Array<Record<string, unknown>>;
}

export interface ScrapedAuthor {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  linkedin_profile_url: string;
  comment_text: string | null;
  source_post_url: string | null;
  source_leader_profile_url: string | null;
  crm_push_status: CrmPushStatus;
  created_at: string;
}

export interface SystemConfig {
  id: boolean;
  default_schedule: string;
  schedule_enabled: boolean;
  default_post_lookback_days: number;
  default_comment_count_limit: number;
  apify_token: string | null;
  linkedin_cookies: string | null;
  linkedin_user_agent: string | null;
  proxy_country: string | null;
  apify_comment_sort_type: 'RECENT' | 'RELEVANCE';
  apify_min_delay: number;
  apify_max_delay: number;
  crm_endpoint: string | null;
  crm_api_key: string | null;
  crm_auth_header: string;
}
