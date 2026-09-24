import { Module } from '@nestjs/common';
import { OrganizationModule } from 'src/organization/organization.module';
import { NatsModule } from 'src/shared/transports/nats.module';
import { OrganizationEventsConsumer } from './organization-events.consumer';
import { ProvisioningGateway } from './provisioning.gateway';

@Module({
  imports: [NatsModule, OrganizationModule],
  providers: [ProvisioningGateway, OrganizationEventsConsumer],
})
export class RealtimeModule {}
