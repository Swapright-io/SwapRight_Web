import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findUniversityDomain } from "@/lib/university-domains";
import { hashForRateLimit, requestIp, verifyTurnstile } from "@/lib/security";

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

const localRateLimits = new Map<string, { count: number; expiresAt: number }>();

function consumeLocalRateLimit(keys: string[]): RateLimitResult {
  const now = Date.now();
  let denied = false;
  for (const key of keys) {
    const current = localRateLimits.get(key);
    const next = !current || current.expiresAt <= now ? { count: 1, expiresAt: now + 60 * 60 * 1000 } : { count: current.count + 1, expiresAt: current.expiresAt };
    localRateLimits.set(key, next);
    if (next.count > 10) denied = true;
  }
  return { allowed: !denied, retry_after_seconds: denied ? 3600 : 0 };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const deviceId = typeof body.deviceId === "string" ? body.deviceId : "unknown";
    const captchaToken = typeof body.captchaToken === "string" ? body.captchaToken : undefined;
    const ip = requestIp(request);

    const university = findUniversityDomain(email);
    if (!university) {
      return NextResponse.json({ error: "Use an email address issued by a recognized U.S. university." }, { status: 400 });
    }
    if (!(await verifyTurnstile(captchaToken, ip))) return NextResponse.json({ error: "Complete the security check and try again." }, { status: 400 });

    const hashedKeys = [hashForRateLimit(ip), hashForRateLimit(email), hashForRateLimit(deviceId)];
    let limit = consumeLocalRateLimit(hashedKeys) as RateLimitResult | null;
    try {
      const admin = createAdminClient();
      const { data: limitData, error: limitError } = await admin.rpc("consume_otp_rate_limit", {
        p_ip_hash: hashedKeys[0],
        p_email_hash: hashedKeys[1],
        p_device_hash: hashedKeys[2],
      }).single();
      if (!limitError) limit = limitData as RateLimitResult | null;
    } catch {
      // The local guard keeps development and first deploys usable until the server key is configured.
    }
    if (!limit || !limit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit?.retry_after_seconds || 0) } },
      );
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("send-code failed:", error);
    return NextResponse.json(
      { error: "Supabase is not configured or the request could not be completed." },
      { status: 500 },
    );
  }
}
