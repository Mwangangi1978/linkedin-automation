declare module 'https://deno.land/std@0.224.0/http/server.ts' {
  export function serve(handler: (request: Request) => Response | Promise<Response>): void;
}

declare module 'https://esm.sh/apify-client@2.12.0' {
  export class ApifyClient {
    constructor(options: { token: string });
    actor(name: string): {
      call(input: unknown): Promise<{ defaultDatasetId?: string | null }>;
      start(
        input: unknown,
        options?: {
          webhooks?: Array<{
            eventTypes: string[];
            requestUrl: string;
          }>;
        },
      ): Promise<{ id?: string | null; defaultDatasetId?: string | null }>;
    };
    dataset(id: string): {
      iterateItems(): AsyncIterable<unknown>;
      listItems(): Promise<{ items: unknown[] }>;
    };
  }
}

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};
