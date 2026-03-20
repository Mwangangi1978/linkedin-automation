import type {} from '../_shared/deno-shims.d.ts';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { scrapePostComments, scrapeProfilePosts } from '../_shared/apify.ts';
import { pushLeadToCrm } from '../_shared/crm.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import type { PipelineSummary, TriggerMode } from '../_shared/types.ts';

interface ZapierHookRow {
  id: string;
  name: string;
  webhook_url: string;
  auth_header: string;
  api_key: string | null;
  lookback_days: number;
  is_active: boolean;
}

interface ScrapedAuthorRow {
  id: string;
  linkedin_profile_url: string;
  first_name: string | null;
  last_name: string | null;
  comment_text: string | null;
  source_post_url: string | null;
  source_leader_profile_url: string | null;
  created_at: string;
}

interface DeliveryRow {
  author_id: string;
  failure_count: number;
  status: 'pending' | 'pushed' | 'failed' | 'skipped';
}

interface ActiveRunRow {
  id: string;
  started_at: string;
}

const STALE_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // Include both lower/upper-case header tokens to avoid browser CORS preflight mismatches.
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

  // Verify the JWT against GoTrue directly.
  // Using `supabaseAdmin.auth.getUser(token)` can be unreliable when the client is
  // created with the service role key (the request might still be authenticated
  // as the service role instead of the provided user JWT).
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  // GoTrue accepts an `apikey` header for the project. Prefer anon key for auth verification.
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
    // If this throws, we still must return CORS headers to avoid browser masking the real error.
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

function safeExcerpt(text?: string, max = 300) {
  if (!text) {
    return null;
  }
  return text.length <= max ? text : text.slice(0, max);
}

async function updateRun(runId: string, partial: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from('scrape_runs').update(partial).eq('id', runId);
  if (error) {
    throw error;
  }
}

async function syncRunProgress(runId: string, summary: PipelineSummary) {
  await updateRun(runId, {
    status: 'running',
    profiles_processed: summary.profilesProcessed,
    posts_found: summary.postsFound,
    new_posts_scraped: summary.newPostsScraped,
    comments_collected: summary.commentsCollected,
    new_unique_authors: summary.newUniqueAuthors,
    crm_pushes_succeeded: summary.crmPushesSucceeded,
    crm_pushes_failed: summary.crmPushesFailed,
    error_log: summary.errorLog,
  });
}

async function sendAuthorToHook(summary: PipelineSummary, hook: ZapierHookRow, author: ScrapedAuthorRow, existingFailureCount = 0) {
  const deliveryResult = await pushLeadToCrm(
    {
      first_name: author.first_name,
      last_name: author.last_name,
      linkedin_url: author.linkedin_profile_url,
      lead_source: `LinkedIn Comment Scraper (${hook.name})`,
      comment_text: author.comment_text?.slice(0, 500) ?? null,
      source_post_url: author.source_post_url,
      source_leader_name: author.source_leader_profile_url,
      source_profile_url: author.source_leader_profile_url,
      date_discovered: author.created_at,
    },
    {
      endpoint: hook.webhook_url,
      apiKey: hook.api_key,
      authHeader: hook.auth_header,
    },
  );

  if (deliveryResult.ok) {
    summary.crmPushesSucceeded += 1;
    await supabaseAdmin.from('zapier_hook_deliveries').upsert(
      {
        hook_id: hook.id,
        author_id: author.id,
        status: 'pushed',
        failure_count: 0,
        error: null,
        pushed_at: new Date().toISOString(),
      },
      { onConflict: 'hook_id,author_id' },
    );

    await supabaseAdmin.from('scraped_authors').update({
      crm_push_status: 'pushed',
      crm_pushed_at: new Date().toISOString(),
      crm_record_id: deliveryResult.crmRecordId,
      crm_error: null,
      crm_failure_count: 0,
    }).eq('id', author.id);

    return;
  }

  summary.crmPushesFailed += 1;
  const nextFailureCount = existingFailureCount + 1;
  const status = nextFailureCount >= 3 ? 'skipped' : 'failed';

  await supabaseAdmin.from('zapier_hook_deliveries').upsert(
    {
      hook_id: hook.id,
      author_id: author.id,
      status,
      failure_count: nextFailureCount,
      error: deliveryResult.error ?? 'Unknown webhook error',
      pushed_at: null,
    },
    { onConflict: 'hook_id,author_id' },
  );

  await supabaseAdmin.from('scraped_authors').update({
    crm_push_status: status,
    crm_error: deliveryResult.error,
    crm_failure_count: nextFailureCount,
  }).eq('id', author.id);
}

