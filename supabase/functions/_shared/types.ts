export type TriggerMode = 'manual' | 'schedule';

export interface ApifyPostItem {
  url?: string;
  text?: string;
  posted_at?: {
    timestamp?: number;
  };
  stats?: {
    comments?: number;
  };
  author?: {
    profile_url?: string;
  };
  pagination_token?: string;
}

export interface ApifyCommentItem {
  text?: string;
  author?: {
    profileUrl?: string;
    id?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
  };
}

export interface PipelineSummary {
  profilesProcessed: number;
  postsFound: number;
  newPostsScraped: number;
  commentsCollected: number;
  newUniqueAuthors: number;
  crmPushesSucceeded: number;
  crmPushesFailed: number;
  errorLog: Array<Record<string, unknown>>;
}
