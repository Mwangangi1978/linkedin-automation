import type {} from './deno-shims.d.ts';
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

function mapCommentSortOrder(sortType: ApifyRunConfig['commentSortType']) {
  // Actor expects "Most Relevant" or "Most Recent".
  return sortType === 'RECENT' ? 'Most Recent' : 'Most Relevant';
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
    page_number: 1,
    // Actor schema uses snake_case: `total_posts`.
    total_posts: config.maxPostsPerProfile,
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

  const run = await client.actor('capable_cauldron~linkedin-comment-scraper').call({
    postUrls: [postUrl],
    maxCommentsPerPost: config.maxCommentsPerPost,
    // Actor schema says 1-10.
    commentsPerRequest: Math.min(config.maxCommentsPerPost, 10),
    sortOrder: mapCommentSortOrder(config.commentSortType),
    excludeAuthorComments: false,
    cookies: config.linkedinCookies,
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
    },
    maxRetries: 3,
    requestDelayMin: config.minDelay,
    requestDelayMax: config.maxDelay,
    maxDatasetItems: config.maxCommentsPerPost,
  });

  const items: ApifyCommentItem[] = [];
  if (!run.defaultDatasetId) {
    return items;
  }

  for await (const item of client.dataset(run.defaultDatasetId).iterateItems()) {
    items.push(normalizeCommentItem(item as Record<string, unknown>));
  }

  return items;
}
