import { IsString, Length, Matches, MaxLength, MinLength } from "class-validator";

export class PasswordResetConfirmDto {
  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]+$/, { message: "Invalid reset link" })
  token!: string;

  @IsString()
  @MinLength(12, { message: "Password must be at least 12 characters" })
  @MaxLength(128)
  newPassword!: string;
}
