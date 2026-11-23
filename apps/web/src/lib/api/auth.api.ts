import { api } from "./client";
import type { AuthUser } from "@/store/auth.store";

export type LoginPayload = { email: string; password: string };

export type LoginResult =
  | { mfaRequired: false; user: AuthUser }
  | { mfaRequired: true; challengeId: string }
  /** Admin who has not enrolled in two-factor authentication yet. */
  | { mfaSetupRequired: true; setupId: string };

export type MfaVerifyPayload = { challengeId: string; code: string };

export type RegisterPayload = {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
};

export type MfaSetupStart = { qrDataUrl: string; secret: string };

export const authApi = {
  login: (payload: LoginPayload) =>
    api.post<LoginResult>("/auth/login", payload),

  /** `code` is a 6-digit authenticator code OR a backup code. */
  verifyMfa: (payload: MfaVerifyPayload) =>
    api.post<{ user: AuthUser }>("/auth/mfa/verify", payload),

  me: () => api.get<{ user: AuthUser }>("/auth/me"),

  logout: () => api.post<{ ok: true }>("/auth/logout"),

  register: (payload: RegisterPayload) =>
    api.post<{ user: AuthUser }>("/auth/register", payload),

  requestPasswordReset: (email: string) =>
    api.post<{ ok: true }>("/auth/password/reset-request", { email }),

  confirmPasswordReset: (token: string, newPassword: string) =>
    api.post<{ ok: true }>("/auth/password/reset-confirm", { token, newPassword }),

  /** Signed-in member changes their own password. */
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true }>("/auth/password/change", { currentPassword, newPassword }),

  /* First-time MFA enrolment for admins (uses the setup ticket from login). */
  startMfaSetupWithTicket: (setupId: string) =>
    api.post<MfaSetupStart>("/auth/mfa/setup/ticket/start", { setupId }),

  confirmMfaSetupWithTicket: (setupId: string, code: string) =>
    api.post<{ user: AuthUser; backupCodes: string[] }>(
      "/auth/mfa/setup/ticket/confirm",
      { setupId, code },
    ),
};
