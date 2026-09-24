import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { NatsModule } from 'src/shared/transports/nats.module';
import { KafkaModule } from 'src/shared/kafka/kafka.module';
import { CorrelationIdMiddleware } from 'src/shared/middleware/correlation-id.middleware';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { HealthModule } from './health/health.module';
import { OrganizationModule } from './organization/organization.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantAgentModule } from './tenant-agent/tenant-agent.module';
import { TicketModule } from './ticket/ticket.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    NatsModule,
    KafkaModule,
    AuthModule,
    TenantModule,
    TenantAgentModule,
    TicketModule,
    ChatModule,
    OrganizationModule,
    RealtimeModule,
    WebhooksModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
