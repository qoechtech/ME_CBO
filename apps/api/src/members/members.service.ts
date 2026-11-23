import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EmailService } from "../email/email.service";
import type {
  SubmitApplicationDto,
  RejectApplicationDto,
  DirectoryQueryDto,
  UpdateProfileDto,
  CreateMemberDto,
  ApplicationResponse,
  MemberResponse,
  MemberDetailResponse,
  InviteResult,
} from "./dto/members.dto";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ADMIN_ROLES: Role[] = ["OPERATIONS_ADMIN", "FINANCE_ADMIN"];

type Actor = { id: string; role: Role };

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  /* ─────────────────────────────────────────────────────────── */
  /*  Public: submit an application                             */
  /* ─────────────────────────────────────────────────────────── */
  async submitApplication(dto: SubmitApplicationDto): Promise<{ id: string }> {
    const email = dto.email.toLowerCase();

    const [existingApp, existingUser] = await Promise.all([
      this.prisma.membershipApplication.findFirst({
        where: { email: { equals: email, mode: "insensitive" }, status: "PENDING" },
      }),
      this.findUserByEmail(email),
    ]);
    if (existingApp) {
      throw new BadRequestException("An application from this email is already pending review");
    }
    if (existingUser) {
      throw new BadRequestException("A member with this email already exists");
    }

    const app = await this.prisma.membershipApplication.create({
      data: {
        fullName: dto.fullName,
        email,
        phone: dto.phone,
        motivation: dto.motivation,
        skills: dto.skills ?? [],
      },
    });

    void this.audit.record({
      action: "members.application.submit",
      target: app.id,
      metadata: { email },
    });

    return { id: app.id };
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  Admin: list applications                                  */
  /* ─────────────────────────────────────────────────────────── */
  async listApplications(
    status?: "PENDING" | "APPROVED" | "REJECTED",
  ): Promise<ApplicationResponse[]> {
    const apps = await this.prisma.membershipApplication.findMany({
      where: status ? { status } : undefined,
      orderBy: { submittedAt: "desc" },
      take: 500,
    });
    return apps.map((a) => this.toApplicationResponse(a));
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  Admin: approve                                            */
  /* ─────────────────────────────────────────────────────────── */
  async approveApplication(
    appId: string,
    actorId: string,
  ): Promise<{ application: ApplicationResponse; emailSent: boolean }> {
    const app = await this.prisma.membershipApplication.findUnique({ where: { id: appId } });
    if (!app) throw new NotFoundException("Application not found");
    if (app.status !== "PENDING") {
      throw new BadRequestException(`Application already ${app.status.toLowerCase()}`);
    }

    const email = app.email.trim().toLowerCase();
    if (await this.findUserByEmail(email)) {
      throw new BadRequestException("A member with this email already exists");
    }

    // The admin has vouched for this person, so the account starts ACTIVE.
    // The member sets their own password through the emailed link.
    const userId = randomUUID();
    let updated;
    try {
      [, updated] = await this.prisma.$transaction([
        this.prisma.user.create({
          data: {
            id: userId,
            email,
            fullName: app.fullName,
            phone: app.phone,
            passwordHash: this.unusablePasswordHash(),
            role: "MEMBER",
            status: "ACTIVE",
            skills: app.skills,
            motivation: app.motivation,
          },
        }),
        this.prisma.membershipApplication.update({
          where: { id: appId },
          data: {
            status: "APPROVED",
            reviewedById: actorId,
            reviewedAt: new Date(),
            userId,
          },
        }),
      ]);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new BadRequestException("A member with this email already exists");
      }
      throw err;
    }

    const emailSent = await this.sendInvite({ id: userId, email, fullName: app.fullName });

    void this.audit.record({
      actorId,
      action: "members.application.approve",
      target: appId,
      metadata: { userId, emailSent },
    });

    return { application: this.toApplicationResponse(updated), emailSent };
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  Admin: reject                                             */
  /* ─────────────────────────────────────────────────────────── */
  async rejectApplication(
    appId: string,
    actorId: string,
    dto: RejectApplicationDto,
  ): Promise<ApplicationResponse> {
    const app = await this.prisma.membershipApplication.findUnique({ where: { id: appId } });
    if (!app) throw new NotFoundException("Application not found");
    if (app.status !== "PENDING") {
      throw new BadRequestException(`Application already ${app.status.toLowerCase()}`);
    }

    const updated = await this.prisma.membershipApplication.update({
      where: { id: appId },
      data: {
        status: "REJECTED",
        reviewedById: actorId,
        reviewedAt: new Date(),
        reviewNote: dto.note,
      },
    });

    void this.audit.record({
      actorId,
      action: "members.application.reject",
      target: appId,
      metadata: { note: dto.note },
    });

    return this.toApplicationResponse(updated);
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  Admin: add a member directly                              */
  /* ─────────────────────────────────────────────────────────── */
  async createMember(dto: CreateMemberDto, actor: Actor): Promise<InviteResult> {
    const role: Role = dto.role ?? "MEMBER";
    // Only a super admin may create another admin.
    if (ADMIN_ROLES.includes(role) && actor.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Only a super admin can add an administrator");
    }

    const email = dto.email.trim().toLowerCase();
    if (await this.findUserByEmail(email)) {
      throw new BadRequestException("A member with this email already exists");
    }

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          fullName: dto.fullName,
          phone: dto.phone ?? null,
          location: dto.location ?? null,
          skills: dto.skills ?? [],
          passwordHash: this.unusablePasswordHash(),
          role,
          status: "ACTIVE",
        },
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new BadRequestException("A member with this email already exists");
      }
      throw err;
    }

    // If this person had applied, close that application.
    await this.prisma.membershipApplication.updateMany({
      where: { email: { equals: email, mode: "insensitive" }, status: "PENDING" },
      data: {
        status: "APPROVED",
        reviewedById: actor.id,
        reviewedAt: new Date(),
        userId: user.id,
        reviewNote: "Added directly by an administrator",
      },
    });

    const emailSent = await this.sendInvite(user);

    void this.audit.record({
      actorId: actor.id,
      action: "members.create",
      target: user.id,
      metadata: { email, role, emailSent },
    });

    return { member: this.toMemberResponse(user), emailSent };
  }

  /** Sends a fresh "set your password" link to a member who has not signed in yet. */
  async resendInvite(userId: string, actorId: string): Promise<InviteResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Member not found");
    if (user.status === "SUSPENDED") {
      throw new BadRequestException("This account is suspended");
    }
    if (user.lastLoginAt) {
      throw new BadRequestException(
        "This member has already signed in. They can use “Forgot password” if needed.",
      );
    }

    const emailSent = await this.sendInvite(user);
    void this.audit.record({
      actorId,
      action: "members.invite.resend",
      target: user.id,
      metadata: { emailSent },
    });
    return { member: this.toMemberResponse(user), emailSent };
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  Verify email → activates the account                      */
  /*  (kept for accounts that still hold a verification link)   */
  /* ─────────────────────────────────────────────────────────── */
  async verifyEmail(token: string): Promise<{ ok: true }> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = await this.prisma.emailVerification.findUnique({ where: { tokenHash } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException("Invalid or expired verification token");
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: { status: "ACTIVE", emailVerified: new Date() },
      }),
      this.prisma.emailVerification.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
    ]);

    void this.audit.record({ actorId: row.userId, action: "auth.email.verified" });
    return { ok: true };
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  Directory (any authenticated member)                      */
  /* ─────────────────────────────────────────────────────────── */
  async directory(dto: DirectoryQueryDto): Promise<MemberResponse[]> {
    const where: Prisma.UserWhereInput = {
      status: "ACTIVE",
      ...(dto.role ? { role: dto.role as Role } : {}),
      ...(dto.skill ? { skills: { has: dto.skill } } : {}),
      ...(dto.q
        ? {
            OR: [
              { fullName: { contains: dto.q, mode: "insensitive" } },
              { email: { contains: dto.q, mode: "insensitive" } },
              { location: { contains: dto.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const users = await this.prisma.user.findMany({
      where,
      orderBy: { fullName: "asc" },
      take: 200,
      select: {
        id: true, fullName: true, email: true, phone: true,
        role: true, status: true, createdAt: true,
        skills: true, location: true, avatarUrl: true,
      },
    });

    return users.map((u) => this.toMemberResponse(u));
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  Member detail + personal metrics                          */
  /* ─────────────────────────────────────────────────────────── */
  async memberDetail(userId: string): Promise<MemberDetailResponse> {
    const [user, rows] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.impactLog.groupBy({
        by: ["type"],
        where: { userId },
        _sum: { value: true },
      }),
    ]);
    if (!user) throw new NotFoundException("Member not found");

    const m = { TREES_PLANTED: 0, WASTE_COLLECTED: 0, HOURS_VOLUNTEERED: 0, EVENT_ATTENDED: 0, CARBON_OFFSET: 0 };
    for (const r of rows) m[r.type] = r._sum.value ?? 0;

    return {
      ...this.toMemberResponse(user),
      bio: user.bio,
      metrics: {
        treesPlanted: m.TREES_PLANTED,
        wasteCollectedKg: m.WASTE_COLLECTED,
        volunteerHours: m.HOURS_VOLUNTEERED,
        eventsAttended: m.EVENT_ATTENDED,
      },
    };
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  Self profile update                                       */
  /* ─────────────────────────────────────────────────────────── */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<MemberResponse> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.skills !== undefined && { skills: { set: dto.skills } }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
      },
    });

    void this.audit.record({
      actorId: userId,
      action: "members.profile.update",
      target: userId,
      metadata: { fields: Object.keys(dto) },
    });

    return this.toMemberResponse(user);
  }

  /* ─────────────────────────────────────────────────────────── */
  /*  Helpers                                                   */
  /* ─────────────────────────────────────────────────────────── */

  /**
   * Creates a 7-day "set your password" link (it cancels older unused links)
   * and emails it. Returns false if the email could not be sent.
   */
  private async sendInvite(user: { id: string; email: string; fullName: string }): Promise<boolean> {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    await this.prisma.$transaction([
      this.prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      }),
    ]);

    const siteUrl = process.env.APP_ORIGIN?.split(",")[0]?.trim() ?? "http://localhost:3000";
    const url = `${siteUrl}/reset-password?token=${token}&welcome=1`;
    try {
      await this.email.sendInvite(user.email, user.fullName, url);
      return true;
    } catch (err) {
      this.logger.error(`Invitation email failed for ${user.email}: ${(err as Error).message}`);
      return false;
    }
  }

  /** A value that can never match any password; the member sets a real one by email. */
  private unusablePasswordHash(): string {
    return `!invite:${randomBytes(24).toString("hex")}`;
  }

  private findUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
  }

  private isUniqueViolation(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
  }

  private toMemberResponse(u: {
    id: string; fullName: string; email: string; phone: string | null;
    role: Role; status: "PENDING" | "ACTIVE" | "SUSPENDED"; createdAt: Date;
    skills: string[]; location: string | null; avatarUrl: string | null;
  }): MemberResponse {
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      role: u.role,
      status: u.status,
      joinedAt: u.createdAt.toISOString(),
      skills: u.skills,
      location: u.location,
      avatarUrl: u.avatarUrl,
    };
  }

  private toApplicationResponse(a: {
    id: string; fullName: string; email: string; phone: string;
    motivation: string; skills: string[]; submittedAt: Date;
    status: "PENDING" | "APPROVED" | "REJECTED"; reviewNote: string | null;
  }): ApplicationResponse {
    return {
      id: a.id,
      fullName: a.fullName,
      email: a.email,
      phone: a.phone,
      motivation: a.motivation,
      skills: a.skills,
      submittedAt: a.submittedAt.toISOString(),
      status: a.status,
      reviewNote: a.reviewNote,
    };
  }
}
