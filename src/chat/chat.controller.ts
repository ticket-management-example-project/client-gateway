import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { catchError, firstValueFrom, timeout } from 'rxjs';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { CurrentUserId } from 'src/auth/current-user-id.decorator';
import { NATS_SERVICE } from 'src/shared/config/services';
import { RequestWithCorrelationId } from 'src/shared/middleware/correlation-id.middleware';
import { TenantMembershipService } from 'src/tenant/tenant-membership.service';
import { PostMessageDto } from './dto/post-message.dto';

const RPC_TIMEOUT_MS = 5000;

interface TicketRecord {
  id: string;
  tenantId: string;
}

/**
 * Story 3.1: real send/history endpoints for both Chat surfaces (spec
 * Tasks), replacing the placeholder scaffold. Same NATS RPC pattern
 * (timeout + catchError + RpcException) as `ticket.controller.ts`.
 *
 * Portal (Requester, anonymous, tracking-token-scoped) and Console (Agent,
 * Clerk-authenticated) each resolve their own `{ticketId, tenantId}` first
 * -- never trusting a client-supplied `tenantId` -- then delegate to the
 * SAME `chat-microservice` NATS commands. This mirrors `ChatGateway`'s dual
 * auth branches (spec Design Notes) at the REST layer.
 */
@Controller()
export class ChatController {
  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
    private readonly tenantMembership: TenantMembershipService,
  ) {}

  /** Requester Portal, PUBLIC (spec Boundaries: "el token es la
   * autenticación", same as `TicketController.trackByToken`). */
  @Post('tickets/track/:token/messages')
  @HttpCode(201)
  async sendAsRequester(
    @Param('token') token: string,
    @Body() dto: PostMessageDto,
    @Req() request: RequestWithCorrelationId,
  ) {
    const ticket = await this.resolveTicketByToken(token);

    return this.postMessage({
      ticketId: ticket.id,
      senderType: 'requester',
      senderId: null,
      body: dto.body,
      lang: dto.lang,
      correlationId: request.correlationId,
    });
  }

  /** Requester Portal, PUBLIC. */
  @Get('tickets/track/:token/messages')
  async getThreadAsRequester(
    @Param('token') token: string,
    @Req() request: RequestWithCorrelationId,
  ) {
    const ticket = await this.resolveTicketByToken(token);

    // Resync-on-load: the Requester looking at this screen is exactly the
    // "other party reconnected" moment (I/O matrix: "al reconectar el
    // Requester ... pasa a visto") -- mark any Agent-authored messages still
    // "entregado" as seen before returning the thread.
    await this.markSeen(ticket.id, 'requester', request.correlationId);

    return this.getThread(ticket.id, ticket.tenantId);
  }

  /** Console (Agent), AUTHENTICATED + Tenant-membership-gated (spec Design
   * Notes: same check `ChatGateway` uses). */
  @Post('tickets/:ticketId/messages')
  @HttpCode(201)
  @UseGuards(ClerkAuthGuard)
  async sendAsAgent(
    @Param('ticketId') ticketId: string,
    @Body() dto: PostMessageDto,
    @CurrentUserId() userId: string,
    @Req() request: RequestWithCorrelationId,
  ) {
    const ticket = await this.resolveTicketForAgent(ticketId, userId);

    return this.postMessage({
      ticketId: ticket.id,
      senderType: 'agent',
      senderId: userId,
      body: dto.body,
      lang: dto.lang,
      correlationId: request.correlationId,
    });
  }

  /** Console (Agent), AUTHENTICATED + Tenant-membership-gated. */
  @Get('tickets/:ticketId/messages')
  @UseGuards(ClerkAuthGuard)
  async getThreadAsAgent(
    @Param('ticketId') ticketId: string,
    @CurrentUserId() userId: string,
    @Req() request: RequestWithCorrelationId,
  ) {
    const ticket = await this.resolveTicketForAgent(ticketId, userId);

    await this.markSeen(ticket.id, 'agent', request.correlationId);

    return this.getThread(ticket.id, ticket.tenantId);
  }

  private async resolveTicketByToken(token: string): Promise<TicketRecord> {
    const ticketId = await firstValueFrom(
      this.client
        .send<{ ticketId: string | null }>(
          { cmd: 'verify_tracking_token' },
          { token },
        )
        .pipe(
          timeout(RPC_TIMEOUT_MS),
          catchError((error) => {
            throw new RpcException(error);
          }),
        ),
    ).then((result) => result.ticketId);

    if (!ticketId) {
      throw new NotFoundException('Ticket not found');
    }

    const ticket = await firstValueFrom(
      this.client
        .send<TicketRecord | null>({ cmd: 'get_ticket_by_id' }, { id: ticketId })
        .pipe(
          timeout(RPC_TIMEOUT_MS),
          catchError((error) => {
            throw new RpcException(error);
          }),
        ),
    );

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }

  private async resolveTicketForAgent(
    ticketId: string,
    userId: string,
  ): Promise<TicketRecord> {
    const ticket = await firstValueFrom(
      this.client
        .send<TicketRecord | null>({ cmd: 'get_ticket_by_id' }, { id: ticketId })
        .pipe(
          timeout(RPC_TIMEOUT_MS),
          catchError((error) => {
            throw new RpcException(error);
          }),
        ),
    );

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const allowed = await this.tenantMembership.isAgentOrOwner(
      userId,
      ticket.tenantId,
    );
    if (!allowed) {
      throw new ForbiddenException('You do not have access to this Ticket');
    }

    return ticket;
  }

  private async postMessage(payload: {
    ticketId: string;
    senderType: 'agent' | 'requester';
    senderId: string | null;
    body: string;
    lang?: string;
    correlationId?: string;
  }) {
    return firstValueFrom(
      this.client.send({ cmd: 'post_chat_message' }, payload).pipe(
        timeout(RPC_TIMEOUT_MS),
        catchError((error) => {
          throw new RpcException(error);
        }),
      ),
    );
  }

  private async getThread(ticketId: string, tenantId: string) {
    return firstValueFrom(
      this.client
        .send({ cmd: 'get_chat_thread' }, { ticketId, tenantId })
        .pipe(
          timeout(RPC_TIMEOUT_MS),
          catchError((error) => {
            throw new RpcException(error);
          }),
        ),
    );
  }

  private async markSeen(
    ticketId: string,
    viewerType: 'agent' | 'requester',
    correlationId?: string,
  ) {
    try {
      await firstValueFrom(
        this.client
          .send(
            { cmd: 'mark_chat_seen' },
            { ticketId, viewerType, correlationId },
          )
          .pipe(timeout(RPC_TIMEOUT_MS)),
      );
    } catch {
      // Never let a resync failure block reading the thread itself (I/O
      // matrix: viewing history must always succeed even if the "seen" side
      // effect momentarily can't be recorded).
    }
  }
}
