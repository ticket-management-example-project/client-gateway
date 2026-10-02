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
import { CorrectTriageDto } from './dto/correct-triage.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';

const RPC_TIMEOUT_MS = 5000;

interface TicketRecord {
  id: string;
  tenantId: string;
  subject: string;
  description: string;
  status: string;
  categoryId?: string | null;
  priority?: string | null;
  suggestedAgentId?: string | null;
  triageReview?: string | null;
}

interface TriageCategoryRecord {
  id: string;
  name: string;
  isActive: boolean;
}

interface TriageAgentRecord {
  id: string;
  email: string;
  status: string;
}

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
  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
    private readonly tenantMembership: TenantMembershipService,
  ) {}

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
            contactEmail: dto.contactEmail,
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

  /** Story 2.2: links the Ticket behind `token` to the caller's lightweight
   * Clerk account -- PROTECTED, unlike the two endpoints above (an
   * anonymous caller has no account to link to). `requesterId` is Clerk's
   * `sub` claim, resolved by `ClerkAuthGuard`/`CurrentUserId()`, never taken
   * from the request body. */
  @Post('tickets/track/:token/link-account')
  @HttpCode(200)
  @UseGuards(ClerkAuthGuard)
  async linkToAccount(
    @Param('token') token: string,
    @CurrentUserId() requesterId: string,
    @Req() request: RequestWithCorrelationId,
  ) {
    return firstValueFrom(
      this.client
        .send(
          { cmd: 'link_ticket_to_account' },
          { token, requesterId, correlationId: request.correlationId },
        )
        .pipe(
          timeout(RPC_TIMEOUT_MS),
          catchError((error) => {
            throw new RpcException(error);
          }),
        ),
    );
  }

  /** Story 2.2: the Requester Portal's account-history screen (`console`'s
   * `/t/:slug/my-tickets`) -- every Ticket linked to the caller's account,
   * scoped to `tenantSlug` alone (never cross-Tenant, I/O matrix). */
  @Get('t/:tenantSlug/my-tickets')
  @UseGuards(ClerkAuthGuard)
  async myTickets(
    @Param('tenantSlug') tenantSlug: string,
    @CurrentUserId() requesterId: string,
    @Req() request: RequestWithCorrelationId,
  ) {
    return firstValueFrom(
      this.client
        .send(
          { cmd: 'get_tickets_by_requester' },
          {
            tenantSlug,
            requesterId,
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

  /** Story 3.1: Console's new Agent-side ticket detail page (`/tickets/:ticketId`)
   * -- unlike every endpoint above, `ticketId` is a raw aggregate id, not the
   * Requester's opaque tracking token, so this is PROTECTED and additionally
   * gated by Tenant/Organization membership (spec Design Notes: same check
   * `ChatGateway` uses for its Agent auth branch) -- an authenticated Agent
   * of Tenant A must never read a Ticket belonging to Tenant B just by
   * guessing/incrementing its id. */
  @Get('tickets/:ticketId')
  @UseGuards(ClerkAuthGuard)
  async getById(
    @Param('ticketId') ticketId: string,
    @CurrentUserId() userId: string,
  ) {
    const ticket = await this.loadTicketForAgent(ticketId, userId);

    // Explicit whitelist -- `get_ticket_by_id`'s NATS response also carries
    // the Requester's `contactEmail` (Story 3.2), which only `ChatGateway`'s
    // internal lookup needs; it must never reach this Agent-facing HTTP
    // response. Story 5.2 adds the triage fields for `card-triage`.
    return {
      id: ticket.id,
      tenantId: ticket.tenantId,
      subject: ticket.subject,
      description: ticket.description,
      status: ticket.status,
      categoryId: ticket.categoryId ?? null,
      priority: ticket.priority ?? null,
      suggestedAgentId: ticket.suggestedAgentId ?? null,
      triageReview: ticket.triageReview ?? null,
    };
  }

  /** Story 5.2: the human queue of one Tenant -- Agent-or-owner only. */
  @Get('tenants/:tenantId/tickets')
  @UseGuards(ClerkAuthGuard)
  async listByTenant(
    @Param('tenantId') tenantId: string,
    @CurrentUserId() userId: string,
  ) {
    await this.assertTenantAccess(userId, tenantId);

    return this.rpc({ cmd: 'list_tickets_by_tenant' }, { tenantId });
  }

  /** Story 5.2: names for the queue's category/agent columns and the
   * options of "Corregir". Whitelisted shape -- no Clerk ids leave here. */
  @Get('tenants/:tenantId/triage-options')
  @UseGuards(ClerkAuthGuard)
  async triageOptions(
    @Param('tenantId') tenantId: string,
    @CurrentUserId() userId: string,
  ) {
    await this.assertTenantAccess(userId, tenantId);

    const [categories, agents] = await Promise.all([
      this.rpc<TriageCategoryRecord[]>(
        { cmd: 'list_tenant_categories' },
        { tenantId },
      ),
      this.rpc<TriageAgentRecord[]>(
        { cmd: 'list_tenant_agents' },
        { tenantId },
      ),
    ]);

    return {
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        isActive: c.isActive,
      })),
      agents: agents.map((a) => ({
        id: a.id,
        email: a.email,
        status: a.status,
      })),
    };
  }

  /** Story 5.2 (FR10): "Confirmar" -- one click, no body. */
  @Post('tickets/:ticketId/triage/confirm')
  @HttpCode(200)
  @UseGuards(ClerkAuthGuard)
  async confirmTriage(
    @Param('ticketId') ticketId: string,
    @CurrentUserId() userId: string,
  ) {
    await this.loadTicketForAgent(ticketId, userId);

    const changed = await this.rpc<boolean>(
      { cmd: 'confirm_ticket_triage' },
      { ticketId, reviewedBy: userId },
    );
    return { changed };
  }

  /** Story 5.2 (FR10): "Corregir" -- category/priority/agent, the Tenant's
   * own options are validated by `ticket-microservice`. */
  @Post('tickets/:ticketId/triage/correct')
  @HttpCode(200)
  @UseGuards(ClerkAuthGuard)
  async correctTriage(
    @Param('ticketId') ticketId: string,
    @Body() dto: CorrectTriageDto,
    @CurrentUserId() userId: string,
  ) {
    await this.loadTicketForAgent(ticketId, userId);

    const changed = await this.rpc<boolean>(
      { cmd: 'correct_ticket_triage' },
      {
        ticketId,
        categoryId: dto.categoryId,
        priority: dto.priority,
        suggestedAgentId: dto.suggestedAgentId ?? null,
        reviewedBy: userId,
      },
    );
    return { changed };
  }

  /** Resolves a Ticket by id and enforces Tenant membership -- 404 when it
   * doesn't exist, 403 for a non-member (shared by every Agent-side ticket
   * endpoint). */
  private async loadTicketForAgent(
    ticketId: string,
    userId: string,
  ): Promise<TicketRecord> {
    const ticket = await this.rpc<TicketRecord | null>(
      { cmd: 'get_ticket_by_id' },
      { id: ticketId },
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

  private async assertTenantAccess(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    const allowed = await this.tenantMembership.isAgentOrOwner(
      userId,
      tenantId,
    );
    if (!allowed) {
      throw new ForbiddenException('You do not have access to this Tenant');
    }
  }

  private rpc<T = unknown>(pattern: object, payload: object): Promise<T> {
    return firstValueFrom(
      this.client.send<T>(pattern, payload).pipe(
        timeout(RPC_TIMEOUT_MS),
        catchError((error) => {
          throw new RpcException(error);
        }),
      ),
    );
  }
}
