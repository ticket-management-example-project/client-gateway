import { Module } from '@nestjs/common';
import { NatsModule } from 'src/shared/transports/nats.module';
import { ClerkWebhookController } from './clerk-webhook.controller';

@Module({
  imports: [NatsModule],
  controllers: [ClerkWebhookController],
})
export class WebhooksModule {}
