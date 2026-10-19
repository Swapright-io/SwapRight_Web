# SwapRight Web

Next.js web app for the SwapRight campus marketplace pilot.

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase project URL and anon key.
3. In Supabase Auth, enable email OTP and configure the email template.
4. Run `npm run dev`.

The auth flow is invite-oriented and accepts only `@gsumail.gram.edu` addresses. It uses Supabase email OTP, stores the initial display name and dorm/building as user metadata, and sends authenticated users to `/marketplace`.

The marketplace screen is intentionally a protected placeholder until the listings, reservations, and messaging tables are added.
Mobile IOS version of SwapRight
