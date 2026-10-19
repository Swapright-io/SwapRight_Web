"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Script from "next/script";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft } from "@/components/icons";

type Step = "welcome" | "signin" | "email" | "otp" | "profile";

function BackButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="back-button" onClick={onClick} aria-label="Go back"><ArrowLeft /></button>;
}

export default function AuthFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [dorm, setDorm] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [domainStatus, setDomainStatus] = useState<"idle" | "checking" | "recognized" | "unknown">("idle");
  const [institution, setInstitution] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(45);

  useEffect(() => {
    if (step !== "otp" || seconds <= 0) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(value - 1, 0)), 1000);
    return () => window.clearInterval(timer);
  }, [step, seconds]);

  useEffect(() => {
    const existing = window.localStorage.getItem("swapright-device-id");
    const next = existing || window.crypto.randomUUID();
    window.localStorage.setItem("swapright-device-id", next);
    setDeviceId(next);
    const authError = new URLSearchParams(window.location.search).get("error");
    if (authError) setError(authError.replaceAll("-", " "));
  }, []);

  const initials = useMemo(() => {
    const parts = displayName.trim().split(/\\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "SR";
  }, [displayName]);

  function resetMessages() {
    setError("");
    setNotice("");
  }

  function goTo(next: Step) {
    resetMessages();
    setStep(next);
  }

  async function requestOtp(targetEmail: string) {
    const captchaToken = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')?.value;
    const response = await fetch("/api/auth/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: targetEmail, deviceId, captchaToken }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "We couldn't send a code. Please try again.");
  }

  async function checkDomain(value: string) {
    const target = value.trim().toLowerCase();
    if (!target.includes("@")) {
      setDomainStatus("idle");
      setInstitution("");
      return false;
    }
    setDomainStatus("checking");
    const response = await fetch("/api/auth/check-domain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: target }) });
    const result = await response.json();
    setDomainStatus(result.recognized ? "recognized" : "unknown");
    setInstitution(result.institution || "");
    return Boolean(result.recognized);
  }

  async function signInWithProvider(provider: "apple" | "google") {
    resetMessages();
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (authError) throw authError;
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "We couldn't start social sign-in.");
      setBusy(false);
    }
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    resetMessages();
    const normalizedEmail = email.trim().toLowerCase();

    if (domainStatus !== "recognized") {
      const recognized = await checkDomain(normalizedEmail);
      if (!recognized) {
        setError("Use an email address issued by a recognized U.S. university.");
        return;
      }
    }

    setBusy(true);
    try {
      await requestOtp(normalizedEmail);
      setEmail(normalizedEmail);
      setSeconds(45);
      setCode("");
      setNotice("Verification code sent.");
      setStep("otp");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "We couldn't send a code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    resetMessages();
    if (!/^\\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
      if (authError) throw authError;
      if (!data.user) throw new Error("We couldn't read your signed-in user.");

      const { data: profile, error: profileError } = await supabase.from("profiles").select("onboarding_complete,status,display_name").eq("id", data.user.id).maybeSingle();
      if (profileError) throw profileError;
      if (profile?.status === "suspended") throw new Error("This account is suspended. Contact SwapRight support.");
      if (profile?.onboarding_complete && profile.display_name) {
        router.push("/marketplace");
      } else {
        setStep("profile");
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "That code was not accepted. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    resetMessages();
    if (displayName.trim().length < 2) {
      setError("Add a display name so other students can recognize you.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError || new Error("Your session expired. Please sign in again.");
      let avatarPath: string | null = null;
      if (avatarFile) {
        const extension = avatarFile.name.split(".").pop()?.toLowerCase() || "jpg";
        avatarPath = `${user.id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("avatars").upload(avatarPath, avatarFile, { contentType: avatarFile.type, upsert: false });
        if (uploadError) throw uploadError;
      }
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email,
        display_name: displayName.trim(),
        dorm_building: dorm.trim() || null,
        avatar_path: avatarPath,
        onboarding_complete: true,
      });
      if (profileError) throw profileError;
      router.push("/marketplace");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "We couldn't save your profile. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (seconds > 0 || busy) return;
    resetMessages();
    setBusy(true);
    try {
      await requestOtp(email);
      setSeconds(45);
      setNotice("A new verification code is on its way.");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "We couldn't resend the code.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "welcome") {
    return (
      <main className="auth-page">
        <section className="auth-card welcome-screen">
          <div className="welcome-content">
            <div className="hero-art" aria-hidden="true">
              <span className="art-card art-electronics" />
              <span className="art-card art-furniture" />
              <span className="art-card art-books" />
              <span className="art-arrow">→</span>
            </div>
            <div className="welcome-copy">
              <h1>Give it a second life.</h1>
              <p>SwapRight makes it easy to share what you don&apos;t need with students who do — right on your campus.</p>
            </div>
            <div className="welcome-actions">
              <div className="pagination" aria-label="Step 1 of 3"><b /><i /><i /></div>
              <button className="primary-button" onClick={() => goTo("signin")}>Get started</button>
              <button className="link-button" onClick={() => goTo("signin")}>I already have an account</button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (step === "signin") {
    return (
      <main className="auth-page">
        <section className="auth-card auth-screen">
          <div className="auth-content">
            <BackButton onClick={() => goTo("welcome")} />
            <div className="auth-heading">
              <h1>Welcome to<br />SwapRight</h1>
              <p>Sign in with your university account to get started.</p>
            </div>
            <div className="auth-options">
              <button className="social-button social-dark" type="button" onClick={() => signInWithProvider("apple")}>Continue with Apple</button>
              <button className="social-button" type="button" onClick={() => signInWithProvider("google")}><span className="google-mark">G</span>Continue with Google</button>
              <div className="divider"><span /><em>or</em><span /></div>
              <button className="primary-button" onClick={() => goTo("email")}>Continue with university email</button>
            </div>
            <p className="terms">By continuing you agree to our Terms of Service and Privacy Policy.</p>
          </div>
        </section>
      </main>
    );
  }

  if (step === "email") {
    return (
      <main className="auth-page">
        <section className="auth-card auth-screen">
          <form className="auth-content email-content" onSubmit={sendCode}>
            <BackButton onClick={() => goTo("signin")} />
            <div className="auth-heading compact-heading">
              <h1>What&apos;s your<br />university email?</h1>
              <p>Use an email issued by a recognized U.S. university to join the campus marketplace.</p>
            </div>
            <div className="field-group">
              <label htmlFor="email">UNIVERSITY EMAIL</label>
              <input id="email" type="email" autoComplete="email" placeholder="you@university.edu" value={email} onChange={(event) => { setEmail(event.target.value); setDomainStatus("idle"); }} onBlur={() => checkDomain(email)} required />
              {domainStatus === "recognized" && <p className="recognized"><Image src="/gsu-check.svg" alt="" width={16} height={16} /> {institution || "Recognized U.S. university domain"}</p>}
              {domainStatus === "unknown" && <p className="form-message error-message" role="status">We don&apos;t recognize this university domain yet.</p>}
            </div>
            <div className="form-spacer" />
            {error && <p className="form-message error-message" role="alert">{error}</p>}
            {notice && <p className="form-message success-message" role="status">{notice}</p>}
             {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && <div className="cf-turnstile" data-sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />}
             <button className="primary-button" type="submit" disabled={busy || domainStatus !== "recognized"}>{busy ? "Sending code…" : "Send verification code"}</button>
             <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
          </form>
        </section>
      </main>
    );
  }

  if (step === "otp") {
    return (
      <main className="auth-page">
        <section className="auth-card auth-screen">
          <form className="auth-content otp-content" onSubmit={verifyCode}>
            <BackButton onClick={() => goTo("email")} />
            <div className="auth-heading">
              <h1>Check your email</h1>
              <p>We sent a 6-digit code to {email}</p>
            </div>
            <div className="otp-row" aria-label="6-digit verification code">
              {Array.from({ length: 6 }).map((_, index) => (
                <input
                  key={index}
                  aria-label={`Digit ${index + 1}`}
                  className={index === code.length ? "active" : ""}
                  inputMode="numeric"
                  maxLength={1}
                  value={code[index] || ""}
                  onChange={(event) => {
                    const digit = event.target.value.replace(/\\D/g, "").slice(-1);
                    const next = code.split("");
                    if (digit) next[index] = digit;
                    else next.splice(index, 1);
                    const nextCode = next.join("").slice(0, 6);
                    setCode(nextCode);
                    if (digit && index < 5) document.querySelector<HTMLInputElement>(`input[aria-label="Digit ${index + 2}"]`)?.focus();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && !code[index] && index > 0) document.querySelector<HTMLInputElement>(`input[aria-label="Digit ${index}"]`)?.focus();
                  }}
                />
              ))}
            </div>
            {error && <p className="form-message error-message" role="alert">{error}</p>}
            {notice && <p className="form-message success-message" role="status">{notice}</p>}
            <div className="resend-row"><span>Didn&apos;t get it?</span><button type="button" className="link-button" disabled={seconds > 0 || busy} onClick={resendCode}>{seconds > 0 ? `Resend code (0:${String(seconds).padStart(2, "0")})` : "Resend code"}</button></div>
            <button className="primary-button visually-hidden-submit" type="submit" disabled={busy}>Verify code</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card auth-screen">
        <form className="auth-content profile-content" onSubmit={saveProfile}>
          <div className="profile-topline"><span>Step 3 of 3</span><span>Required to continue</span></div>
          <div className="auth-heading compact-heading"><h1>Set up your profile</h1><p>So other students on campus can recognize you.</p></div>
          <label className="avatar-picker" htmlFor="photo-upload"><span className="avatar">{initials}</span><span><strong>{avatarFile ? avatarFile.name : "Add a photo"}</strong><small>Tap to upload · JPG or PNG, max 5 MB</small></span><input id="photo-upload" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0] || null; if (file && file.size > 5 * 1024 * 1024) { setError("Choose an image smaller than 5 MB."); return; } setAvatarFile(file); }} /></label>
          <div className="field-group"><label htmlFor="display-name">DISPLAY NAME</label><input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" autoComplete="name" required /></div>
          <div className="field-group"><label htmlFor="dorm">DORM / BUILDING</label><input id="dorm" value={dorm} onChange={(event) => setDorm(event.target.value)} placeholder="Optional" /></div>
          <div className="form-spacer" />
          {error && <p className="form-message error-message" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Enter SwapRight"}</button>
        </form>
      </section>
    </main>
  );
}
