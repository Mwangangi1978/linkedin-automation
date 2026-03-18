# LinkedIn Engagement Scraper & Lead Pipeline

React + Supabase + Apify implementation for:

1. Scraping posts from tracked LinkedIn profiles
2. Scraping comments from new posts
3. Deduplicating authors in Supabase
4. Delivering net-new leads to CRM

## Stack

- Frontend: React + Vite + TypeScript
- Database/Auth/Functions: Supabase
- Scraping: Apify actors
  - `apimaestro/linkedin-profile-posts-scraper`
  - `curious_coder/linkedin-comment-scraper`

## Project Structure

- `src/` React dashboard (workflow builder, tracked profiles, leads, runs, settings)
- `supabase/migrations/` SQL schema and dedup constraints
- `supabase/functions/run-pipeline/` orchestration function (Apify -> Supabase -> CRM)

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Set env vars in `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (preferred)
- `VITE_SUPABASE_PUBLISHABLE_KEY` (fallback)
- `VITE_SUPABASE_ANON_KEY` (fallback)

If you change `.env` while the dev server is running, restart `npm run dev`.

4. Run app:

```bash
npm run dev
```

## Supabase Setup

Run all SQL files in `supabase/migrations/` in filename order.

This creates:

- `tracked_profiles`
- `scrape_runs`
- `scraped_posts`
- `scraped_authors` (unique constraint on `linkedin_profile_url`)
- `system_config`
- run lock functions `acquire_run_lock` / `release_run_lock`

## Edge Function

Deploy `supabase/functions/run-pipeline` with secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Deploy command (important for browser-triggered runs from `http://localhost:5173`):

```bash
supabase functions deploy run-pipeline --no-verify-jwt
```

Why: browser preflight `OPTIONS` requests do not include your user JWT; disabling gateway JWT verification avoids preflight `401`/`403` CORS failures. The function still validates bearer tokens on `POST` internally.

The function:

- acquires run lock
- retries previously failed CRM pushes
- scrapes active tracked profiles
- skips already processed posts (`comments_scraped = true`)
- inserts authors with DB-level dedup (`UNIQUE + ON CONFLICT semantics`)
- pushes net-new leads to CRM
- writes run summary metrics to `scrape_runs`
- releases run lock

## Dashboard Pages

- `/` dashboard KPIs + Run Now
- `/workflow` workflow builder UI (matches your provided design language)
- `/tracked-profiles` tracked profile manager UI + CRUD
- `/leads` discovered authors table + CRM retry action
- `/run-history` run logs
- `/settings` Apify/LinkedIn/CRM/schedule config

## Notes

- Cookies and API keys should be managed securely through Supabase secrets/secure settings.
- `system_config` currently stores settings in one row for MVP speed; move sensitive values to encrypted secret storage in production.
