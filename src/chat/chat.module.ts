import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { TenantModule } from 'src/tenant/tenant.module';
import { NatsModule } from 'src/shared/transports/nats.module';
import { ChatController } from './chat.controller';

@Module({
  controllers: [ChatController],
  imports: [NatsModule, AuthModule, TenantModule],
})
export class ChatModule {}
