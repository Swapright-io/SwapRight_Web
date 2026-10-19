import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findUniversityDomain } from "@/lib/university-domains";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/?error=social-sign-in-failed", requestUrl.origin));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email || !findUniversityDomain(user.email)) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/?error=university-email-required", requestUrl.origin));
    }
  }

  return NextResponse.redirect(new URL("/marketplace", requestUrl.origin));
}
