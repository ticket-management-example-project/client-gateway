import { Controller, Get } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import {
  HealthCheck,
  HealthCheckService,
  MicroserviceHealthIndicator,
} from '@nestjs/terminus';
import { envs } from 'src/shared/config/envs';

/**
 * Real `/health`, never a fixed 200. `client-gateway` has no database of its
 * own; its only external dependency is the NATS broker it uses to reach the
 * downstream microservices.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly microservice: MicroserviceHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () =>
        this.microservice.pingCheck('nats', {
          transport: Transport.NATS,
          options: { servers: envs.natsServers },
        }),
    ]);
  }
}
