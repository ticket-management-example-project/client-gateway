import { Module } from '@nestjs/common';
import { OrganizationModule } from 'src/organization/organization.module';
import { TenantModule } from 'src/tenant/tenant.module';
import { NatsModule } from 'src/shared/transports/nats.module';
import { OrganizationEventsConsumer } from './organization-events.consumer';
import { ProvisioningGateway } from './provisioning.gateway';
import { ChatGateway } from './chat.gateway';
import { ChatEventsConsumer } from './chat-events.consumer';

@Module({
  imports: [NatsModule, OrganizationModule, TenantModule],
  providers: [
    ProvisioningGateway,
    OrganizationEventsConsumer,
    ChatGateway,
    ChatEventsConsumer,
  ],
})
export class RealtimeModule {}
