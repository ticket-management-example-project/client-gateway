import { Module } from '@nestjs/common';
import { NatsModule } from 'src/shared/transports/nats.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TenantModule } from './tenant/tenant.module';
import { TicketModule } from './ticket/ticket.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [NatsModule, TenantModule, TicketModule, ChatModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
