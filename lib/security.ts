import { createHmac } from "node:crypto";

export function hashForRateLimit(value: string) {
  const secret = process.env.RATE_LIMIT_HASH_SECRET;
  if (!secret) throw new Error("RATE_LIMIT_HASH_SECRET is not configured.");
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function requestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function verifyTurnstile(token: string | undefined, ip: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const result = await response.json() as { success?: boolean };
  return result.success === true;
}
