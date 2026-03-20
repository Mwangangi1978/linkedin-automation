/// <reference path="../_shared/deno-shims.d.ts" />
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { scrapeProfilePosts } from '../_shared/apify.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import type { TriggerMode } from '../_shared/types.ts';

interface ActiveRunRow {
  id: string;
  started_at: string;
}

const STALE_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const APIFY_WEBHOOK_BASE_URL = 'https://nygeylpqjtxigxzhgaen.supabase.co/functions/v1/process-apify-webhook';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, Authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json',
    },
  });
}

async function requireAuthenticatedRequest(req: Request) {
  const authorization = req.headers.get('authorization') ?? req.headers.get('Authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : null;

  if (!token) {
    return {
      userId: null,
      response: jsonResponse({ error: 'Missing bearer token' }, 401),
    };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const apikey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !apikey) {
    return {
      userId: null,
      response: jsonResponse({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500),
    };
  }

  let verifyRes: Response;
  try {
    verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey,
      },
    });
  } catch (err) {
    console.error('JWT verification fetch failed', err);
    return {
      userId: null,
      response: jsonResponse({ error: 'Failed to verify session token' }, 500),
    };
  }

  if (!verifyRes.ok) {
    return {
      userId: null,
      response: jsonResponse({ error: 'Invalid or expired session token' }, 401),
    };
  }

  const user = (await verifyRes.json()) as { id?: string };
  if (!user?.id) {
    return {
      userId: null,
      response: jsonResponse({ error: 'Invalid or expired session token' }, 401),
    };
  }

  return { userId: user.id, response: null };
}

async function updateRun(runId: string, partial: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from('scrape_runs').update(partial).eq('id', runId);
  if (error) {
    throw error;
  }
}

async function recoverStaleRunLock() {
  const { data: lockConfig, error: configError } = await supabaseAdmin
    .from('system_config')
    .select('run_lock')
    .eq('id', true)
    .maybeSingle();

  if (configError || !lockConfig?.run_lock) {
    return;
  }

  const { data: activeRun, error: activeRunError } = await supabaseAdmin
    .from('scrape_runs')
    .select('id, started_at')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeRunError) {
    return;
  }

  const typedActiveRun = (activeRun ?? null) as ActiveRunRow | null;

  if (!typedActiveRun) {
    await supabaseAdmin.rpc('release_run_lock');
    return;
  }

  const startedAtMs = new Date(typedActiveRun.started_at).getTime();
  const isStale = Number.isFinite(startedAtMs) && Date.now() - startedAtMs > STALE_RUN_TIMEOUT_MS;

  if (!isStale) {
    return;
  }

  await supabaseAdmin
    .from('scrape_runs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_log: [{ stage: 'fatal', message: 'Run timed out and was marked stale automatically.' }],
    })
    .eq('id', typedActiveRun.id);

  await supabaseAdmin.rpc('release_run_lock');
}

