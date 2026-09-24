// Must start before any other module is imported/instantiated so the
// TracerProvider is registered globally before the first span is created.
import { startTracing } from 'src/shared/otel/tracing';
startTracing();

import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { envs } from 'src/shared/config/envs';
import { DomainErrorFilter } from 'src/shared/config/exceptions/domain-error.filter';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Main-Gateway');

  // `rawBody: true` (Story 1.4): `ClerkWebhookController` needs the exact
  // unparsed request bytes to verify the Svix signature -- see NestJS's
  // "Raw body" FAQ. Requires the built-in body-parser middleware to stay
  // enabled, which it is (no `bodyParser: false` here).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
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
      // Story 1.4: Clerk posts to the literal path from the dashboard config,
      // `/webhooks/clerk` -- not `/api/webhooks/clerk` (spec Boundaries).
      {
        path: 'webhooks/clerk',
        method: RequestMethod.POST,
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
