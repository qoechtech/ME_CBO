"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { authApi } from "@/lib/api/auth.api";
import { ApiError } from "@/lib/api/client";
import { useAuthStore } from "@/store/auth.store";
import { safeNext } from "@/lib/auth/next";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type FormValues = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const result = await authApi.login(values);
      const next = safeNext(params.get("next"));

      // Admin must enroll in two-factor authentication first.
      if ("mfaSetupRequired" in result) {
        sessionStorage.setItem("me_mfa_setup", result.setupId);
        toast.info("Set up two-factor authentication to continue.");
        router.push("/mfa/setup");
        return;
      }

      if (result.mfaRequired) {
        // Stash challenge in sessionStorage so the MFA page can read it
        sessionStorage.setItem("me_mfa_challenge", result.challengeId);
        toast.info("Enter your authenticator code to continue.");
        router.push(`/mfa/verify?next=${encodeURIComponent(next)}`);
        return;
      }

      // Seed the session cache so the dashboard does not flash a spinner.
      queryClient.setQueryData(["auth", "me"], result.user);
      setUser(result.user);
      toast.success(`Welcome back, ${result.user.fullName.split(" ")[0]}!`);
      router.replace(next);
    } catch (err) {
      // Keep the real reason in the browser console for debugging.
      console.error("Login error:", err);
      const msg =
        err instanceof ApiError
          ? err.status === 429
            ? "Too many attempts. Try again later."
            : err.message
          : "Login failed. Please try again.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@mecbo.org"
        error={errors.email?.message}
        {...register("email")}
      />

      <div>
        <Input
          label="Password"
          type={showPw ? "text" : "password"}
          autoComplete="current-password"
          placeholder="Your password"
          error={errors.password?.message}
          {...register("password")}
        />
        <button
          type="button"
          onClick={() => setShowPw((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--fg-subtle)] hover:text-[var(--fg)] focus-ring rounded"
          aria-label={showPw ? "Hide password" : "Show password"}
        >
          {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {showPw ? "Hide" : "Show"} password
        </button>
      </div>

      <div className="text-right">
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-[var(--primary)] hover:underline focus-ring rounded"
        >
          Forgot password?
        </Link>
      </div>

      <Button type="submit" size="lg" fullWidth loading={submitting}>
        <LogIn className="h-4 w-4" aria-hidden />
        Sign in
      </Button>
    </form>
  );
}
