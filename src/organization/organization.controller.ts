import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { catchError, timeout } from 'rxjs';
import { CurrentUserId } from 'src/auth/current-user-id.decorator';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { NATS_SERVICE } from 'src/shared/config/services';
import { RequestWithCorrelationId } from 'src/shared/middleware/correlation-id.middleware';
import { CreateOrganizationDto } from './dto/create-organization.dto';

const RPC_TIMEOUT_MS = 5000;

@Controller('organizations')
export class OrganizationController {
  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  @Post()
  @HttpCode(201)
  @UseGuards(ClerkAuthGuard)
  create(
    @Body() createOrganizationDto: CreateOrganizationDto,
    @CurrentUserId() userId: string,
    @Req() request: RequestWithCorrelationId,
  ) {
    return this.client
      .send(
        { cmd: 'create_organization' },
        {
          ownerId: userId,
          name: createOrganizationDto.name,
          // Gateway-side request correlationId, distinct from the domain
          // event's correlationId (= aggregate root id, frozen in the
          // spec). Carried through so the gateway request log and the
          // resulting domain event/trace can be cross-referenced -- see
          // `organization-microservice`'s span attribute
          // `gateway.correlationId`.
          correlationId: request.correlationId,
        },
      )
      .pipe(
        timeout(RPC_TIMEOUT_MS),
        catchError((error) => {
          throw new RpcException(error);
        }),
      );
  }
}
