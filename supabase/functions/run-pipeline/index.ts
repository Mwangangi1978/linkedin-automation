/// <reference path="../_shared/deno-shims.d.ts" />
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { scrapePostComments, scrapeProfilePosts } from '../_shared/apify.ts';
import { pushLeadToCrm } from '../_shared/crm.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import type { PipelineSummary, TriggerMode } from '../_shared/types.ts';

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

async function processFailedCrmRetries(summary: PipelineSummary, crmConfig: { endpoint?: string | null; apiKey?: string | null; authHeader?: string | null; }) {
  const { data: failedRows, error } = await supabaseAdmin
    .from('scraped_authors')
    .select('id, linkedin_profile_url, first_name, last_name, comment_text, source_post_url, source_leader_profile_url, created_at, crm_failure_count, crm_record_id')
    .eq('crm_push_status', 'failed')
    .lt('crm_failure_count', 3)
    .is('crm_record_id', null)
    .limit(500);

  if (error || !failedRows?.length) {
    return;
  }

  for (const row of failedRows) {
    const crmResult = await pushLeadToCrm(
      {
        first_name: row.first_name,
        last_name: row.last_name,
        linkedin_url: row.linkedin_profile_url,
        lead_source: 'LinkedIn Comment Scraper',
        comment_text: row.comment_text?.slice(0, 500) ?? null,
        source_post_url: row.source_post_url,
        source_leader_name: row.source_leader_profile_url,
        source_profile_url: row.source_leader_profile_url,
        date_discovered: row.created_at,
      },
      crmConfig,
    );

    if (crmResult.ok) {
      summary.crmPushesSucceeded += 1;
      await supabaseAdmin.from('scraped_authors').update({
        crm_push_status: 'pushed',
        crm_pushed_at: new Date().toISOString(),
        crm_record_id: crmResult.crmRecordId,
        crm_error: null,
      }).eq('id', row.id);
    } else {
      summary.crmPushesFailed += 1;
      const nextFailureCount = row.crm_failure_count + 1;
      await supabaseAdmin.from('scraped_authors').update({
        crm_push_status: nextFailureCount >= 3 ? 'skipped' : 'failed',
        crm_error: crmResult.error,
        crm_failure_count: nextFailureCount,
      }).eq('id', row.id);
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

    const [{ data: config, error: configError }, { data: profiles, error: profileError }] = await Promise.all([
      supabaseAdmin.from('system_config').select('*').eq('id', true).single(),
      supabaseAdmin.from('tracked_profiles').select('*').eq('is_active', true),
    ]);

    if (configError || !config) {
      throw configError ?? new Error('Missing system config row');
    }

    if (profileError) {
      throw profileError;
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

    const crmConfig = {
      endpoint: config.crm_endpoint,
      apiKey: config.crm_api_key,
      authHeader: config.crm_auth_header,
    };

    await processFailedCrmRetries(summary, crmConfig);

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

          const crmResult = await pushLeadToCrm(
            {
              first_name: comment.author?.firstName ?? null,
              last_name: comment.author?.lastName ?? null,
              linkedin_url: authorUrl,
              lead_source: 'LinkedIn Comment Scraper',
              comment_text: comment.text?.slice(0, 500) ?? null,
              source_post_url: post.url,
              source_leader_name: profile.display_name ?? profile.profile_url,
              source_profile_url: profile.profile_url,
              date_discovered: new Date().toISOString(),
            },
            crmConfig,
          );

          if (crmResult.ok) {
            summary.crmPushesSucceeded += 1;
            await supabaseAdmin
              .from('scraped_authors')
              .update({
                crm_push_status: 'pushed',
                crm_pushed_at: new Date().toISOString(),
                crm_record_id: crmResult.crmRecordId,
                crm_error: null,
              })
              .eq('linkedin_profile_url', authorUrl);
          } else {
            summary.crmPushesFailed += 1;
            await supabaseAdmin
              .from('scraped_authors')
              .update({
                crm_push_status: 'failed',
                crm_error: crmResult.error,
                crm_failure_count: 1,
              })
              .eq('linkedin_profile_url', authorUrl);
          }
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
