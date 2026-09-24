import { IsNotEmpty, IsString } from 'class-validator';

export class SubscribeOrganizationDto {
  @IsString()
  @IsNotEmpty()
  organizationId: string;
}
