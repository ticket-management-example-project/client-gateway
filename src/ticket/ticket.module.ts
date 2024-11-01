import { Module } from '@nestjs/common';
import { NatsModule } from 'src/shared/transports/nats.module';
import { TicketController } from './ticket.controller';

@Module({
  controllers: [TicketController],
  imports: [NatsModule],
})
export class TicketModule {}
