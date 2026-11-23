// apps/web/src/app/(dashboard)/members/new/page.tsx
"use client";

import Link from "next/link";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { AddMemberForm } from "@/components/members/AddMemberForm";

export default function AddMemberPage() {
  return (
    <AuthGuard permission="members:create">
      <div className="mx-auto max-w-xl py-6">
        <Link href="/members" className="text-sm underline">← Back to members</Link>
        <h1 className="mt-3 text-2xl font-bold">Add a member</h1>
        <p className="mb-6 mt-1 text-sm opacity-80">
          Register someone directly, without an application. They get an email to set their password.
        </p>
        <AddMemberForm />
      </div>
    </AuthGuard>
  );
}
