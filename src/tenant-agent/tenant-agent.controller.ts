import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { catchError, firstValueFrom, timeout } from 'rxjs';
import { CurrentUserId } from 'src/auth/current-user-id.decorator';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { OrganizationMembershipService } from 'src/organization/organization-membership.service';
import { NATS_SERVICE } from 'src/shared/config/services';
import { RequestWithCorrelationId } from 'src/shared/middleware/correlation-id.middleware';
import { ClerkInvitationService } from './clerk-invitation.service';
import { InviteTenantAgentDto } from './dto/invite-tenant-agent.dto';

const RPC_TIMEOUT_MS = 5000;

interface TenantSummary {
  id: string;
}

/**
 * Same pattern as `TenantController` (guard + `assertIsOwner` + correlationId
 * + timeout/catchError/RpcException), plus a second gate: `tenantId` from the
 * route must actually belong to `organizationId` from the route (spec
 * Boundaries & Constraints) -- reuses the existing `list_tenants_by_organization`
 * NATS command rather than adding a new one, since `organizationId` ownership
 * alone would otherwise let an owner of Org A act on a `tenantId` belonging
 * to Org B just by editing the URL.
 *
 * `invite()`'s call order is deliberate and load-bearing for the I/O matrix:
 *   1. NATS `invite_tenant_agent` -- `tenant-microservice` validates
 *      same-tenant/cross-tenant duplicates and, if none, persists
 *      `TenantAgentInvited` immediately.
 *   2. Only once that succeeds do we call the real Clerk Organization
 *      Invitation API.
 * This guarantees a duplicate is rejected "sin llamar a Clerk" (I/O matrix)
 * by construction -- the Clerk call is never reached on that path. The
 * accepted risk this ordering implies (a `TenantAgent` persisted as
 * `invited` with no real Clerk invitation ever sent, if step 2 itself fails)
 * is documented in the story's Implementation Notes; there is no
 * saga/compensating transaction in v1.
 */
@Controller('organizations/:organizationId/tenants/:tenantId/agents')
export class TenantAgentController {
  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
    private readonly membership: OrganizationMembershipService,
    private readonly clerkInvitations: ClerkInvitationService,
  ) {}

  @Post()
  @HttpCode(201)
  @UseGuards(ClerkAuthGuard)
  async invite(
    @Param('organizationId') organizationId: string,
    @Param('tenantId') tenantId: string,
    @Body() dto: InviteTenantAgentDto,
    @CurrentUserId() userId: string,
    @Req() request: RequestWithCorrelationId,
  ) {
    await this.assertIsOwner(organizationId, userId);
    await this.assertTenantBelongsToOrganization(organizationId, tenantId);

    const persisted = await firstValueFrom(
      this.client
        .send(
          { cmd: 'invite_tenant_agent' },
          {
            tenantId,
            organizationId,
            email: dto.email,
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

    try {
      await this.clerkInvitations.inviteToOrganization({
        organizationId,
        inviterUserId: userId,
        emailAddress: dto.email.trim().toLowerCase(),
        tenantId,
      });
    } catch {
      throw new ServiceUnavailableException(
        'The agent was recorded but the Clerk invitation email could not be sent. Please retry.',
      );
    }

    return persisted;
  }

  @Get()
  @UseGuards(ClerkAuthGuard)
  async list(
    @Param('organizationId') organizationId: string,
    @Param('tenantId') tenantId: string,
    @CurrentUserId() userId: string,
  ) {
    await this.assertIsOwner(organizationId, userId);
    await this.assertTenantBelongsToOrganization(organizationId, tenantId);

    return firstValueFrom(
      this.client.send({ cmd: 'list_tenant_agents' }, { tenantId }).pipe(
        timeout(RPC_TIMEOUT_MS),
        catchError((error) => {
          throw new RpcException(error);
        }),
      ),
    );
  }

  private async assertIsOwner(
    organizationId: string,
    userId: string,
  ): Promise<void> {
    const isOwner = await this.membership.isOwner(userId, organizationId);
    if (!isOwner) {
      throw new ForbiddenException(
        'You do not have access to this Organization',
      );
    }
  }

  private async assertTenantBelongsToOrganization(
    organizationId: string,
    tenantId: string,
  ): Promise<void> {
    const tenants = await firstValueFrom(
      this.client
        .send<
          TenantSummary[]
        >({ cmd: 'list_tenants_by_organization' }, { organizationId })
        .pipe(
          timeout(RPC_TIMEOUT_MS),
          catchError((error) => {
            throw new RpcException(error);
          }),
        ),
    );
    const belongs = tenants.some((tenant) => tenant.id === tenantId);
    if (!belongs) {
      throw new ForbiddenException(
        'Tenant does not belong to this Organization',
      );
    }
  }
}
