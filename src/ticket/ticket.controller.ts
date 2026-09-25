import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { catchError, firstValueFrom, timeout } from 'rxjs';
import { NATS_SERVICE } from 'src/shared/config/services';
import { RequestWithCorrelationId } from 'src/shared/middleware/correlation-id.middleware';
import { CreateTicketDto } from './dto/create-ticket.dto';

const RPC_TIMEOUT_MS = 5000;

/**
 * Story 2.1: the Requester Portal's two PUBLIC endpoints -- deliberately no
 * `@UseGuards(ClerkAuthGuard)` on either (spec Boundaries & Constraints:
 * "sin ClerkAuthGuard"). An unauthenticated Requester (María) has no
 * account, no ownership check applies -- `create()` is scoped by
 * `tenantSlug` alone, and `trackByToken()`'s only "authentication" is
 * possessing the opaque token itself (spec: "el token es la autenticación").
 * Same NATS RPC pattern (timeout + catchError + RpcException) as
 * `tenant-agent.controller.ts`, minus the ownership checks that don't apply
 * to an anonymous caller.
 */
@Controller()
export class TicketController {
  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  /** Requester Portal's ticket-creation form (`console`'s `/t/:slug`). */
  @Post('t/:tenantSlug/tickets')
  @HttpCode(201)
  async create(
    @Param('tenantSlug') tenantSlug: string,
    @Body() dto: CreateTicketDto,
    @Req() request: RequestWithCorrelationId,
  ) {
    return firstValueFrom(
      this.client
        .send(
          { cmd: 'create_ticket' },
          {
            tenantSlug,
            subject: dto.subject,
            description: dto.description,
            correlationId: request.correlationId,
          },
        )
        .pipe(
          timeout(RPC_TIMEOUT_MS),
          catchError((error) => {
            throw new RpcException(error);
          }),
        ),
    );
  }

  /** Requester Portal's no-account follow-up screen (`console`'s
   * `/t/:slug/track/:token`). A malformed/unknown/dead token all produce the
   * same neutral `TICKET_NOT_FOUND` -- `ticket-microservice` never tells
   * this controller (or the Requester) which case occurred. */
  @Get('tickets/track/:token')
  async trackByToken(@Param('token') token: string) {
    return firstValueFrom(
      this.client.send({ cmd: 'get_ticket_by_token' }, { token }).pipe(
        timeout(RPC_TIMEOUT_MS),
        catchError((error) => {
          throw new RpcException(error);
        }),
      ),
    );
  }
}
