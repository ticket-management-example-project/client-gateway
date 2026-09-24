import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { NatsModule } from 'src/shared/transports/nats.module';
import { OrganizationController } from './organization.controller';
import { OrganizationMembershipService } from './organization-membership.service';

@Module({
  controllers: [OrganizationController],
  imports: [NatsModule, AuthModule],
  providers: [OrganizationMembershipService],
  exports: [OrganizationMembershipService],
})
export class OrganizationModule {}
