import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findUniversityDomain } from "@/lib/university-domains";
import { hashForRateLimit, requestIp, verifyTurnstile } from "@/lib/security";

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

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

    const admin = createAdminClient();
    const { data: limitData, error: limitError } = await admin.rpc("consume_otp_rate_limit", {
      p_ip_hash: hashForRateLimit(ip),
      p_email_hash: hashForRateLimit(email),
      p_device_hash: hashForRateLimit(deviceId),
    }).single();
    if (limitError) throw limitError;
    const limit = limitData as RateLimitResult | null;
    if (!limit || !limit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit?.retry_after_seconds || 3600) } },
      );
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Supabase is not configured or the request could not be completed." }, { status: 500 });
  }
}
