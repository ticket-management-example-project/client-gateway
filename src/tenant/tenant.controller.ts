import {
  Controller,
  Post,
  Body,
  Inject,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NATS_SERVICE } from 'src/shared/config/services';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Controller('tenant')
export class TenantController {
  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  @Post()
  create(@Body() createTenantDto: CreateTenantDto) {
    return this.client.send({ cmd: 'create_tenant' }, createTenantDto);
  }
}
