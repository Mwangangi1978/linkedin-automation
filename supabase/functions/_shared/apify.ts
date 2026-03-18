import { ApifyClient } from 'npm:apify-client@2.12.0';
import type { ApifyCommentItem, ApifyPostItem } from './types.ts';

export interface ApifyRunConfig {
  apifyToken: string;
  linkedinCookies: string;
  linkedinUserAgent: string;
  proxyCountry?: string | null;
  commentSortType: 'RECENT' | 'RELEVANCE';
  minDelay: number;
  maxDelay: number;
  maxCommentsPerPost: number;
  maxPostsPerProfile: number;
}

function getApifyClient(token: string) {
  return new ApifyClient({ token });
}

function profileUrlToUsername(profileUrl: string): string {
  const url = new URL(profileUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.at(-1) ?? '';
}

export async function scrapeProfilePosts(profileUrl: string, config: ApifyRunConfig): Promise<ApifyPostItem[]> {
  const username = profileUrlToUsername(profileUrl);
  if (!username) {
    return [];
  }

  const client = getApifyClient(config.apifyToken);
  const run = await client.actor('apimaestro/linkedin-profile-posts').call({
    username,
    cookies: config.linkedinCookies,
    userAgent: config.linkedinUserAgent,
    page_number: 1,
    totalPosts: config.maxPostsPerProfile,
    proxy: {
      useApifyProxy: true,
      apifyProxyCountry: config.proxyCountry ?? 'US',
    },
  });

  const items: ApifyPostItem[] = [];
  if (!run.defaultDatasetId) {
    return items;
  }

  for await (const item of client.dataset(run.defaultDatasetId).iterateItems()) {
    items.push(item as ApifyPostItem);
  }

  return items;
}

export async function scrapePostComments(postUrl: string, config: ApifyRunConfig): Promise<ApifyCommentItem[]> {
  const client = getApifyClient(config.apifyToken);

  const run = await client.actor('curious_coder/linkedin-comment-scraper').call({
    postUrl,
    sortType: config.commentSortType,
    count: config.maxCommentsPerPost,
    cookies: config.linkedinCookies,
    userAgent: config.linkedinUserAgent,
    startPage: 1,
    minDelay: config.minDelay,
    maxDelay: config.maxDelay,
    proxy: {
      useApifyProxy: true,
      apifyProxyCountry: config.proxyCountry ?? 'US',
    },
  });

  const items: ApifyCommentItem[] = [];
  if (!run.defaultDatasetId) {
    return items;
  }

  for await (const item of client.dataset(run.defaultDatasetId).iterateItems()) {
    items.push(item as ApifyCommentItem);
  }

  return items;
}
