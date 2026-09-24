import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { OrganizationModule } from 'src/organization/organization.module';
import { NatsModule } from 'src/shared/transports/nats.module';
import { ClerkInvitationService } from './clerk-invitation.service';
import { TenantAgentController } from './tenant-agent.controller';

@Module({
  controllers: [TenantAgentController],
  imports: [NatsModule, AuthModule, OrganizationModule],
  providers: [ClerkInvitationService],
})
export class TenantAgentModule {}