serve(async (req: Request) => {
  let runId = '';
  let startedBackgroundRuns = false;

  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const auth = await requireAuthenticatedRequest(req);
    if (auth.response) {
      return auth.response;
    }

    const body = await req.json().catch(() => ({}));
    const triggeredBy = (body?.triggeredBy ?? 'manual') as TriggerMode;
    const requestedProfileId = typeof body?.profileId === 'string' && body.profileId.trim() ? body.profileId.trim() : null;

    if (!supabaseAdmin) {
      return jsonResponse({ error: 'Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY' }, 500);
    }

    await recoverStaleRunLock();

    const { data: lockResult, error: lockError } = await supabaseAdmin.rpc('acquire_run_lock');
    if (lockError || !lockResult) {
      return jsonResponse({ error: 'Run lock is active. Try again later.' }, 409);
    }

    const { data: run, error: runError } = await supabaseAdmin
      .from('scrape_runs')
      .insert({ triggered_by: triggeredBy, status: 'running', requested_profile_id: requestedProfileId })
      .select('id')
      .single();

    if (runError || !run) {
      throw runError ?? new Error('Unable to create scrape run');
    }

    runId = run.id;

    const profileQuery = supabaseAdmin.from('tracked_profiles').select('*').eq('is_active', true);
    if (requestedProfileId) {
      profileQuery.eq('id', requestedProfileId);
    }

    // Fetch config first so any downstream values (Apify token, delays, etc.)
    // are guaranteed to exist before we build `apifyConfig`.
    const { data: config, error: configError } = await supabaseAdmin
      .from('system_config')
      .select('*')
      .eq('id', true)
      .single();

    if (configError || !config) {
      throw configError ?? new Error('Missing system config row');
    }

    const { data: profiles, error: profileError } = await profileQuery;
    if (profileError) {
      throw profileError;
    }

    if (requestedProfileId && (!profiles || profiles.length === 0)) {
      throw new Error('Requested profile is missing or inactive');
    }

    const apifyConfig = {
      apifyToken: config.apify_token,
      linkedinCookies: config.linkedin_cookies,
      linkedinUserAgent: config.linkedin_user_agent,
      proxyCountry: config.proxy_country,
      commentSortType: config.apify_comment_sort_type ?? 'RELEVANCE',
      minDelay: config.apify_min_delay ?? 2,
      maxDelay: config.apify_max_delay ?? 7,
      maxCommentsPerPost: config.default_comment_count_limit ?? 100,
      maxPostsPerProfile: 100,
    };

    if (!apifyConfig.apifyToken || !apifyConfig.linkedinCookies || !apifyConfig.linkedinUserAgent) {
      throw new Error('Missing Apify or LinkedIn credentials in settings');
    }

    if (!profiles || profiles.length === 0) {
      await updateRun(runId, {
        completed_at: new Date().toISOString(),
        status: 'completed',
      });
      await supabaseAdmin.rpc('release_run_lock');
      return jsonResponse({ status: 'completed', runId, message: 'No active profiles to process.' });
    }

    for (const profile of profiles) {
      const webhookUrl = `${APIFY_WEBHOOK_BASE_URL}?runId=${encodeURIComponent(runId)}&stage=posts&profileId=${encodeURIComponent(profile.id)}`;
      await scrapeProfilePosts(
        profile.profile_url,
        {
          ...apifyConfig,
          maxPostsPerProfile: profile.max_posts_per_run ?? 100,
        },
        webhookUrl,
      );
      startedBackgroundRuns = true;
    }

    return jsonResponse({ status: 'started', runId });
  } catch (error: unknown) {
    if (runId) {
      try {
        await updateRun(runId, {
          completed_at: new Date().toISOString(),
          status: 'failed',
          error_log: [{ stage: 'fatal', message: (() => {
            console.error('Pipeline Trigger Error:', error);

            const safeStringify = (value: unknown) => {
              try {
                return JSON.stringify(value);
              } catch {
                return '[unserializable error]';
              }
            };

            if (error instanceof Error) return error.message;
            if (typeof (error as any)?.message === 'string') return (error as any).message;
            return safeStringify(error);
          })() }],
        });
      } catch (updateError) {
        console.error('Failed to mark scrape run as failed after trigger error.', updateError);
      }
    }

    if (!startedBackgroundRuns && supabaseAdmin) {
      try {
        await supabaseAdmin.rpc('release_run_lock');
      } catch (releaseError) {
        console.error('Failed to release run lock after trigger failure.', releaseError);
      }
    }

    const safeStringify = (value: unknown) => {
      try {
        return JSON.stringify(value);
      } catch {
        return '[unserializable error]';
      }
    };

    const errorMessage =
      error instanceof Error
        ? error.message
        : (typeof (error as any)?.message === 'string' ? (error as any).message : safeStringify(error));

    return jsonResponse({ error: errorMessage }, 500);
  }
});
