import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { TenantModule } from 'src/tenant/tenant.module';
import { NatsModule } from 'src/shared/transports/nats.module';
import { TicketController } from './ticket.controller';

@Module({
  controllers: [TicketController],
  imports: [NatsModule, AuthModule, TenantModule],
})
export class TicketModule {}
