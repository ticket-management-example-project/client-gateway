import { Module } from '@nestjs/common';
import {
  ClientsModule,
  Transport,
} from '@nestjs/microservices';
import { envs } from 'src/shared/config/envs';
import { NATS_SERVICE } from 'src/shared/config/services';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NATS_SERVICE,
        transport: Transport.NATS,
        options: {
          servers: envs.natsServers,
        },
      },
    ]),
  ],
  exports: [
    ClientsModule.register([
      {
        name: NATS_SERVICE,
        transport: Transport.NATS,
        options: {
          servers: envs.natsServers,
        },
      },
    ]),
  ],
})
export class NatsModule {}
