import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { findUniversityDomain } from "@/lib/university-domains";
import { hashForRateLimit, requestIp, verifyTurnstile } from "@/lib/security";

type RateLimitResult = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const mode = body.mode === "signup" ? "signup" : body.mode === "login" ? "login" : null;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const deviceId = typeof body.deviceId === "string" && body.deviceId.trim()
      ? body.deviceId.trim()
      : `${ip}:${email}`;
    const captchaToken = typeof body.captchaToken === "string" ? body.captchaToken : undefined;
    const ip = requestIp(request);

    if (!mode) return NextResponse.json({ error: "Choose whether to create an account or log in." }, { status: 400 });
    if (!findUniversityDomain(email)) {
      return NextResponse.json({ error: "Use an email address issued by a recognized U.S. university." }, { status: 400 });
    }
    if (!password || (mode === "signup" && password.length < 8)) {
      return NextResponse.json({ error: mode === "signup" ? "Choose a password with at least 8 characters." : "Enter your password." }, { status: 400 });
    }
    if (!(await verifyTurnstile(captchaToken, ip))) {
      return NextResponse.json({ error: "Complete the security check and try again." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: limitData, error: limitError } = await admin.rpc("consume_password_auth_rate_limit", {
      p_ip_hash: hashForRateLimit(ip),
      p_email_hash: hashForRateLimit(email),
      p_device_hash: hashForRateLimit(deviceId),
    }).single();
    if (limitError) throw limitError;
    const limit = limitData as RateLimitResult | null;
    if (!limit || !limit.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Try again in about ${Math.max(1, Math.ceil((limit?.retry_after_seconds || 60) / 60))} minute(s).` },
        { status: 429, headers: { "Retry-After": String(limit?.retry_after_seconds || 0) } },
      );
    }

    const supabase = await createClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        if (/already registered|already exists/i.test(error.message)) {
          return NextResponse.json({ error: "An account already exists for this email. Log in instead." }, { status: 409 });
        }
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (!data.user) throw new Error("Supabase did not return the new account.");
      if (data.user.identities?.length === 0) {
        return NextResponse.json({ error: "An account already exists for this email. Log in instead." }, { status: 409 });
      }
      if (!data.session) {
        return NextResponse.json({
          confirmationRequired: true,
          error: "Your account was created, but email confirmation is enabled in Supabase. Turn off Confirm Email to continue directly to profile setup.",
        }, { status: 200 });
      }
      return NextResponse.json({ ok: true, onboardingComplete: false, displayName: "" });
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,status,onboarding_complete,display_name")
      .eq("email", email)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      return NextResponse.json({ error: "We couldn't find an account with that email. Create an account first." }, { status: 404 });
    }
    if (profile.status !== "active") {
      return NextResponse.json({ error: "This account is not active. Contact SwapRight support." }, { status: 403 });
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      if (signInError.code === "email_not_confirmed") {
        return NextResponse.json({ error: "This account still needs email confirmation. Turn off Confirm Email in Supabase for password-only signup." }, { status: 401 });
      }
      return NextResponse.json({ error: "The password is incorrect." }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      onboardingComplete: profile.onboarding_complete,
      displayName: profile.display_name,
    });
  } catch (error) {
    console.error("password auth failed:", error);
    return NextResponse.json({ error: "Supabase is not configured or the request could not be completed." }, { status: 500 });
  }
}
