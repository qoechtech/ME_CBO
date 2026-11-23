// apps/web/src/app/(auth)/forgot-password/page.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { authApi } from "@/lib/api/auth.api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.requestPasswordReset(email.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      console.error("Password reset request error:", err);
      setError("We could not send the request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we will send you a reset link."
      footer={
        <Link href="/login" className="font-medium underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p role="status" className="rounded-lg border p-4 text-sm">
          If an account exists for <strong>{email}</strong>, a reset link is on its way.
          Check your inbox (and spam folder). The link expires soon.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <label className="block text-sm font-medium">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2.5 text-base"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !email}
            className="w-full rounded-lg bg-[#14532d] px-4 py-2.5 font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
