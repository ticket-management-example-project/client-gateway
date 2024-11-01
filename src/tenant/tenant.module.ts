import { Module } from '@nestjs/common';
import { NatsModule } from 'src/shared/transports/nats.module';
import { TenantController } from './tenant.controller';

@Module({
  controllers: [TenantController],
  imports: [NatsModule],
})
export class TenantModule {}
