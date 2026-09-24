import { Global, Module } from '@nestjs/common';
import { DOMAIN_EVENT_CONSUMER } from 'src/shared/config/services';
import { KafkaDomainEventConsumerAdapter } from './kafka-domain-event-consumer.adapter';

@Global()
@Module({
  providers: [
    {
      provide: DOMAIN_EVENT_CONSUMER,
      useClass: KafkaDomainEventConsumerAdapter,
    },
  ],
  exports: [DOMAIN_EVENT_CONSUMER],
})
export class KafkaModule {}
