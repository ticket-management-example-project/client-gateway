// Must start before any other module is imported/instantiated so the
// TracerProvider is registered globally before the first span is created.
import { startTracing } from 'src/shared/otel/tracing';
startTracing();

import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { envs } from 'src/shared/config/envs';
import { DomainErrorFilter } from 'src/shared/config/exceptions/domain-error.filter';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Main-Gateway');

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api', {
    exclude: [
      {
        path: '',
        method: RequestMethod.GET,
      },
      {
        path: 'health',
        method: RequestMethod.GET,
      },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new DomainErrorFilter());
  await app.listen(envs.port);
  logger.log(`Gateway running on port ${envs.port}`);
}

bootstrap();
