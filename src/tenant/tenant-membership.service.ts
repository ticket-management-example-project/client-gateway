import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { OrganizationMembershipService } from 'src/organization/organization-membership.service';
import { NATS_SERVICE } from 'src/shared/config/services';

interface TenantRecord {
  id: string;
  organizationId: string;
}

interface TenantAgentRecord {
  clerkUserId: string | null;
  status: string;
}

const RPC_TIMEOUT_MS = 5000;

/**
 * Story 3.1: the Agent-side auth check `ChatGateway`/agent-facing ticket
 * endpoints need -- "membership al Tenant/Organization del ticket" (spec
 * Design Notes). An authenticated Clerk user may act on a Tenant's Ticket
 * either as that Tenant's Organization OWNER (Story 1.1's single-owner
 * model, reused via `OrganizationMembershipService`) OR as an ACCEPTED
 * `TenantAgent` of that specific Tenant (Story 1.4) -- either is enough,
 * checked in that order so the common case (owner testing their own portal)
 * never pays for the second NATS round-trip.
 *
 * Fails closed like `OrganizationMembershipService.isOwner`: any lookup
 * error (tenant-microservice/NATS down) is never treated as "is a member".
 */
@Injectable()
export class TenantMembershipService {
  private readonly logger = new Logger(TenantMembershipService.name);

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
    private readonly organizationMembership: OrganizationMembershipService,
  ) {}

  /** Resolves `tenantId`'s owning Tenant record -- `null` if the Ticket's
   * `tenantId` somehow does not resolve (should not happen in practice; a
   * Ticket always references a live Tenant, AD invariant enforced at
   * creation time). */
  async findTenant(tenantId: string): Promise<TenantRecord | null> {
    try {
      return await firstValueFrom(
        this.client
          .send<TenantRecord | null>({ cmd: 'get_tenant_by_id' }, { id: tenantId })
          .pipe(timeout(RPC_TIMEOUT_MS)),
      );
    } catch (error) {
      this.logger.error(
        `get_tenant_by_id failed for tenant ${tenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  async isAgentOrOwner(userId: string, tenantId: string): Promise<boolean> {
    const tenant = await this.findTenant(tenantId);
    if (!tenant) {
      return false;
    }

    const isOwner = await this.organizationMembership.isOwner(
      userId,
      tenant.organizationId,
    );
    if (isOwner) {
      return true;
    }

    try {
      const agents = await firstValueFrom(
        this.client
          .send<TenantAgentRecord[]>({ cmd: 'list_tenant_agents' }, { tenantId })
          .pipe(timeout(RPC_TIMEOUT_MS)),
      );
      return agents.some(
        (agent) => agent.clerkUserId === userId && agent.status === 'active',
      );
    } catch (error) {
      this.logger.error(
        `list_tenant_agents failed for tenant ${tenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
