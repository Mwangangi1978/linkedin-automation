# run-pipeline Edge Function

This is the only scraping orchestration function used by the app.

Function name: `run-pipeline`
Frontend caller: `src/lib/api.ts` via `supabase.functions.invoke()`

## What it does (step by step)

1. **Handles CORS and method checks**
   - Accepts `POST` requests.
   - Responds to `OPTIONS` preflight requests.

2. **Validates user session**
   - Reads `Authorization: Bearer <token>`.
   - Uses Supabase Admin auth to verify the user.
   - Returns `401` if session is missing/expired.

3. **Parses trigger input**
   - Reads `triggeredBy` (`manual` or `schedule`).
   - Optionally reads `profileId` to run one profile.

4. **Recovers stale lock state**
   - If `system_config.run_lock = true` but no active `scrape_runs` row exists, it releases the lock.
   - If a `running` run is stale (older than timeout), it marks it `failed` and releases lock.

5. **Acquires run lock**
   - Calls `acquire_run_lock()`.
   - Returns `409` if another run is truly active.

6. **Creates run record**
   - Inserts a new row in `scrape_runs` with `status = running`.
   - Tracks progress counters in this row throughout execution.

7. **Loads configuration and active profiles**
   - Reads `system_config` (Apify token, LinkedIn cookies, delays, limits).
   - Reads active `tracked_profiles` (or requested profile only).
   - Reads active `zapier_hooks`.

8. **Retries failed CRM deliveries first**
   - Re-attempts prior failed hook deliveries with retry limits.

9. **Scrapes profile posts (Apify)**
   - Uses `apimaestro/linkedin-profile-posts` to collect post URLs per tracked profile.

10. **Scrapes comments for each new post (Apify)**
    - Uses `capable_cauldron~linkedin-comment-scraper`.
    - Normalizes returned comment shape.

11. **Stores posts and deduplicated authors**
    - Inserts post rows into `scraped_posts` if not already processed.
    - Inserts authors into `scraped_authors` with dedup handling.

12. **Pushes net-new leads to CRM hooks**
    - Sends payloads to active hook endpoints.
    - Tracks delivery outcomes and retry counts.

13. **Finalizes run**
    - Marks `scrape_runs.status` as `completed` or `failed`.
    - Stores summary metrics and error log.

14. **Releases lock always**
    - Calls `release_run_lock()` in `finally`, even on errors.

## Why this prevents stuck runs

- Lock is self-healed before acquiring.
- Run status is finalized on both success and failure.
- Lock release is in a `finally` block.

## Required config/state

- `system_config` row exists (`id = true`)
- `apify_token`
- `linkedin_cookies`
- `linkedin_user_agent`
- Active `tracked_profiles`

## Common error meanings

- `409`: another run is currently active.
- `401`: missing or invalid Supabase session token.
- `500`: fatal scrape/config/runtime error; check `scrape_runs.error_log`.