async function processFailedHookRetries(summary: PipelineSummary, hooks: ZapierHookRow[]) {
  for (const hook of hooks) {
    const { data: failedDeliveries, error: deliveryError } = await supabaseAdmin
      .from('zapier_hook_deliveries')
      .select('author_id, failure_count, status')
      .eq('hook_id', hook.id)
      .eq('status', 'failed')
      .lt('failure_count', 3)
      .limit(500);

    const typedFailedDeliveries = (failedDeliveries ?? []) as DeliveryRow[];

    if (deliveryError || typedFailedDeliveries.length === 0) {
      continue;
    }

    const authorIds = typedFailedDeliveries.map((row) => row.author_id);
    const { data: retryAuthors, error: retryAuthorError } = await supabaseAdmin
      .from('scraped_authors')
      .select('id, linkedin_profile_url, first_name, last_name, comment_text, source_post_url, source_leader_profile_url, created_at')
      .in('id', authorIds);

    if (retryAuthorError || !retryAuthors?.length) {
      continue;
    }

    const failureCountByAuthorId = new Map<string, number>(typedFailedDeliveries.map((row) => [row.author_id, row.failure_count]));

    for (const author of retryAuthors as ScrapedAuthorRow[]) {
      const existingFailureCount: number = failureCountByAuthorId.get(author.id) ?? 0;
      await sendAuthorToHook(summary, hook, author, existingFailureCount);
    }
  }
}

