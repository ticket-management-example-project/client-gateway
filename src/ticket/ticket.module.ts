import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { NatsModule } from 'src/shared/transports/nats.module';
import { TicketController } from './ticket.controller';

@Module({
  controllers: [TicketController],
  imports: [NatsModule, AuthModule],
})
export class TicketModule {}
