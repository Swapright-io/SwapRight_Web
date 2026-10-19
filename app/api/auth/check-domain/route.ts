import { NextResponse } from "next/server";
import { findUniversityDomain } from "@/lib/university-domains";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const match = findUniversityDomain(email);
  return NextResponse.json({
    recognized: Boolean(match),
    institution: match?.institution_name || null,
    domain: match?.domain || null,
  });
}
