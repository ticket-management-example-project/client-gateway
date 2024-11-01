import { Module } from '@nestjs/common';
import { NatsModule } from 'src/shared/transports/nats.module';
import { ChatController } from './chat.controller';

@Module({
  controllers: [ChatController],
  imports: [NatsModule],
})
export class ChatModule {}
