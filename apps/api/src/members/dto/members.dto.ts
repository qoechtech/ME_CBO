import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { ApplicationStatus, Role, UserStatus } from "@prisma/client";

const trim = () =>
  Transform(({ value }) => (typeof value === "string" ? value.trim() : value));
const lowerTrim = () =>
  Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  );
const trimEach = () =>
  Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === "string" ? v.trim() : v)).filter(Boolean)
      : value,
  );

const ROLE_VALUES = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "FINANCE_ADMIN",
  "TEAM_LEAD",
  "MEMBER",
] as const;

const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

/** Avatars may only come from the storage hosts the web app is configured for. */
const AVATAR_RE =
  /^https:\/\/(res\.cloudinary\.com|me-cbo-assets\.s3\.amazonaws\.com)\//;

/* ─── Public application ────────────────────────────────────── */

export class SubmitApplicationDto {
  @ApiProperty()
  @trim()
  @IsString() @MinLength(2) @MaxLength(120)
  fullName!: string;

  @ApiProperty()
  @lowerTrim()
  @IsEmail() @MaxLength(254)
  email!: string;

  @ApiProperty()
  @trim()
  @IsString() @Matches(PHONE_RE, { message: "Enter a valid phone number" })
  phone!: string;

  @ApiProperty()
  @trim()
  @IsString() @MinLength(20) @MaxLength(1000)
  motivation!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @trimEach()
  @IsArray() @ArrayMaxSize(20)
  @IsString({ each: true }) @MaxLength(40, { each: true })
  skills?: string[];
}

/** Body of POST /members/verify-email */
export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]+$/, { message: "Invalid token" })
  token!: string;
}

/* ─── Admin: add a member directly ──────────────────────────── */

/** Roles an admin may assign when adding someone. SUPER_ADMIN is never created here. */
export const CREATABLE_ROLES = [
  "MEMBER",
  "TEAM_LEAD",
  "OPERATIONS_ADMIN",
  "FINANCE_ADMIN",
] as const;

export class CreateMemberDto {
  @ApiProperty()
  @trim()
  @IsString() @MinLength(2) @MaxLength(120)
  fullName!: string;

  @ApiProperty()
  @lowerTrim()
  @IsEmail() @MaxLength(254)
  email!: string;

  @ApiPropertyOptional()
  @IsOptional() @trim() @IsString()
  @Matches(PHONE_RE, { message: "Enter a valid phone number" })
  phone?: string;

  @ApiPropertyOptional({ enum: CREATABLE_ROLES, default: "MEMBER" })
  @IsOptional() @IsIn(CREATABLE_ROLES)
  role?: (typeof CREATABLE_ROLES)[number];

  @ApiPropertyOptional()
  @IsOptional() @trim() @IsString() @MaxLength(120)
  location?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @trimEach()
  @IsArray() @ArrayMaxSize(20)
  @IsString({ each: true }) @MaxLength(40, { each: true })
  skills?: string[];
}

/* ─── Review ────────────────────────────────────────────────── */

export class RejectApplicationDto {
  @ApiProperty()
  @trim()
  @IsString() @MinLength(3) @MaxLength(500)
  note!: string;
}

/* ─── Directory query ───────────────────────────────────────── */

export class DirectoryQueryDto {
  @ApiPropertyOptional()
  @IsOptional() @trim() @IsString() @MaxLength(120)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional() @trim() @IsString() @MaxLength(60)
  skill?: string;

  @ApiPropertyOptional({ enum: ROLE_VALUES })
  @IsOptional() @IsIn(ROLE_VALUES)
  role?: Role;
}

/* ─── Self profile update ───────────────────────────────────── */

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional() @trim() @IsString() @MinLength(2) @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional() @trim() @IsString()
  @Matches(PHONE_RE, { message: "Enter a valid phone number" })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional() @trim() @IsString() @MaxLength(120)
  location?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @trimEach()
  @IsArray() @ArrayMaxSize(20)
  @IsString({ each: true }) @MaxLength(40, { each: true })
  skills?: string[];

  @ApiPropertyOptional()
  @IsOptional() @trim() @IsString() @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({ description: "https URL on the app's Cloudinary or S3 storage" })
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @Matches(AVATAR_RE, { message: "Avatar must be uploaded through the app" })
  avatarUrl?: string;
}

/* ─── Response shapes ───────────────────────────────────────── */

export type ApplicationResponse = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  motivation: string;
  skills: string[];
  submittedAt: string;
  status: ApplicationStatus;
  reviewNote: string | null;
};

export type MemberResponse = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  joinedAt: string;
  skills: string[];
  location: string | null;
  avatarUrl: string | null;
};

export type MemberDetailResponse = MemberResponse & {
  bio: string | null;
  metrics: {
    treesPlanted: number;
    wasteCollectedKg: number;
    volunteerHours: number;
    eventsAttended: number;
  };
};

/** Result of adding a member directly (or resending an invitation). */
export type InviteResult = {
  member: MemberResponse;
  /** false when the email could not be sent; the admin can use "Resend invitation". */
  emailSent: boolean;
};
