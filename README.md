# SwapRight Web

Next.js web app for the SwapRight campus marketplace pilot.

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase project URL and publishable key (the legacy anon-key name is also supported).
3. In Supabase Auth, enable email OTP and configure the email template.
4. Run `npm run dev`.

The auth flow accepts recognized U.S. university `.edu` domains from `data/us-university-domains.json` and falls back to `.edu` syntax for institutions not yet in the catalog. Profile data belongs in the RLS-protected `profiles` table; the browser only holds the public Supabase key.

The database foundation is in `supabase/migrations/20261018000000_swapright_foundation.sql`, with the domain catalog in `supabase/seed/us_university_domains.csv`. The production schema has been applied to the connected Supabase project; the catalog file is ready for a Supabase SQL/CLI seed operation.

## GitHub CI/CD

`.github/workflows/ci-cd.yml` runs lint, typecheck, tests, and a production build for pull requests and pushes to `main`. The Vercel deployment job runs after verification when `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` are configured as GitHub Actions secrets. Database migrations are available through the workflow's manual `workflow_dispatch` action after `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` are configured.

Do not commit `.env.local` or any Supabase secret/service-role key.
Mobile IOS version of SwapRight
