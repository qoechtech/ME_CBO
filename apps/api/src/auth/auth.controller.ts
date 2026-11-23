import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { MfaVerifyDto } from "./dto/mfa-verify.dto";
import { PasswordResetRequestDto } from "./dto/password-reset-request.dto";
import { PasswordResetConfirmDto } from "./dto/password-reset-confirm.dto";
import { PasswordChangeDto } from "./dto/password-change.dto";
import { MfaSetupConfirmDto } from "./dto/mfa-setup-confirm.dto";
import {
  MfaSetupTicketStartDto,
  MfaSetupTicketConfirmDto,
} from "./dto/mfa-setup-ticket.dto";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from "./auth.constants";
import { Public } from "./decorators/public.decorator";
import { CurrentUser } from "./decorators/current-user.decorator";
import type { AccessClaims } from "./token.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Cookie options are read when a response is built (not at import time),
 * so values from .env / Render environment are always picked up.
 * Leave COOKIE_DOMAIN unset when the frontend proxies /api to this API.
 */
function cookieBase() {
  return {
    httpOnly: true as const,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "strict" as const,
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

function setAuthCookies(res: Response, access: string, refresh: string) {
  res.cookie(ACCESS_COOKIE, access, {
    ...cookieBase(),
    path: "/",
    maxAge: 15 * 60 * 1000,
  });
  res.cookie(REFRESH_COOKIE, refresh, {
    ...cookieBase(),
    path: REFRESH_COOKIE_PATH,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookies(res: Response) {
  const domain = process.env.COOKIE_DOMAIN || undefined;
  res.clearCookie(ACCESS_COOKIE, { path: "/", domain });
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, domain });
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Login — sets HttpOnly cookies on success" })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(
      dto,
      req.ip ?? "unknown",
      req.headers["user-agent"] ?? "",
    );

    // Admin without MFA yet: no cookies, just a short-lived setup ticket.
    if ("mfaSetupRequired" in result) {
      return { mfaSetupRequired: true, setupId: result.setupId };
    }
    if (result.mfaRequired) {
      return { mfaRequired: true, challengeId: result.challengeId };
    }
    setAuthCookies(res, result.access, result.refresh);
    return { mfaRequired: false, user: result.user };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("mfa/verify")
  @HttpCode(200)
  async mfaVerify(
    @Body() dto: MfaVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyMfa(
      dto.challengeId,
      dto.code,
      req.ip ?? "unknown",
      req.headers["user-agent"] ?? "",
    );
    if (result.mfaRequired) throw new UnauthorizedException();
    setAuthCookies(res, result.access, result.refresh);
    return { user: result.user };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("register")
  @HttpCode(201)
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const user = await this.auth.register(
      dto,
      req.ip ?? "unknown",
      req.headers["user-agent"] ?? "",
    );
    return { user };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) throw new UnauthorizedException();
    const result = await this.auth.refresh(
      raw,
      req.ip ?? "unknown",
      req.headers["user-agent"] ?? "",
    );
    if (result.mfaRequired) throw new UnauthorizedException();
    setAuthCookies(res, result.access, result.refresh);
    return { user: result.user };
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.auth.logout(raw);
    clearAuthCookies(res);
    return { ok: true };
  }

  @Get("me")
  async me(@CurrentUser() claims: AccessClaims) {
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user) throw new UnauthorizedException();
    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        mfaEnabled: user.mfaEnabled,
      },
    };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post("password/reset-request")
  @HttpCode(200)
  async requestReset(@Body() dto: PasswordResetRequestDto) {
    await this.auth.requestPasswordReset(dto.email);
    return { ok: true }; // always 200 — don't leak emails
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("password/reset-confirm")
  @HttpCode(200)
  async confirmReset(@Body() dto: PasswordResetConfirmDto) {
    await this.auth.confirmPasswordReset(dto.token, dto.newPassword);
    return { ok: true };
  }

  /** Signed-in member changes their own password. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("password/change")
  @HttpCode(200)
  async changePassword(
    @CurrentUser() claims: AccessClaims,
    @Body() dto: PasswordChangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.changePassword(
      claims.sub,
      dto.currentPassword,
      dto.newPassword,
      req.ip ?? "unknown",
      req.headers["user-agent"] ?? "",
    );
    setAuthCookies(res, r.access, r.refresh);
    return { ok: true };
  }

  /* ─── MFA setup for logged-in users ─────────────────────────── */

  @Post("mfa/setup/start")
  async mfaSetupStart(@CurrentUser() claims: AccessClaims) {
    return this.auth.startMfaSetup(claims.sub);
  }

  @Post("mfa/setup/confirm")
  async mfaSetupConfirm(
    @CurrentUser() claims: AccessClaims,
    @Body() dto: MfaSetupConfirmDto,
  ) {
    return this.auth.confirmMfaSetup(claims.sub, dto.code);
  }

  /* ─── MFA setup for admins enrolling at first login ─────────── */
  /* These use the one-time setup ticket returned by login, so they
     are public: the ticket is the proof that the password was correct. */

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("mfa/setup/ticket/start")
  @HttpCode(200)
  async mfaTicketStart(@Body() dto: MfaSetupTicketStartDto) {
    return this.auth.startMfaSetupWithTicket(dto.setupId);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("mfa/setup/ticket/confirm")
  @HttpCode(200)
  async mfaTicketConfirm(
    @Body() dto: MfaSetupTicketConfirmDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.confirmMfaSetupWithTicket(
      dto.setupId,
      dto.code,
      req.ip ?? "unknown",
      req.headers["user-agent"] ?? "",
    );
    setAuthCookies(res, r.access, r.refresh);
    return { user: r.user, backupCodes: r.backupCodes };
  }
}
