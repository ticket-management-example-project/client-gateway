import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { NatsModule } from 'src/shared/transports/nats.module';
import { CorrelationIdMiddleware } from 'src/shared/middleware/correlation-id.middleware';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { HealthModule } from './health/health.module';
import { OrganizationModule } from './organization/organization.module';
import { TenantModule } from './tenant/tenant.module';
import { TicketModule } from './ticket/ticket.module';

@Module({
  imports: [
    NatsModule,
    AuthModule,
    TenantModule,
    TicketModule,
    ChatModule,
    OrganizationModule,
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
