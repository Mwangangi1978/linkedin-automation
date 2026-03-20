/// <reference path="./deno-shims.d.ts" />

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

async function getApifyClient(token: string) {
  const { ApifyClient } = await import('npm:apify-client@2.12.0');
  return new ApifyClient({ token });
}

function mapCommentSortOrder(sortType: ApifyRunConfig['commentSortType']) {
  // Actor expects "Most Relevant" or "Most Recent".
  return sortType === 'RECENT' ? 'Most Recent' : 'Most Relevant';
}

function profileUrlToUsername(profileUrl: string): string {
  const url = new URL(profileUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.at(-1) ?? '';
}

export async function scrapeProfilePosts(profileUrl: string, config: ApifyRunConfig, webhookUrl: string): Promise<string | null> {
  const username = profileUrlToUsername(profileUrl);
  if (!username) {
    return null;
  }

  const client = await getApifyClient(config.apifyToken);
  const run = await client.actor('apimaestro/linkedin-profile-posts').start(
    {
      username,
      page_number: 1,
      // Actor schema uses snake_case: `total_posts`.
      total_posts: config.maxPostsPerProfile,
    },
    {
      webhooks: [
        {
          eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
          requestUrl: webhookUrl,
        },
      ],
    },
  );

  return run?.id ?? null;
}

export async function scrapePostComments(postUrlsInput: string | string[], config: ApifyRunConfig, webhookUrl: string): Promise<string | null> {
  const postUrls = Array.isArray(postUrlsInput) ? postUrlsInput.filter(Boolean) : [postUrlsInput].filter(Boolean);
  if (postUrls.length === 0) {
    return null;
  }

  const client = await getApifyClient(config.apifyToken);

  const run = await client.actor('capable_cauldron~linkedin-comment-scraper').start(
    {
      postUrls,
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
      maxDatasetItems: config.maxCommentsPerPost * postUrls.length,
    },
    {
      webhooks: [
        {
          eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
          requestUrl: webhookUrl,
        },
      ],
    },
  );

  return run?.id ?? null;
}
