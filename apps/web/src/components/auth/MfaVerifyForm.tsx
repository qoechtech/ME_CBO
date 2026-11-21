"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { authApi } from "@/lib/api/auth.api";
import { ApiError } from "@/lib/api/client";
import { useAuthStore } from "@/store/auth.store";

const LENGTH = 6;

export function MfaVerifyForm() {
  const setUser = useAuthStore((s) => s.setUser);
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const [submitting, setSubmitting] = useState(false);
  const [seconds, setSeconds] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  /* ---- Read challenge from sessionStorage after mount (SSR-safe) ---- */
  useEffect(() => {
    const id = sessionStorage.getItem("me_mfa_challenge");
    if (!id) {
      window.location.href = "/login";
      return;
    }
    setChallengeId(id);
  }, []);

  /* ---- Resend cooldown ---- */
  useEffect(() => {
    if (seconds <= 0) {
      setCanResend(true);
      return;
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const setDigit = (idx: number, val: string) => {
    const clean = val.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = clean;
      return next;
    });
    if (clean && idx < LENGTH - 1) inputsRef.current[idx + 1]?.focus();
  };

  const onKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && idx > 0) inputsRef.current[idx - 1]?.focus();
    if (e.key === "ArrowRight" && idx < LENGTH - 1)
      inputsRef.current[idx + 1]?.focus();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, LENGTH);
    if (!text) return;
    e.preventDefault();
    const arr = Array(LENGTH).fill("");
    text.split("").forEach((c, i) => (arr[i] = c));
    setDigits(arr);
    inputsRef.current[Math.min(text.length, LENGTH - 1)]?.focus();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeId) {
      toast.error("Session expired. Please sign in again.");
      window.location.href = "/login";
      return;
    }
    const code = digits.join("");
    if (code.length !== LENGTH) {
      toast.error("Enter all 6 digits");
      return;
    }
    setSubmitting(true);
    try {
      const { user } = await authApi.verifyMfa({ challengeId, code });
      sessionStorage.removeItem("me_mfa_challenge");
      setUser(user);
      toast.success("Verified. Welcome!");

      // Full-page navigation — commits the Set-Cookie from the verify
      // response BEFORE the middleware checks on /dashboard.
      window.location.href = "/dashboard";
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 429
            ? "Too many attempts. Wait a moment."
            : err.message
          : "Verification failed.";
      toast.error(msg);
      setDigits(Array(LENGTH).fill(""));
      inputsRef.current[0]?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (!challengeId) return;
    try {
      await authApi.resendMfa(challengeId);
      toast.success("A new code is on the way.");
      setSeconds(30);
      setCanResend(false);
    } catch {
      toast.error("Could not resend right now.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-3">
        <ShieldCheck
          className="h-5 w-5 shrink-0 text-[var(--primary)]"
          aria-hidden
        />
        <p className="text-sm text-[var(--fg-muted)]">
          Open your authenticator app and enter the 6-digit code for ME_CBO.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={onPaste}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            aria-label={`Digit ${i + 1} of ${LENGTH}`}
            disabled={!challengeId}
            className="h-14 w-full max-w-[56px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] text-center text-2xl font-bold text-[var(--fg)] focus:border-[var(--accent)] focus-ring disabled:opacity-50"
          />
        ))}
      </div>

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={submitting}
        disabled={!challengeId}
      >
        Verify
      </Button>

      <div className="text-center text-sm text-[var(--fg-muted)]">
        {canResend ? (
          <button
            type="button"
            onClick={resend}
            disabled={!challengeId}
            className="font-semibold text-[var(--primary)] hover:underline focus-ring rounded disabled:opacity-50"
          >
            Resend code
          </button>
        ) : (
          <span>Resend available in {seconds}s</span>
        )}
      </div>
    </form>
  );
}
