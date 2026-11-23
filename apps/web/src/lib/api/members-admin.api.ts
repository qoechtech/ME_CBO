// apps/web/src/lib/api/members-admin.api.ts
import { api } from "./client";

export type CreatableRole = "MEMBER" | "TEAM_LEAD" | "OPERATIONS_ADMIN" | "FINANCE_ADMIN";

export type CreateMemberPayload = {
  fullName: string;
  email: string;
  phone?: string;
  role?: CreatableRole;
  location?: string;
  skills?: string[];
};

export type InviteResult = {
  member: { id: string; fullName: string; email: string; role: string };
  /** false when the email could not be sent; use "Resend invitation". */
  emailSent: boolean;
};

export const membersAdminApi = {
  create: (payload: CreateMemberPayload) =>
    api.post<InviteResult>("/members", payload),

  resendInvite: (id: string) =>
    api.post<InviteResult>(`/members/${id}/resend-invite`),
};
