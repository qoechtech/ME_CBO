"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
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

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type FormValues = z.infer<typeof schema>;

export function LoginForm() {
  const params = useSearchParams();
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

      if (result.mfaRequired) {
        sessionStorage.setItem("me_mfa_challenge", result.challengeId);
        toast.info("Enter your authenticator code to continue.");
        window.location.href = "/mfa/verify";
        return;
      }

      setUser(result.user);
      toast.success(`Welcome back, ${result.user.fullName.split(" ")[0]}!`);

      const next = params.get("next") || "/dashboard";

      // Force a full-page navigation so the browser commits the HttpOnly
      // cookies (me_access, me_refresh) BEFORE the middleware runs on the
      // next request. Client-side router navigation skips this and causes
      // a redirect loop back to /login.
      window.location.href = next;
    } catch (err) {
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

      <Button type="submit" size="lg" fullWidth loading={submitting}>
        <LogIn className="h-4 w-4" aria-hidden />
        Sign in
      </Button>
    </form>
  );
}
