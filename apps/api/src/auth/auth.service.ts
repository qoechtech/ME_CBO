import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { AuditService } from "../audit/audit.service";
import { EmailService } from "../email/email.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { MfaService } from "./mfa.service";
import { AUTH_ERRORS } from "./auth.constants";
import type { LoginDto } from "./dto/login.dto";
import type { RegisterDto } from "./dto/register.dto";
import type { Role } from "@prisma/client";

const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;
const MFA_CHALLENGE_TTL = 5 * 60; // 5 minutes
const MFA_SETUP_TTL = 10 * 60; // 10 minutes
const MFA_SETUP_MAX_ATTEMPTS = 5;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RESET_COOLDOWN_SECONDS = 60;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

/** Roles that MUST have two-factor authentication enabled. */
const MFA_REQUIRED_ROLES: Role[] = ["SUPER_ADMIN", "OPERATIONS_ADMIN", "FINANCE_ADMIN"];

export type SafeUser = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  mfaEnabled: boolean;
};

export type SessionResult = {
  mfaRequired: false;
  user: SafeUser;
  access: string;
  refresh: string;
};

export type LoginResult =
  | SessionResult
  | { mfaRequired: true; challengeId: string };

/** Returned by login() when an admin has not enrolled in MFA yet. */
export type SetupRequiredResult = {
  mfaSetupRequired: true;
  setupId: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  Register                                                          */
  /* ------------------------------------------------------------------ */
  async register(dto: RegisterDto, ip: string, ua: string): Promise<SafeUser> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.findUserByEmail(email);
    if (existing) throw new BadRequestException("Email already registered");

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: dto.fullName,
        phone: dto.phone ?? null,
        role: "MEMBER",
        status: "PENDING",
      },
    });

    // Non-blocking audit
    void this.audit.record({
      actorId: user.id,
      actorName: user.fullName,
      action: "auth.register",
      target: user.email,
      ip,
      userAgent: ua,
    });

    // TODO: send verification email for self-registered users
    return this.toSafe(user);
  }

  /* ------------------------------------------------------------------ */
  /*  Login                                                             */
  /* ------------------------------------------------------------------ */
  async login(
    dto: LoginDto,
    ip: string,
    ua: string,
  ): Promise<LoginResult | SetupRequiredResult> {
    const email = dto.email.trim().toLowerCase();
    // Two separate keys: one counts failures, one marks the account as locked.
    const failKey = `fail:login:${email}`;
    const lockKey = `lock:login:${email}`;

    // Run the lockout check and the user lookup at the same time.
    // If Redis is down, skip the lockout check instead of blocking every login.
    const [locked, user] = await Promise.all([
      this.redis.get(lockKey).catch(() => {
        this.logger.warn("Redis unavailable: login lockout check skipped");
        return null;
      }),
      this.findUserByEmail(email),
    ]);
    if (locked) throw new ForbiddenException(AUTH_ERRORS.ACCOUNT_LOCKED);

    if (!user) {
      // Same work as a real password check, so timing does not reveal unknown emails.
      await this.passwords.verifyDummy(dto.password);
      await this.bumpFailure(failKey, lockKey);
      void this.audit.record({
        action: "auth.login.fail",
        target: email,
        ip,
        userAgent: ua,
        metadata: { reason: "no_user" },
      });
      throw new UnauthorizedException(AUTH_ERRORS.INVALID_CREDENTIALS);
    }

    if (user.status === "SUSPENDED") {
      throw new ForbiddenException(AUTH_ERRORS.ACCOUNT_SUSPENDED);
    }

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) {
      await this.bumpFailure(failKey, lockKey);
      void this.audit.record({
        actorId: user.id,
        actorName: user.fullName,
        action: "auth.login.fail",
        target: user.email,
        ip,
        userAgent: ua,
        metadata: { reason: "wrong_password" },
      });
      throw new UnauthorizedException(AUTH_ERRORS.INVALID_CREDENTIALS);
    }

    // Correct password: reset the failure counter (no need to wait for it).
    void this.redis.del(failKey).catch(() => undefined);

    // Older hashes with different cost settings are upgraded in the background.
    if (this.passwords.needsRehash(user.passwordHash)) {
      void this.rehashPassword(user.id, dto.password);
    }

    // MFA is mandatory for admin roles. If they have not enrolled yet, hand
    // back a short-lived setup ticket instead of a session. The ticket only
    // works on the two "mfa/setup/ticket" endpoints.
    const mustEnroll = MFA_REQUIRED_ROLES.includes(user.role) && !user.mfaEnabled;
    if (mustEnroll) {
      const setupId = randomUUID();
      await this.redis.setEx(`mfa-setup:${setupId}`, MFA_SETUP_TTL, user.id);
      void this.audit.record({
        actorId: user.id,
        actorName: user.fullName,
        action: "auth.login.mfa.setup_required",
        target: user.email,
        ip,
        userAgent: ua,
      });
      return { mfaSetupRequired: true, setupId };
    }

    if (user.mfaEnabled) {
      const challenge = await this.createMfaChallenge(user.id, "TOTP");
      void this.audit.record({
        actorId: user.id,
        actorName: user.fullName,
        action: "auth.login.mfa.challenge",
        target: user.email,
        ip,
        userAgent: ua,
      });
      return { mfaRequired: true, challengeId: challenge.id };
    }

    // Straight login
    return this.issueSession(user, ip, ua);
  }

  /* ------------------------------------------------------------------ */
  /*  MFA verify                                                        */
  /* ------------------------------------------------------------------ */
  async verifyMfa(
    challengeId: string,
    code: string,
    ip: string,
    ua: string,
  ): Promise<LoginResult> {
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { id: challengeId },
    });
    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
      throw new UnauthorizedException(AUTH_ERRORS.MFA_EXPIRED);
    }
    if (challenge.attempts >= 5) {
      throw new ForbiddenException(AUTH_ERRORS.ACCOUNT_LOCKED);
    }

    const user = await this.prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user || !user.mfaSecret) throw new UnauthorizedException(AUTH_ERRORS.MFA_INVALID);

    const totpOk = await this.mfa.verifyTotp(user.id, user.mfaSecret, code);
    const backupOk =
      !totpOk && (await this.mfa.consumeBackupCode(user.id, code, user.mfaBackupCodes));

    if (!totpOk && !backupOk) {
      await this.prisma.mfaChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      void this.audit.record({
        actorId: user.id,
        actorName: user.fullName,
        action: "auth.login.mfa.fail",
        ip,
        userAgent: ua,
      });
      throw new UnauthorizedException(AUTH_ERRORS.MFA_INVALID);
    }

    await this.prisma.mfaChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    return this.issueSession(user, ip, ua);
  }

  /* ------------------------------------------------------------------ */
  /*  Refresh                                                           */
  /* ------------------------------------------------------------------ */
  async refresh(rawRefresh: string, ip: string, ua: string): Promise<LoginResult> {
    let claims;
    try {
      claims = await this.tokens.verifyRefresh(rawRefresh);
    } catch {
      throw new UnauthorizedException(AUTH_ERRORS.TOKEN_INVALID);
    }

    const row = await this.prisma.refreshToken.findUnique({ where: { id: claims.jti } });
    if (!row) throw new UnauthorizedException(AUTH_ERRORS.TOKEN_INVALID);

    if (row.revokedAt) {
      // Reuse of revoked token — revoke the entire family
      await this.prisma.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.redis.del(`rt:user:${row.userId}`);
      void this.audit.record({
        actorId: row.userId,
        action: "auth.refresh.reuse_detected",
        ip,
        userAgent: ua,
      });
      throw new UnauthorizedException(AUTH_ERRORS.TOKEN_INVALID);
    }

    if (row.tokenHash !== this.tokens.hashToken(rawRefresh)) {
      throw new UnauthorizedException(AUTH_ERRORS.TOKEN_INVALID);
    }
    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException(AUTH_ERRORS.TOKEN_INVALID);
    }

    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || user.status === "SUSPENDED") {
      throw new UnauthorizedException(AUTH_ERRORS.ACCOUNT_SUSPENDED);
    }

    // Rotate: revoke current, issue next. The new token id is generated here so
    // signing does not have to wait for the database.
    const newId = randomUUID();
    const next = await this.tokens.signRefresh({
      sub: user.id,
      jti: newId,
      fam: row.familyId,
    });
    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          id: newId,
          userId: user.id,
          tokenHash: this.tokens.hashToken(next),
          familyId: row.familyId,
          userAgent: ua,
          ipAddress: ip,
          expiresAt: new Date(Date.now() + this.tokens.refreshTtlSeconds * 1000),
        },
      }),
      this.prisma.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), replacedBy: newId },
      }),
    ]);

    // The role comes from the database, so a role change takes effect on the
    // next refresh (at most one access-token lifetime later).
    const access = await this.tokens.signAccess({
      sub: user.id,
      role: user.role,
      mfa: user.mfaEnabled,
    });

    return {
      mfaRequired: false,
      user: this.toSafe(user),
      access,
      refresh: next,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Logout                                                            */
  /* ------------------------------------------------------------------ */
  async logout(rawRefresh: string | undefined): Promise<void> {
    if (!rawRefresh) return;
    try {
      const claims = await this.tokens.verifyRefresh(rawRefresh);
      await this.prisma.refreshToken.updateMany({
        where: { familyId: claims.fam, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      /* invalid token — no-op */
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Password reset                                                    */
  /* ------------------------------------------------------------------ */
  async requestPasswordReset(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.findUserByEmail(email);
    // Silent for unknown or suspended accounts: never reveal which emails exist.
    if (!user || user.status === "SUSPENDED") return;

    // At most one reset email per address per minute (skipped if Redis is down).
    const cooldownKey = `reset-cooldown:${user.id}`;
    const fresh = await this.redis
      .setNx(cooldownKey, RESET_COOLDOWN_SECONDS, "1")
      .catch(() => true);
    if (!fresh) return;

    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // A new link cancels every older unused link for this user.
    await this.prisma.$transaction([
      this.prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      }),
    ]);

    const siteUrl = process.env.APP_ORIGIN?.split(",")[0]?.trim() ?? "http://localhost:3000";
    const resetUrl = `${siteUrl}/reset-password?token=${token}`;
    void this.email
      .sendPasswordReset(user.email, resetUrl)
      .catch((err) =>
        this.logger.error(`Password reset email failed: ${(err as Error).message}`),
      );

    void this.audit.record({
      actorId: user.id,
      actorName: user.fullName,
      action: "auth.password.reset_requested",
      target: user.email,
    });
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    this.assertStrongPassword(newPassword);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException("Invalid or expired reset link. Please request a new one.");
    }
    const passwordHash = await this.passwords.hash(newPassword);

    // Clicking the emailed link proves the person owns the address.
    // The account status is NOT changed here (approval stays with the admins).
    const owner = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { emailVerified: true },
    });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: {
          passwordHash,
          ...(owner && !owner.emailVerified ? { emailVerified: new Date() } : {}),
        },
      }),
      this.prisma.passwordReset.updateMany({
        where: { userId: row.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    // Also lift any lockout so the member can sign in straight away.
    const ownerEmail = await this.emailOf(row.userId);
    if (ownerEmail) {
      void this.redis.del(`fail:login:${ownerEmail}`).catch(() => undefined);
      void this.redis.del(`lock:login:${ownerEmail}`).catch(() => undefined);
    }

    void this.audit.record({
      actorId: row.userId,
      action: "auth.password.reset_confirmed",
    });
  }

  /** Signed-in member changes their own password. Other devices are signed out. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ip: string,
    ua: string,
  ): Promise<SessionResult> {
    this.assertStrongPassword(newPassword);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const ok = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!ok) throw new BadRequestException("Your current password is not correct");
    if (currentPassword === newPassword) {
      throw new BadRequestException("Choose a password you have not used before");
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    void this.audit.record({
      actorId: user.id,
      actorName: user.fullName,
      action: "auth.password.changed",
      ip,
      userAgent: ua,
    });

    // Keep this device signed in with a fresh session.
    return this.issueSession(user, ip, ua);
  }

  /* ------------------------------------------------------------------ */
  /*  MFA setup (logged-in users)                                       */
  /* ------------------------------------------------------------------ */
  async startMfaSetup(userId: string): Promise<{ qrDataUrl: string; secret: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.mfaEnabled) throw new BadRequestException("MFA already enabled");

    const { secret, qrDataUrl } = await this.mfa.generateTotpSecret(user.email);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: this.mfa.encryptSecret(secret) }, // pending confirmation
    });
    return { qrDataUrl, secret };
  }

  async confirmMfaSetup(
    userId: string,
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecret) throw new BadRequestException("Start MFA setup first");
    if (!(await this.mfa.verifyTotp(user.id, user.mfaSecret, code))) {
      throw new BadRequestException(AUTH_ERRORS.MFA_INVALID);
    }
    const codes = this.mfa.generateBackupCodes();
    const hashes = await this.mfa.hashBackupCodes(codes);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaBackupCodes: hashes },
    });
    return { backupCodes: codes };
  }

  /* ------------------------------------------------------------------ */
  /*  MFA setup (admins enrolling for the first time, via setup ticket) */
  /* ------------------------------------------------------------------ */
  async startMfaSetupWithTicket(
    setupId: string,
  ): Promise<{ qrDataUrl: string; secret: string }> {
    const userId = await this.userIdForSetup(setupId);
    return this.startMfaSetup(userId);
  }

  async confirmMfaSetupWithTicket(
    setupId: string,
    code: string,
    ip: string,
    ua: string,
  ): Promise<SessionResult & { backupCodes: string[] }> {
    const userId = await this.userIdForSetup(setupId);

    // Limit guesses of the 6-digit code per ticket.
    const attempts = await this.redis.incrWithTtl(
      `mfa-setup-attempts:${setupId}`,
      MFA_SETUP_TTL,
    );
    if (attempts > MFA_SETUP_MAX_ATTEMPTS) {
      await this.redis.del(`mfa-setup:${setupId}`);
      throw new ForbiddenException(AUTH_ERRORS.ACCOUNT_LOCKED);
    }

    const { backupCodes } = await this.confirmMfaSetup(userId, code);
    await this.redis.del(`mfa-setup:${setupId}`);
    await this.redis.del(`mfa-setup-attempts:${setupId}`);

    // Re-read the user so mfaEnabled=true ends up in the access token.
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    void this.audit.record({
      actorId: user.id,
      actorName: user.fullName,
      action: "auth.mfa.enrolled",
      target: user.email,
      ip,
      userAgent: ua,
    });

    const session = await this.issueSession(user, ip, ua);
    return { ...session, backupCodes };
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                           */
  /* ------------------------------------------------------------------ */
  private async userIdForSetup(setupId: string): Promise<string> {
    const userId = await this.redis.get(`mfa-setup:${setupId}`);
    if (!userId) throw new UnauthorizedException(AUTH_ERRORS.MFA_EXPIRED);
    return userId;
  }

  private assertStrongPassword(pw: string): void {
    if (typeof pw !== "string" || pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) {
      throw new BadRequestException(
        `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters`,
      );
    }
  }

  private async emailOf(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return u?.email.toLowerCase() ?? "";
  }

  private async rehashPassword(userId: string, plain: string): Promise<void> {
    try {
      const passwordHash = await this.passwords.hash(plain);
      await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    } catch (err) {
      this.logger.warn(`Password rehash failed: ${(err as Error).message}`);
    }
  }

  /** Case-insensitive lookup so "Admin@x.org" and "admin@x.org" are the same account. */
  private findUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
  }

  private async issueSession(
    user: { id: string; fullName: string; email: string; role: Role; mfaEnabled: boolean },
    ip: string,
    ua: string,
  ): Promise<SessionResult> {
    // One database write instead of three: the token id is generated here,
    // so the refresh token can be signed first and stored in a single insert.
    const fam = this.tokens.newFamilyId();
    const tokenId = randomUUID();
    const refresh = await this.tokens.signRefresh({ sub: user.id, jti: tokenId, fam });
    const [access] = await Promise.all([
      this.tokens.signAccess({ sub: user.id, role: user.role, mfa: user.mfaEnabled }),
      this.prisma.refreshToken.create({
        data: {
          id: tokenId,
          userId: user.id,
          tokenHash: this.tokens.hashToken(refresh),
          familyId: fam,
          userAgent: ua,
          ipAddress: ip,
          expiresAt: new Date(Date.now() + this.tokens.refreshTtlSeconds * 1000),
        },
      }),
    ]);
    // Last-login time is nice to have; do not make the user wait for it.
    void this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch((err) => this.logger.warn(`lastLoginAt update failed: ${(err as Error).message}`));
    void this.audit.record({
      actorId: user.id,
      actorName: user.fullName,
      action: "auth.login.success",
      target: user.email,
      ip,
      userAgent: ua,
    });
    return { mfaRequired: false, user: this.toSafe(user), access, refresh };
  }

  private async createMfaChallenge(
    userId: string,
    method: "TOTP",
  ): Promise<{ id: string }> {
    const created = await this.prisma.mfaChallenge.create({
      data: {
        userId,
        method,
        // The column is required but unused (codes are checked against the TOTP
        // secret). A constant avoids a pointless, slow Argon2 hash per login.
        codeHash: "unused",
        expiresAt: new Date(Date.now() + MFA_CHALLENGE_TTL * 1000),
      },
    });
    return { id: created.id };
  }

  private async bumpFailure(failKey: string, lockKey: string): Promise<void> {
    try {
      const count = await this.redis.incrWithTtl(failKey, LOGIN_LOCKOUT_SECONDS);
      if (count >= LOGIN_LOCKOUT_THRESHOLD) {
        await this.redis.setEx(lockKey, LOGIN_LOCKOUT_SECONDS, "locked");
      }
    } catch (err) {
      this.logger.warn(
        `Redis unavailable: failed login not counted (${(err as Error).message})`,
      );
    }
  }

  private toSafe(user: {
    id: string;
    fullName: string;
    email: string;
    role: Role;
    mfaEnabled: boolean;
  }): SafeUser {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      mfaEnabled: user.mfaEnabled,
    };
  }
}
