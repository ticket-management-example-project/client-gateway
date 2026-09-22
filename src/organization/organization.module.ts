import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { NatsModule } from 'src/shared/transports/nats.module';
import { OrganizationController } from './organization.controller';

@Module({
  controllers: [OrganizationController],
  imports: [NatsModule, AuthModule],
})
export class OrganizationModule {}
