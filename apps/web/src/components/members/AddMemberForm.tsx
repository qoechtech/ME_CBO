// apps/web/src/components/members/AddMemberForm.tsx
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api/client";
import {
  membersAdminApi,
  type CreatableRole,
  type InviteResult,
} from "@/lib/api/members-admin.api";
import { useAuthStore } from "@/store/auth.store";

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter the full name").max(120),
  email: z.string().trim().email("Enter a valid email"),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number")
    .or(z.literal("")),
  role: z.enum(["MEMBER", "TEAM_LEAD", "OPERATIONS_ADMIN", "FINANCE_ADMIN"]),
  location: z.string().trim().max(120).optional(),
});
type FormValues = z.infer<typeof schema>;

const ROLE_LABELS: Record<CreatableRole, string> = {
  MEMBER: "Member",
  TEAM_LEAD: "Team lead",
  OPERATIONS_ADMIN: "Operations admin",
  FINANCE_ADMIN: "Finance admin",
};

export function AddMemberForm() {
  const viewerRole = useAuthStore((s) => s.user?.role);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Only a super admin can add another administrator.
  const roles: CreatableRole[] =
    viewerRole === "SUPER_ADMIN"
      ? ["MEMBER", "TEAM_LEAD", "OPERATIONS_ADMIN", "FINANCE_ADMIN"]
      : ["MEMBER", "TEAM_LEAD"];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", email: "", phone: "", role: "MEMBER", location: "" },
  });

  const onSubmit = async (v: FormValues) => {
    setBusy(true);
    try {
      const res = await membersAdminApi.create({
        fullName: v.fullName,
        email: v.email,
        role: v.role,
        ...(v.phone ? { phone: v.phone } : {}),
        ...(v.location ? { location: v.location } : {}),
      });
      setResult(res);
      reset();
      if (res.emailSent) toast.success("Member added. An email was sent to set their password.");
      else toast.warning("Member added, but the email could not be sent. Use “Resend invitation”.");
    } catch (err) {
      console.error("Add member error:", err);
      toast.error(err instanceof ApiError ? err.message : "Could not add the member.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const res = await membersAdminApi.resendInvite(result.member.id);
      setResult(res);
      toast[res.emailSent ? "success" : "error"](
        res.emailSent ? "Invitation sent again." : "The email still could not be sent.",
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not resend the invitation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {result && (
        <div role="status" className="rounded-xl border p-4 text-sm">
          <p className="font-semibold">
            {result.member.fullName} ({result.member.email}) was added.
          </p>
          <p className="mt-1">
            {result.emailSent
              ? "They will receive an email with a link to set their own password (valid for 7 days)."
              : "The invitation email could not be sent."}
          </p>
          <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={resend} loading={busy}>
            Resend invitation
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Input label="Full name" autoComplete="off" error={errors.fullName?.message} {...register("fullName")} />
        <Input label="Email" type="email" inputMode="email" autoComplete="off" error={errors.email?.message} {...register("email")} />
        <Input label="Phone (optional)" type="tel" autoComplete="off" error={errors.phone?.message} {...register("phone")} />
        <Input label="Location (optional)" autoComplete="off" error={errors.location?.message} {...register("location")} />

        <label className="block text-sm font-medium">
          Role
          <select
            className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2.5 text-base"
            {...register("role")}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>

        <p className="text-xs opacity-70">
          The member chooses their own password from the email we send. You never see or set it.
        </p>

        <Button type="submit" size="lg" fullWidth loading={busy}>
          <UserPlus className="h-4 w-4" aria-hidden />
          Add member
        </Button>
      </form>
    </div>
  );
}
