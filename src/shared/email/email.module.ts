import { Global, Module } from '@nestjs/common';
import { EMAIL_SENDER } from 'src/shared/config/services';
import { ConsoleLogEmailSenderAdapter } from './console-log-email-sender.adapter';

/** Same `@Global()` + token-DI shape as `KafkaModule` -- registered once in
 * `AppModule`, consumed by `ChatEventsConsumer` (`realtime` module) without
 * a direct import. */
@Global()
@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      useClass: ConsoleLogEmailSenderAdapter,
    },
  ],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
