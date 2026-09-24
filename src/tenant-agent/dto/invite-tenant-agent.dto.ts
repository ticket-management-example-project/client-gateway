import { IsEmail, IsNotEmpty } from 'class-validator';

export class InviteTenantAgentDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
