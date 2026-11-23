import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiTags, ApiCookieAuth, ApiOperation } from "@nestjs/swagger";
import { MembersService } from "./members.service";
import {
  SubmitApplicationDto,
  RejectApplicationDto,
  DirectoryQueryDto,
  UpdateProfileDto,
  VerifyEmailDto,
  CreateMemberDto,
} from "./dto/members.dto";
import { Public } from "../auth/decorators/public.decorator";
import { RequirePermissions } from "../auth/decorators/permissions.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AccessClaims } from "../auth/token.service";

/* ─── Public routes ────────────────────────────────────────── */

@ApiTags("members")
@Controller("members")
export class MembersPublicController {
  constructor(private readonly members: MembersService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("applications")
  @HttpCode(201)
  @ApiOperation({ summary: "Submit a membership application" })
  async submit(@Body() dto: SubmitApplicationDto) {
    return this.members.submitApplication(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("verify-email")
  @HttpCode(200)
  @ApiOperation({ summary: "Verify email via token" })
  async verify(@Body() body: VerifyEmailDto) {
    return this.members.verifyEmail(body.token);
  }
}

/* ─── Admin routes ─────────────────────────────────────────── */
/* Declared BEFORE MembersController in members.module.ts, so that
   GET /members/applications is not captured by GET /members/:id. */

@ApiTags("members")
@ApiCookieAuth("me_access")
@Controller("members/applications")
export class MembersAdminController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermissions("members:approve")
  async list(@Query("status") status?: "PENDING" | "APPROVED" | "REJECTED") {
    const items = await this.members.listApplications(status);
    return { items };
  }

  @Post(":id/approve")
  @HttpCode(200)
  @RequirePermissions("members:approve")
  async approve(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() claims: AccessClaims,
  ) {
    const { application, emailSent } = await this.members.approveApplication(id, claims.sub);
    return { application, emailSent };
  }

  @Post(":id/reject")
  @HttpCode(200)
  @RequirePermissions("members:approve")
  async reject(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: RejectApplicationDto,
    @CurrentUser() claims: AccessClaims,
  ) {
    const application = await this.members.rejectApplication(id, claims.sub, dto);
    return { application };
  }
}

/* ─── Authenticated routes ─────────────────────────────────── */

@ApiTags("members")
@ApiCookieAuth("me_access")
@Controller("members")
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @ApiOperation({ summary: "Directory — search + filters" })
  async list(@Query() q: DirectoryQueryDto) {
    const items = await this.members.directory(q);
    return { items };
  }

  /** Admin adds a member directly. They receive an email to set their own password. */
  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions("members:create")
  @ApiOperation({ summary: "Add a member directly (admin)" })
  async create(@Body() dto: CreateMemberDto, @CurrentUser() claims: AccessClaims) {
    return this.members.createMember(dto, { id: claims.sub, role: claims.role });
  }

  /** Sends a new "set your password" link to a member who has never signed in. */
  @Post(":id/resend-invite")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions("members:create")
  async resendInvite(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() claims: AccessClaims,
  ) {
    return this.members.resendInvite(id, claims.sub);
  }

  @Get("me")
  @ApiOperation({ summary: "My member profile with impact metrics" })
  async me(@CurrentUser() claims: AccessClaims) {
    const member = await this.members.memberDetail(claims.sub);
    return { member };
  }

  @Patch("me")
  async updateMe(@CurrentUser() claims: AccessClaims, @Body() dto: UpdateProfileDto) {
    const member = await this.members.updateProfile(claims.sub, dto);
    return { member };
  }

  @Get(":id")
  async detail(@Param("id", new ParseUUIDPipe()) id: string) {
    const member = await this.members.memberDetail(id);
    return { member };
  }
}
