/// <reference path="../_shared/deno-shims.d.ts" />
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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

serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const body = await req.json().catch(() => ({}));
  const triggeredBy = (body?.triggeredBy ?? 'manual') as TriggerMode;

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

  const { data: lockResult, error: lockError } = await supabaseAdmin.rpc('acquire_run_lock');

  if (lockError || !lockResult) {
    return jsonResponse({ error: 'Run lock is active. Try again later.' }, 409);
  }

  let runId = '';

  try {
    const { data: run, error: runError } = await supabaseAdmin
      .from('scrape_runs')
      .insert({ triggered_by: triggeredBy, status: 'running' })
      .select('id')
      .single();

    if (runError || !run) {
      throw runError ?? new Error('Unable to create scrape run');
    }

    runId = run.id;

    const [{ data: config, error: configError }, { data: profiles, error: profileError }, { data: hooks, error: hooksError }] = await Promise.all([
      supabaseAdmin.from('system_config').select('*').eq('id', true).single(),
      supabaseAdmin.from('tracked_profiles').select('*').eq('is_active', true),
      supabaseAdmin.from('zapier_hooks').select('id, name, webhook_url, auth_header, api_key, lookback_days, is_active').eq('is_active', true),
    ]);

    if (configError || !config) {
      throw configError ?? new Error('Missing system config row');
    }

    if (profileError) {
      throw profileError;
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

    for (const profile of profiles ?? []) {
      summary.profilesProcessed += 1;

      const posts = await scrapeProfilePosts(profile.profile_url, {
        ...apifyConfig,
        maxPostsPerProfile: profile.max_posts_per_run ?? 100,
      });

      summary.postsFound += posts.length;

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
            continue;
          }
        }

        summary.newPostsScraped += 1;
        const comments = await scrapePostComments(post.url, {
          ...apifyConfig,
          maxPostsPerProfile: profile.max_posts_per_run ?? 100,
        });

        summary.commentsCollected += comments.length;

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

        await supabaseAdmin
          .from('scraped_posts')
          .update({ comments_scraped: true })
          .eq('post_url', post.url);
      }

      await supabaseAdmin
        .from('tracked_profiles')
        .update({ last_scraped_at: new Date().toISOString() })
        .eq('id', profile.id);
    }

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

    return jsonResponse({ runId, status: 'completed', summary });
  } catch (error) {
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
