// apps/web/src/app/(dashboard)/profile/security/page.tsx
"use client";

import Link from "next/link";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";

export default function SecurityPage() {
  return (
    <AuthGuard>
      <div className="mx-auto max-w-xl py-6">
        <Link href="/profile" className="text-sm underline">← Back to profile</Link>
        <h1 className="mt-3 text-2xl font-bold">Security</h1>
        <h2 className="mb-4 mt-6 text-lg font-semibold">Change password</h2>
        <ChangePasswordForm />
      </div>
    </AuthGuard>
  );
}