async function processHookLookbackDeliveries(summary: PipelineSummary, hooks: ZapierHookRow[]) {
  for (const hook of hooks) {
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - Math.max(1, hook.lookback_days));

    const { data: authorsInWindow, error: authorsError } = await supabaseAdmin
      .from('scraped_authors')
      .select('id, linkedin_profile_url, first_name, last_name, comment_text, source_post_url, source_leader_profile_url, created_at')
      .gte('created_at', lookbackDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(1000);

    const typedAuthorsInWindow = (authorsInWindow ?? []) as ScrapedAuthorRow[];

    if (authorsError || typedAuthorsInWindow.length === 0) {
      continue;
    }

    const authorIds = typedAuthorsInWindow.map((author) => author.id);
    const { data: existingDeliveries, error: deliveriesError } = await supabaseAdmin
      .from('zapier_hook_deliveries')
      .select('author_id, status, failure_count')
      .eq('hook_id', hook.id)
      .in('author_id', authorIds);

    if (deliveriesError) {
      continue;
    }

    const typedExistingDeliveries = (existingDeliveries ?? []) as DeliveryRow[];
    const existingByAuthorId = new Map<string, DeliveryRow>(typedExistingDeliveries.map((delivery) => [delivery.author_id, delivery]));

    for (const author of typedAuthorsInWindow) {
      const existing = existingByAuthorId.get(author.id);

      if (existing?.status === 'pushed' || existing?.status === 'skipped') {
        continue;
      }

      if (existing?.status === 'failed') {
        continue;
      }

      await sendAuthorToHook(summary, hook, author, existing?.failure_count ?? 0);
    }
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
    await supabaseAdmin.rpc('release_run_lock').catch(() => null);
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

  await supabaseAdmin.rpc('release_run_lock').catch(() => null);
}

serve(async (req) => {
  // These must be declared outside the try block so the catch handler can
  // safely reference them (otherwise the function can crash before returning
  // JSON with CORS headers).
  let runId = '';
  const summary: PipelineSummary = {
    profilesProcessed: 0,
    postsFound: 0,
    newPostsScraped: 0,
    commentsCollected: 0,
    newUniqueAuthors: 0,
    crmPushesSucceeded: 0,
    crmPushesFailed: 0,
    errorLog: [],
  };

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

    const [{ data: config, error: configError }, { data: profiles, error: profileError }, { data: hooks, error: hooksError }] = await Promise.all([
      supabaseAdmin.from('system_config').select('*').eq('id', true).single(),
      profileQuery,
      supabaseAdmin.from('zapier_hooks').select('id, name, webhook_url, auth_header, api_key, lookback_days, is_active').eq('is_active', true),
    ]);

    if (configError || !config) {
      throw configError ?? new Error('Missing system config row');
    }

    if (profileError) {
      throw profileError;
    }

    if (requestedProfileId && (!profiles || profiles.length === 0)) {
      throw new Error('Requested profile is missing or inactive');
    }

    if (hooksError) {
      throw hooksError;
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

    await processFailedHookRetries(summary, (hooks ?? []) as ZapierHookRow[]);
    await syncRunProgress(runId, summary);

    for (const profile of profiles ?? []) {
      summary.profilesProcessed += 1;
      await syncRunProgress(runId, summary);

      const posts = await scrapeProfilePosts(profile.profile_url, {
        ...apifyConfig,
        maxPostsPerProfile: profile.max_posts_per_run ?? 100,
      });

      summary.postsFound += posts.length;
      await syncRunProgress(runId, summary);

      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - (profile.post_lookback_days ?? 30));

      for (const post of posts) {
        if (!post.url) {
          continue;
        }

        const postedAt = post.posted_at?.timestamp ? new Date(post.posted_at.timestamp).toISOString() : null;
        if (postedAt && new Date(postedAt) < lookbackDate) {
          continue;
        }

        const { data: existingPost } = await supabaseAdmin
          .from('scraped_posts')
          .select('id, comments_scraped')
          .eq('post_url', post.url)
          .maybeSingle();

        if (existingPost?.comments_scraped) {
          continue;
        }

        if (!existingPost) {
          const { error: postInsertError } = await supabaseAdmin
            .from('scraped_posts')
            .insert({
              post_url: post.url,
              source_profile_url: profile.profile_url,
              post_text_excerpt: safeExcerpt(post.text),
              posted_at: postedAt,
              total_comments: post.stats?.comments ?? null,
              comments_scraped: false,
              first_seen_run_id: runId,
            });

          if (postInsertError) {
            summary.errorLog.push({ stage: 'insert_post', postUrl: post.url, message: postInsertError.message });
            await syncRunProgress(runId, summary);
            continue;
          }
        }

        summary.newPostsScraped += 1;
        await syncRunProgress(runId, summary);
        const comments = await scrapePostComments(post.url, {
          ...apifyConfig,
        });

        summary.commentsCollected += comments.length;
        await syncRunProgress(runId, summary);

        for (const comment of comments) {
          const authorUrl = comment.author?.profileUrl;
          if (!authorUrl) {
            continue;
          }

          const { error: authorInsertError } = await supabaseAdmin
            .from('scraped_authors')
            .insert({
              linkedin_profile_url: authorUrl,
              linkedin_profile_id: comment.author?.id ?? null,
              full_name: comment.author?.name ?? null,
              first_name: comment.author?.firstName ?? null,
              last_name: comment.author?.lastName ?? null,
              comment_text: comment.text ?? null,
              source_post_url: post.url,
              source_leader_profile_url: profile.profile_url,
              first_seen_run_id: runId,
              crm_push_status: 'pending',
            });

          if (authorInsertError) {
            if (authorInsertError.code === '23505') {
              continue;
            }
            summary.errorLog.push({
              stage: 'insert_author',
              profileUrl: authorUrl,
              message: authorInsertError.message,
            });
            await syncRunProgress(runId, summary);
            continue;
          }

          summary.newUniqueAuthors += 1;
          await syncRunProgress(runId, summary);

          await supabaseAdmin
            .from('scraped_authors')
            .update({
              crm_push_status: 'pending',
              crm_error: null,
            })
            .eq('linkedin_profile_url', authorUrl);
        }

        await supabaseAdmin
          .from('scraped_posts')
          .update({ comments_scraped: true })
          .eq('post_url', post.url);
      }

      await supabaseAdmin
        .from('tracked_profiles')
        .update({ last_scraped_at: new Date().toISOString() })
        .eq('id', profile.id);

      await syncRunProgress(runId, summary);
    }

    await processHookLookbackDeliveries(summary, (hooks ?? []) as ZapierHookRow[]);
    await syncRunProgress(runId, summary);

    await updateRun(runId, {
      completed_at: new Date().toISOString(),
      status: 'completed',
      profiles_processed: summary.profilesProcessed,
      posts_found: summary.postsFound,
      new_posts_scraped: summary.newPostsScraped,
      comments_collected: summary.commentsCollected,
      new_unique_authors: summary.newUniqueAuthors,
      crm_pushes_succeeded: summary.crmPushesSucceeded,
      crm_pushes_failed: summary.crmPushesFailed,
      error_log: summary.errorLog,
    });

    return jsonResponse({ runId, status: 'completed', summary });
  } catch (error) {
    // This catches any unexpected runtime error so the client still receives CORS headers.
    if (runId) {
      await updateRun(runId, {
        completed_at: new Date().toISOString(),
        status: 'failed',
        profiles_processed: summary.profilesProcessed,
        posts_found: summary.postsFound,
        new_posts_scraped: summary.newPostsScraped,
        comments_collected: summary.commentsCollected,
        new_unique_authors: summary.newUniqueAuthors,
        crm_pushes_succeeded: summary.crmPushesSucceeded,
        crm_pushes_failed: summary.crmPushesFailed,
        error_log: [...summary.errorLog, { stage: 'fatal', message: String(error) }],
      }).catch(() => null);
    }

    return jsonResponse({ error: String(error) }, 500);
  } finally {
    await supabaseAdmin.rpc('release_run_lock').catch(() => null);
  }
});
