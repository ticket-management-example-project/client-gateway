import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  description: string;

  /** Story 3.2: optional Requester contact channel (FR-18) -- malformed
   * input is a 400 here (`ValidationPipe`), never persisted/forwarded.
   * `@ValidateIf` (not `@IsOptional`) so an explicit empty string is ALSO
   * treated as absent, never rejected -- its absence must never block
   * creation. */
  @ValidateIf((o) => o.contactEmail !== undefined && o.contactEmail !== '')
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;
}
