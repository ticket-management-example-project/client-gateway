import { NestFactory } from '@nestjs/core';
import { envs } from 'src/shared/config/envs';
import { RpcCustomExceptionFilter } from 'src/shared/config/exceptions/rpc-custom-exception.filter';
import { AppModule } from './app.module';
import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Main-Gateway');

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api', {
    exclude: [
      {
        path: '',
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

  app.useGlobalFilters(new RpcCustomExceptionFilter());
  await app.listen(envs.port);
  logger.log(`Gateway running on port ${envs.port}`);
}

bootstrap();
