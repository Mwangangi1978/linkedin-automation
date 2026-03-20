/// <reference path="../_shared/deno-shims.d.ts" />
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { scrapePostComments } from '../_shared/apify.ts';
import { pushLeadToCrm } from '../_shared/crm.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import type { ApifyCommentItem, PipelineSummary } from '../_shared/types.ts';

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

interface TrackedProfileRow {
  id: string;
  profile_url: string;
  post_lookback_days: number | null;
}

interface ApifyWebhookPayload {
  eventType?: string;
  resource?: {
    id?: string;
    defaultDatasetId?: string;
  };
}

const APIFY_WEBHOOK_BASE_URL = 'https://nygeylpqjtxigxzhgaen.supabase.co/functions/v1/process-apify-webhook';

const responseHeaders = {
  'content-type': 'application/json',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function safeExcerpt(text?: string, max = 300) {
  if (!text) {
    return null;
  }
  return text.length <= max ? text : text.slice(0, max);
}

function toNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function buildSummaryFromRunRow(runRow: Record<string, unknown> | null): PipelineSummary {
  return {
    profilesProcessed: toNumber(runRow?.profiles_processed),
    postsFound: toNumber(runRow?.posts_found),
    newPostsScraped: toNumber(runRow?.new_posts_scraped),
    commentsCollected: toNumber(runRow?.comments_collected),
    newUniqueAuthors: toNumber(runRow?.new_unique_authors),
    crmPushesSucceeded: toNumber(runRow?.crm_pushes_succeeded),
    crmPushesFailed: toNumber(runRow?.crm_pushes_failed),
    errorLog: Array.isArray(runRow?.error_log) ? (runRow?.error_log as Array<Record<string, unknown>>) : [],
  };
}

function normalizeCommentItem(item: Record<string, unknown>): ApifyCommentItem {
  const author = (item.author as Record<string, unknown> | undefined) ??
    (item.commenter as Record<string, unknown> | undefined) ??
    {};

  const profileUrl =
    (author.profileUrl as string | undefined) ??
    (author.profile_url as string | undefined) ??
    (item.authorProfileUrl as string | undefined) ??
    (item.author_profile_url as string | undefined) ??
    (item.commenterProfileUrl as string | undefined) ??
    (item.profileUrl as string | undefined) ??
    (item.profile_url as string | undefined);

  return {
    text:
      (item.text as string | undefined) ??
      (item.commentText as string | undefined) ??
      (item.comment as string | undefined) ??
      (item.content as string | undefined),
    author: {
      profileUrl,
      id: (author.id as string | undefined) ?? (item.authorId as string | undefined),
      name:
        (author.name as string | undefined) ??
        (item.authorName as string | undefined) ??
        (item.commenterName as string | undefined),
      firstName:
        (author.firstName as string | undefined) ??
        (author.first_name as string | undefined) ??
        (item.authorFirstName as string | undefined),
      lastName:
        (author.lastName as string | undefined) ??
        (author.last_name as string | undefined) ??
        (item.authorLastName as string | undefined),
    },
  };
}

function extractCommentPostUrl(item: Record<string, unknown>): string | null {
  const postUrl =
    (item.postUrl as string | undefined) ??
    (item.post_url as string | undefined) ??
    (item.url as string | undefined) ??
    (item.sourcePostUrl as string | undefined);
  return typeof postUrl === 'string' && postUrl.trim() ? postUrl.trim() : null;
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

async function releaseRunLock() {
  const { error } = await supabaseAdmin.rpc('release_run_lock');
  if (error) {
    console.error('Failed to release run lock', error);
  }
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
      const existingFailureCount = failureCountByAuthorId.get(author.id) ?? 0;
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

async function markRunFailed(runId: string, summary: PipelineSummary, message: string) {
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
    error_log: [...summary.errorLog, { stage: 'fatal', message }],
  });
}

async function getApifyConfig() {
  const { data: config, error } = await supabaseAdmin.from('system_config').select('*').eq('id', true).single();
  if (error || !config) {
    throw error ?? new Error('Missing system config row');
  }

  if (!config.apify_token || !config.linkedin_cookies || !config.linkedin_user_agent) {
    throw new Error('Missing Apify or LinkedIn credentials in settings');
  }

  return {
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
}

async function getApifyClient(token: string) {
  const { ApifyClient } = await import('npm:apify-client@2.12.0');
  return new ApifyClient({ token });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: true, ignored: 'Method not allowed for webhook' }, 200);
  }

  if (!supabaseAdmin) {
    return jsonResponse({ ok: true, error: 'supabaseAdmin unavailable' }, 200);
  }

  try {
    const url = new URL(req.url);
    const runId = url.searchParams.get('runId');
    const stage = url.searchParams.get('stage');
    const profileId = url.searchParams.get('profileId');

    if (!runId || !stage) {
      return jsonResponse({ ok: true, ignored: 'Missing runId or stage' }, 200);
    }

    const payload = (await req.json()) as ApifyWebhookPayload;

    const { data: runRow } = await supabaseAdmin
      .from('scrape_runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle();

    const summary = buildSummaryFromRunRow((runRow ?? null) as Record<string, unknown> | null);

    if (payload.eventType === 'ACTOR.RUN.FAILED') {
      await markRunFailed(runId, summary, `Apify actor failed for stage=${stage}`);
      await releaseRunLock();
      return jsonResponse({ ok: true, runId, stage, status: 'failed' }, 200);
    }

    if (payload.eventType !== 'ACTOR.RUN.SUCCEEDED') {
      return jsonResponse({ ok: true, runId, stage, ignored: payload.eventType ?? 'unknown' }, 200);
    }

    const datasetId = payload.resource?.defaultDatasetId;
    if (!datasetId) {
      await markRunFailed(runId, summary, `Missing dataset id for stage=${stage}`);
      await releaseRunLock();
      return jsonResponse({ ok: true, runId, stage, status: 'failed' }, 200);
    }

    const apifyConfig = await getApifyConfig();
    const client = await getApifyClient(apifyConfig.apifyToken);
    const runDataset = client.dataset(datasetId);
    const { items } = await runDataset.listItems();

    const effectiveProfileId = profileId || ((runRow as Record<string, unknown> | null)?.requested_profile_id as string | null) || null;
    let profile: TrackedProfileRow | null = null;

    if (effectiveProfileId) {
      const { data: profileRow } = await supabaseAdmin
        .from('tracked_profiles')
        .select('id, profile_url, post_lookback_days')
        .eq('id', effectiveProfileId)
        .maybeSingle();

      profile = (profileRow ?? null) as TrackedProfileRow | null;
    }

    if (stage === 'posts') {
      summary.profilesProcessed += 1;
      summary.postsFound += items.length;

      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - (profile?.post_lookback_days ?? 30));

      const commentPostUrls: string[] = [];

      for (const rawItem of items as Array<Record<string, unknown>>) {
        const postUrl = rawItem.url as string | undefined;
        if (!postUrl) {
          continue;
        }

        const timestamp = (rawItem.posted_at as Record<string, unknown> | undefined)?.timestamp;
        const postedAt = typeof timestamp === 'number' ? new Date(timestamp).toISOString() : null;

        if (postedAt && new Date(postedAt) < lookbackDate) {
          continue;
        }

        const { data: existingPost } = await supabaseAdmin
          .from('scraped_posts')
          .select('id, comments_scraped')
          .eq('post_url', postUrl)
          .maybeSingle();

        if (existingPost?.comments_scraped) {
          continue;
        }

        if (!existingPost) {
          const stats = (rawItem.stats as Record<string, unknown> | undefined) ?? {};
          const { error: postInsertError } = await supabaseAdmin
            .from('scraped_posts')
            .insert({
              post_url: postUrl,
              source_profile_url: profile?.profile_url ?? null,
              post_text_excerpt: safeExcerpt(rawItem.text as string | undefined),
              posted_at: postedAt,
              total_comments: (stats.comments as number | undefined) ?? null,
              comments_scraped: false,
              first_seen_run_id: runId,
            });

          if (postInsertError) {
            summary.errorLog.push({ stage: 'insert_post', postUrl, message: postInsertError.message });
            continue;
          }
        }

        summary.newPostsScraped += 1;
        commentPostUrls.push(postUrl);
      }

      if (profile?.id) {
        await supabaseAdmin
          .from('tracked_profiles')
          .update({ last_scraped_at: new Date().toISOString() })
          .eq('id', profile.id);
      }

      await syncRunProgress(runId, summary);

      if (commentPostUrls.length > 0) {
        const commentsWebhookUrl = `${APIFY_WEBHOOK_BASE_URL}?runId=${encodeURIComponent(runId)}&stage=comments${profile?.id ? `&profileId=${encodeURIComponent(profile.id)}` : ''}`;
        await scrapePostComments(commentPostUrls, apifyConfig, commentsWebhookUrl);
      } else {
        const { data: hooks } = await supabaseAdmin
          .from('zapier_hooks')
          .select('id, name, webhook_url, auth_header, api_key, lookback_days, is_active')
          .eq('is_active', true);

        await processFailedHookRetries(summary, (hooks ?? []) as ZapierHookRow[]);
        await processHookLookbackDeliveries(summary, (hooks ?? []) as ZapierHookRow[]);

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

        await releaseRunLock();
      }

      return jsonResponse({ ok: true, runId, stage, datasetId }, 200);
    }

    if (stage === 'comments') {
      summary.commentsCollected += items.length;

      const touchedPostUrls = new Set<string>();
      for (const rawItem of items as Array<Record<string, unknown>>) {
        const normalizedComment = normalizeCommentItem(rawItem);
        const authorUrl = normalizedComment.author?.profileUrl;

        const sourcePostUrl = extractCommentPostUrl(rawItem);
        if (sourcePostUrl) {
          touchedPostUrls.add(sourcePostUrl);
        }

        if (!authorUrl) {
          continue;
        }

        const { error: authorInsertError } = await supabaseAdmin
          .from('scraped_authors')
          .insert({
            linkedin_profile_url: authorUrl,
            linkedin_profile_id: normalizedComment.author?.id ?? null,
            full_name: normalizedComment.author?.name ?? null,
            first_name: normalizedComment.author?.firstName ?? null,
            last_name: normalizedComment.author?.lastName ?? null,
            comment_text: normalizedComment.text ?? null,
            source_post_url: sourcePostUrl,
            source_leader_profile_url: profile?.profile_url ?? null,
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
          continue;
        }

        summary.newUniqueAuthors += 1;

        await supabaseAdmin
          .from('scraped_authors')
          .update({
            crm_push_status: 'pending',
            crm_error: null,
          })
          .eq('linkedin_profile_url', authorUrl);
      }

      for (const postUrl of touchedPostUrls) {
        await supabaseAdmin
          .from('scraped_posts')
          .update({ comments_scraped: true })
          .eq('post_url', postUrl);
      }

      const { data: hooks } = await supabaseAdmin
        .from('zapier_hooks')
        .select('id, name, webhook_url, auth_header, api_key, lookback_days, is_active')
        .eq('is_active', true);

      await processFailedHookRetries(summary, (hooks ?? []) as ZapierHookRow[]);
      await processHookLookbackDeliveries(summary, (hooks ?? []) as ZapierHookRow[]);

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

      await releaseRunLock();

      return jsonResponse({ ok: true, runId, stage, datasetId }, 200);
    }

    summary.errorLog.push({ stage: 'webhook', message: `Unsupported stage ${stage}` });
    await syncRunProgress(runId, summary);
    return jsonResponse({ ok: true, runId, stage, ignored: 'Unsupported stage' }, 200);
  } catch (error) {
    console.error('process-apify-webhook error', error);
    return jsonResponse({ ok: true, error: String(error) }, 200);
  }
});
