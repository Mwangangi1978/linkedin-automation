import type { ScrapeRun, ScrapedAuthor, SystemConfig, TrackedProfile } from './models';
import { supabase } from './supabase';

async function ensureSystemConfigRow() {
  const { data, error } = await supabase
    .from('system_config')
    .select('*')
    .eq('id', true)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return data;
  }

  const { error: insertError } = await supabase
    .from('system_config')
    .upsert({ id: true }, { onConflict: 'id' });

  if (insertError) {
    throw insertError;
  }

  const { data: createdData, error: createdError } = await supabase
    .from('system_config')
    .select('*')
    .eq('id', true)
    .single();

  if (createdError) {
    throw createdError;
  }

  return createdData;
}

export async function getDashboardStats() {
  const [profilesRes, postsRes, authorsRes, pendingRes, runsRes] = await Promise.all([
    supabase.from('tracked_profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('scraped_posts').select('id', { count: 'exact', head: true }),
    supabase.from('scraped_authors').select('id', { count: 'exact', head: true }),
    supabase.from('scraped_authors').select('id', { count: 'exact', head: true }).eq('crm_push_status', 'pending'),
    supabase.from('scrape_runs').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  return {
    totalProfiles: profilesRes.count ?? 0,
    totalPosts: postsRes.count ?? 0,
    totalAuthors: authorsRes.count ?? 0,
    totalPending: pendingRes.count ?? 0,
    lastRun: runsRes.data as ScrapeRun | null,
  };
}

export async function listTrackedProfiles() {
  const { data, error } = await supabase
    .from('tracked_profiles')
    .select('id, profile_url, display_name, notes, is_active, post_lookback_days, max_posts_per_run, last_scraped_at, created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as TrackedProfile[];
}

export async function createTrackedProfile(payload: {
  profile_url: string;
  display_name: string;
  post_lookback_days: number;
  max_posts_per_run: number;
  notes?: string;
  is_active?: boolean;
}) {
  const { error } = await supabase.from('tracked_profiles').insert(payload);
  if (error) throw error;
}

export async function updateTrackedProfile(id: string, payload: Partial<TrackedProfile>) {
  const { error } = await supabase.from('tracked_profiles').update(payload).eq('id', id);
  if (error) throw error;
}

export async function toggleProfileIntegration(id: string, enabled: boolean) {
  const { error } = await supabase
    .from('tracked_profiles')
    .update({ is_active: enabled })
    .eq('id', id);

  if (error) throw error;
}

export async function listAuthors(filters?: {
  crmStatus?: string;
  sourceLeader?: string;
}) {
  let query = supabase.from('scraped_authors').select('*').order('created_at', { ascending: false }).limit(300);

  if (filters?.crmStatus) {
    query = query.eq('crm_push_status', filters.crmStatus);
  }

  if (filters?.sourceLeader) {
    query = query.eq('source_leader_profile_url', filters.sourceLeader);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as ScrapedAuthor[];
}

export async function listRuns() {
  const { data, error } = await supabase.from('scrape_runs').select('*').order('started_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as ScrapeRun[];
}

export async function getSettings() {
  const data = await ensureSystemConfigRow();
  return data as SystemConfig;
}

export async function saveSettings(payload: Partial<SystemConfig>) {
  await ensureSystemConfigRow();

  const { error } = await supabase
    .from('system_config')
    .update(payload)
    .eq('id', true);

  if (error) throw error;
}

export async function triggerRun(triggeredBy: 'manual' | 'schedule' = 'manual') {
  const { data, error } = await supabase.functions.invoke('run-pipeline', {
    body: { triggeredBy },
  });
  if (error) throw error;
  return data;
}

export async function retryFailedCrmPushes(limit = 100) {
  const { data, error } = await supabase
    .from('scraped_authors')
    .update({ crm_push_status: 'pending' })
    .eq('crm_push_status', 'failed')
    .lt('crm_failure_count', 3)
    .limit(limit)
    .select('id');

  if (error) throw error;
  return data?.length ?? 0;
}
