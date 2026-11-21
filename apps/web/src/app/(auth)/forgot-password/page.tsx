"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/AuthShell";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { api, ApiError } from "@/lib/api/client";

const schema = z.object({ email: z.string().email("Enter a valid email") });
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: Values) => {
    setSubmitting(true);
    try {
      await api.post("/auth/password/reset-request", values);
      setSent(true);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not send reset link.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Forgot password"
      subtitle="We'll email you a link to reset it."
      footer={<Link href="/login" className="text-[var(--primary)] font-semibold">Back to sign in</Link>}
    >
      {sent ? (
        <p className="text-sm text-[var(--fg-muted)]">
          If an account exists for that email, a reset link is on its way. Check your inbox (and spam).
        </p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register("email")}
          />
          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
