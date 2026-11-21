import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { AuditService } from "../audit/audit.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { MfaService } from "./mfa.service";
import { AUTH_ERRORS } from "./auth.constants";
import type { LoginDto } from "./dto/login.dto";
import type { RegisterDto } from "./dto/register.dto";
import type { Role } from "@prisma/client";

const LOGIN_LOCKOUT_THRESHOLD = 100;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;
const MFA_CHALLENGE_TTL = 5 * 60; // 5 minutes

export type LoginResult =
  | { mfaRequired: false; user: SafeUser; access: string; refresh: string }
  | { mfaRequired: true; challengeId: string };

export type SafeUser = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  mfaEnabled: boolean;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly jwt: JwtService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  Register                                                          */
  /* ------------------------------------------------------------------ */
  async register(dto: RegisterDto, ip: string, ua: string): Promise<SafeUser> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new BadRequestException("Email already registered");

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
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

    // TODO (Batch B2): send verification email
    return this.toSafe(user);
  }

  /* ------------------------------------------------------------------ */
  /*  Login                                                             */
  /* ------------------------------------------------------------------ */
  async login(dto: LoginDto, ip: string, ua: string): Promise<LoginResult> {
    const lockKey = `lock:login:${dto.email.toLowerCase()}`;
    const locked = await this.redis.get(lockKey);
    if (locked) throw new ForbiddenException(AUTH_ERRORS.ACCOUNT_LOCKED);

    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      await this.bumpFailure(lockKey);
      void this.audit.record({
        action: "auth.login.fail",
        target: dto.email,
        ip, userAgent: ua,
        metadata: { reason: "no_user" },
      });
      throw new UnauthorizedException(AUTH_ERRORS.INVALID_CREDENTIALS);
    }

    if (user.status === "SUSPENDED") {
      throw new ForbiddenException(AUTH_ERRORS.ACCOUNT_SUSPENDED);
    }

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) {
      await this.bumpFailure(lockKey);
      void this.audit.record({
        actorId: user.id, actorName: user.fullName,
        action: "auth.login.fail", target: user.email, ip, userAgent: ua,
        metadata: { reason: "wrong_password" },
      });
      throw new UnauthorizedException(AUTH_ERRORS.INVALID_CREDENTIALS);
    }

    // MFA mandatory for admins
    const adminRoles: Role[] = ["SUPER_ADMIN", "OPERATIONS_ADMIN", "FINANCE_ADMIN"];
    const mfaRequired = user.mfaEnabled || adminRoles.includes(user.role);

    if (mfaRequired && !user.mfaEnabled) {
      throw new ForbiddenException("MFA enrollment required — visit /auth/mfa/setup");
    }

    if (user.mfaEnabled) {
      const challenge = await this.createMfaChallenge(user.id, "TOTP");
      void this.audit.record({
        actorId: user.id, actorName: user.fullName,
        action: "auth.login.mfa.challenge", target: user.email, ip, userAgent: ua,
      });
      return { mfaRequired: true, challengeId: challenge.id };
    }

    // Straight login
    return this.issueSession(user, ip, ua);
  }

  /* ------------------------------------------------------------------ */
  /*  MFA verify                                                        */
  /* ------------------------------------------------------------------ */
  async verifyMfa(challengeId: string, code: string, ip: string, ua: string): Promise<LoginResult> {
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

    const totpOk = this.mfa.verifyTotp(user.mfaSecret, code);
    const backupOk = !totpOk && (await this.mfa.consumeBackupCode(user.id, code, user.mfaBackupCodes));

    if (!totpOk && !backupOk) {
      await this.prisma.mfaChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      void this.audit.record({
        actorId: user.id, actorName: user.fullName,
        action: "auth.login.mfa.fail", ip, userAgent: ua,
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
        ip, userAgent: ua,
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

    // Rotate: revoke current, issue next
    const next = await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: "", // filled after signing
          familyId: row.familyId,
          userAgent: ua,
          ipAddress: ip,
          expiresAt: new Date(Date.now() + this.tokens.refreshTtlSeconds * 1000),
        },
      });
      const refreshRaw = await this.tokens.signRefresh({
        sub: user.id,
        jti: created.id,
        fam: row.familyId,
      });
      await tx.refreshToken.update({
        where: { id: created.id },
        data: { tokenHash: this.tokens.hashToken(refreshRaw) },
      });
      await tx.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), replacedBy: created.id },
      });
      return refreshRaw;
    });

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
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return; // silent — don't leak emails
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    // TODO (Batch B2): send email with token
    this.logger.log(`Password reset requested for ${email} — token: ${token.slice(0, 8)}…`);
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException("Invalid or expired reset token");
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordReset.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /* ------------------------------------------------------------------ */
  /*  MFA setup                                                         */
  /* ------------------------------------------------------------------ */
  async startMfaSetup(userId: string): Promise<{ qrDataUrl: string; secret: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.mfaEnabled) throw new BadRequestException("MFA already enabled");

    const { secret, qrDataUrl } = await this.mfa.generateTotpSecret(user.email);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: secret }, // pending confirmation
    });
    return { qrDataUrl, secret };
  }

  async confirmMfaSetup(
    userId: string,
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecret) throw new BadRequestException("Start MFA setup first");
    if (!this.mfa.verifyTotp(user.mfaSecret, code)) {
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
  /*  Helpers                                                           */
  /* ------------------------------------------------------------------ */
  private async issueSession(user: { id: string; fullName: string; email: string; role: Role; mfaEnabled: boolean }, ip: string, ua: string): Promise<LoginResult> {
    const fam = this.tokens.newFamilyId();
    const created = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: "",
        familyId: fam,
        userAgent: ua,
        ipAddress: ip,
        expiresAt: new Date(Date.now() + this.tokens.refreshTtlSeconds * 1000),
      },
    });
    const refresh = await this.tokens.signRefresh({ sub: user.id, jti: created.id, fam });
    await this.prisma.refreshToken.update({
      where: { id: created.id },
      data: { tokenHash: this.tokens.hashToken(refresh) },
    });
    const access = await this.tokens.signAccess({
      sub: user.id,
      role: user.role,
      mfa: user.mfaEnabled,
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    void this.audit.record({
      actorId: user.id, actorName: user.fullName,
      action: "auth.login.success", target: user.email, ip, userAgent: ua,
    });
    return { mfaRequired: false, user: this.toSafe(user), access, refresh };
  }

  private async createMfaChallenge(userId: string, method: "TOTP"): Promise<{ id: string }> {
    const created = await this.prisma.mfaChallenge.create({
      data: {
        userId,
        method,
        codeHash: await this.passwords.hash("000000"), // placeholder
        expiresAt: new Date(Date.now() + MFA_CHALLENGE_TTL * 1000),
      },
    });
    return { id: created.id };
  }

  private async bumpFailure(lockKey: string): Promise<void> {
    const count = await this.redis.incrWithTtl(lockKey, LOGIN_LOCKOUT_SECONDS);
    if (count >= LOGIN_LOCKOUT_THRESHOLD) {
      await this.redis.setEx(lockKey, LOGIN_LOCKOUT_SECONDS, "locked");
    }
  }

  private toSafe(user: { id: string; fullName: string; email: string; role: Role; mfaEnabled: boolean }): SafeUser {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      mfaEnabled: user.mfaEnabled,
    };
  }
}
