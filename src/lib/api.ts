import type { ScrapeRun, ScrapedAuthor, SystemConfig, TrackedProfile, ZapierHook } from './models';
import { supabase } from './supabase';

const pipelineFunctionName = import.meta.env.VITE_PIPELINE_FUNCTION_NAME?.trim() || 'link-scraper';

async function requireAuthenticatedSession() {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new Error('Your Supabase session is missing or expired. Please sign in again.');
  }
}

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

export async function getTrackedProfile(id: string) {
  const { data, error } = await supabase
    .from('tracked_profiles')
    .select('id, profile_url, display_name, notes, is_active, post_lookback_days, max_posts_per_run, last_scraped_at, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as TrackedProfile | null;
}

export async function createTrackedProfile(payload: {
  profile_url: string;
  display_name: string;
  post_lookback_days: number;
  max_posts_per_run: number;
  notes?: string;
  is_active?: boolean;
}) {
  await requireAuthenticatedSession();

  const { error } = await supabase.from('tracked_profiles').insert(payload);
  if (error) throw error;
}

export async function updateTrackedProfile(id: string, payload: Partial<TrackedProfile>) {
  await requireAuthenticatedSession();

  const { error } = await supabase.from('tracked_profiles').update(payload).eq('id', id);
  if (error) throw error;
}

export async function toggleProfileIntegration(id: string, enabled: boolean) {
  await requireAuthenticatedSession();

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

export async function listRunsForProfile(profileId: string, limit = 20) {
  const primaryQuery = await supabase
    .from('scrape_runs')
    .select('*')
    .eq('requested_profile_id', profileId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (!primaryQuery.error) {
    return (primaryQuery.data ?? []) as ScrapeRun[];
  }

  const fallbackQuery = await supabase
    .from('scrape_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (fallbackQuery.error) {
    throw fallbackQuery.error;
  }

  return (fallbackQuery.data ?? []) as ScrapeRun[];
}

export async function getLatestRunForProfile(profileId: string) {
  const primaryQuery = await supabase
    .from('scrape_runs')
    .select('*')
    .eq('requested_profile_id', profileId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!primaryQuery.error) {
    return (primaryQuery.data ?? null) as ScrapeRun | null;
  }

  const fallbackQuery = await supabase
    .from('scrape_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallbackQuery.error) {
    throw fallbackQuery.error;
  }

  return (fallbackQuery.data ?? null) as ScrapeRun | null;
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

export async function triggerRun(triggeredBy: 'manual' | 'schedule' = 'manual', profileId?: string) {
  const { data, error } = await supabase.functions.invoke(pipelineFunctionName, {
    body: {
      triggeredBy,
      profileId,
    },
  });
  if (error) {
    const status = error.context?.status;
    if (status === 409) {
      throw new Error('A scrape run is already in progress. Please wait for it to finish before starting another run.');
    }
    throw error;
  }
  return data;
}

export async function retryFailedCrmPushes(limit = 100) {
  const { data, error } = await supabase
    .from('zapier_hook_deliveries')
    .update({ status: 'pending', error: null })
    .eq('status', 'failed')
    .lt('failure_count', 3)
    .limit(limit)
    .select('id, author_id');

  if (error) throw error;

  const authorIds = Array.from(new Set((data ?? []).map((row) => row.author_id).filter(Boolean)));
  if (authorIds.length > 0) {
    await supabase
      .from('scraped_authors')
      .update({ crm_push_status: 'pending' })
      .in('id', authorIds);
  }

  return data?.length ?? 0;
}

export async function listZapierHooks() {
  const { data, error } = await supabase
    .from('zapier_hooks')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as ZapierHook[];
}

export async function createZapierHook(payload: {
  name: string;
  webhook_url: string;
  auth_header?: string;
  api_key?: string | null;
  lookback_days: number;
  is_active?: boolean;
}) {
  const { error } = await supabase.from('zapier_hooks').insert({
    name: payload.name,
    webhook_url: payload.webhook_url,
    auth_header: payload.auth_header ?? 'Authorization',
    api_key: payload.api_key ?? null,
    lookback_days: payload.lookback_days,
    is_active: payload.is_active ?? true,
  });

  if (error) throw error;
}

export async function updateZapierHook(id: string, payload: Partial<ZapierHook>) {
  const { error } = await supabase
    .from('zapier_hooks')
    .update(payload)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteZapierHook(id: string) {
  const { error } = await supabase
    .from('zapier_hooks')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
