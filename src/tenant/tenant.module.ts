import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { OrganizationModule } from 'src/organization/organization.module';
import { NatsModule } from 'src/shared/transports/nats.module';
import { TenantController } from './tenant.controller';
import { TenantMembershipService } from './tenant-membership.service';

@Module({
  controllers: [TenantController],
  imports: [NatsModule, AuthModule, OrganizationModule],
  providers: [TenantMembershipService],
  exports: [TenantMembershipService],
})
export class TenantModule {}
