# SwapRight

SwapRight is a campus marketplace web app for students to give away or sell useful items to other students at their university. The project is currently a web-based campus pilot built with Next.js and Supabase.

## What students can do

- Sign up and sign in with a university email and password. Passwords are handled by Supabase Auth; SwapRight does not store them itself.
- Apple and Google sign-in options are present in the interface; configure the matching OAuth providers and redirect URLs in Supabase before using them.
- Finish a student profile with a display name and optional photo and residence information.
- Browse, search, and filter campus listings by type, category, condition, and price.
- Publish an item with a title, description, condition, category, price (if for sale), pickup location, and up to eight photos. At least one photo is required.
- Reserve an available item for 24 hours. Reserved items leave Browse, and a scheduled database task returns expired holds to availability. A student can have up to three active reservations.
- Move a reservation through Pending, Claimed, and Cancelled history. The receiver can request handoff confirmation; the donor confirms or declines before the item is marked claimed or returned to Browse.
- Message the donor after reserving the item, while the reservation is active.
- Report a listing, block another student, and manage notification preferences.
- Review reservation, message, and listing-report notices in the app. A listing-report notice does not reveal the reporter to the donor.
- Read campus safety, privacy, and pilot-support information and contact support by email.

Browser notifications can be enabled while the app is open. Background push notifications when the app is closed are not implemented yet.

## How the app is organized

The app uses the Next.js App Router. The home route checks the Supabase session and shows sign-in/sign-up when the visitor is logged out; signed-in users go to the marketplace. Supabase Auth manages identity and sessions. The browser uses a public Supabase key, while privileged operations such as account deletion and password rate limiting use a server-only secret key.

Supabase Postgres stores profiles, listings, reservations, conversations, messages, blocks, reports, and notification settings/notices. Row Level Security policies control which records authenticated users can access. Supabase Storage holds listing photos and profile photos. Database migrations define the tables, policies, storage rules, and database functions used for reserving items, confirming handoffs, expiring holds, and generating notifications. Reservation snapshots keep item details available in history if a donor removes a listing or their account.

University email recognition uses a local U.S. university domain catalog in `data/us-university-domains.json`. The browser checks that catalog through an API route. Domains ending in `.edu` also have a database fallback so a new U.S. `.edu` domain can be accepted even if it is not in the catalog yet.

## Tech stack

- Next.js 14 and React 18
- TypeScript
- Supabase Auth, Postgres, Row Level Security, and Storage
- Supabase JavaScript client with `@supabase/ssr` for browser and server sessions
- Vitest for the configured test command

## Run locally

### Requirements

- Node.js and npm
- A Supabase project
- Supabase CLI (available through `npx supabase`)

### Install and configure

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set the values below.

   | Variable | Required | Purpose |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL. |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Public browser/server client key. The older `NEXT_PUBLIC_SUPABASE_ANON_KEY` name is also accepted. |
   | `SUPABASE_SECRET_KEY` | Yes for server operations | Server-only Supabase key used by password rate limiting and account deletion. The older `SUPABASE_SERVICE_ROLE_KEY` name is also accepted. **Never expose or commit this key.** |
   | `RATE_LIMIT_HASH_SECRET` | Yes for password sign-in/sign-up | A long, random secret used to hash rate-limit identifiers. Keep it server-side. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Optional | Cloudflare Turnstile site key. Set this together with the secret key. |
| `TURNSTILE_SECRET_KEY` | Optional | Turnstile server key. If configured, password sign-in/sign-up requires a valid challenge response. |

3. In Supabase Auth, enable email/password sign-up. If new students should go directly to profile setup, turn off **Confirm email** in the Supabase Auth settings. When confirmation is enabled, Supabase requires email confirmation before the app can finish the password flow.

4. Apply the database migrations to your linked Supabase project:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push --dry-run
   npx supabase db push
   ```

   Check that the project reference is the intended one before applying migrations. The migration files are in `supabase/migrations/`.

5. Start the development server:

   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000).

## Useful commands

```bash
npm run dev          # Start the local development server
npm run lint         # Run Next.js lint checks
npm run typecheck    # Run TypeScript without emitting files
npm run test         # Run the Vitest suite
npm run build        # Create a production build
npm run start        # Serve the production build
```

Create a migration when changing the database schema or policies:

```bash
npx supabase migration new describe_the_change
```

Edit the new SQL file, then preview and apply it with `npx supabase db push --dry-run` and `npx supabase db push`.

## Project layout

```text
app/
  api/                  Server API routes for account and authentication actions
  auth/callback/        OAuth callback route
  marketplace/          Authenticated marketplace route
  page.tsx              Session-aware home and sign-in route
  layout.tsx            Shared document metadata and global styles
components/
  auth-flow.tsx         Sign-up, sign-in, and profile setup screens
  marketplace-shell.tsx Browse, listing details, reservations, inbox, and profile screens
  icons.tsx             Shared inline SVG icons
lib/
  security.ts           Rate-limit hashing, request IP, and optional Turnstile check
  university-domains.ts Domain lookup helpers
  supabase/             Browser, server, and admin Supabase clients
supabase/
  migrations/           Database schema and policy changes, applied in timestamp order
  seed/                 University domain CSV source
  tests/                SQL checks for database access rules
data/
  us-university-domains.json  University domain catalog used by the app
```

## Security notes

- Never commit `.env.local`, Supabase secret/service-role keys, database passwords, or other credentials.
- Keep `NEXT_PUBLIC_` variables limited to values intended to be visible to browsers.
- Keep access rules in Supabase Row Level Security policies; do not rely on hiding UI controls as authorization.
- Make database changes through reviewed migration files so local and hosted schemas can stay in sync.
