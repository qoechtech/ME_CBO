// apps/web/src/components/auth/ChangePasswordForm.tsx
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { authApi } from "@/lib/api/auth.api";
import { ApiError } from "@/lib/api/client";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(12, "Use at least 12 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });
type FormValues = z.infer<typeof schema>;

export function ChangePasswordForm() {
  const [busy, setBusy] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (v: FormValues) => {
    setBusy(true);
    try {
      await authApi.changePassword(v.currentPassword, v.newPassword);
      toast.success("Password changed. Other devices were signed out.");
      reset();
    } catch (err) {
      console.error("Change password error:", err);
      toast.error(err instanceof ApiError ? err.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Input label="Current password" type="password" autoComplete="current-password"
        error={errors.currentPassword?.message} {...register("currentPassword")} />
      <Input label="New password" type="password" autoComplete="new-password"
        error={errors.newPassword?.message} {...register("newPassword")} />
      <Input label="Confirm new password" type="password" autoComplete="new-password"
        error={errors.confirm?.message} {...register("confirm")} />
      <Button type="submit" size="lg" fullWidth loading={busy}>
        Change password
      </Button>
    </form>
  );
}
