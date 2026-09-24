import { Injectable, Logger } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { envs } from 'src/shared/config/envs';

/**
 * Clerk has no "human agent" role concept of its own (spec "Never": no
 * roles/permissions in this story) -- `role` is required by
 * `createOrganizationInvitation` regardless, so every agent gets Clerk's
 * baseline Organization member role. This is Clerk's own membership role,
 * unrelated to any future in-app agent role/permission model (Epic 4+).
 */
const DEFAULT_ORGANIZATION_ROLE = 'org:member';

export interface InviteToOrganizationParams {
  organizationId: string;
  inviterUserId: string;
  emailAddress: string;
  tenantId: string;
}

/**
 * Thin wrapper around `@clerk/backend`'s real Organization Invitations API
 * (spec Approach: "client-gateway invoca la API real de Clerk ... embebiendo
 * tenantId en publicMetadata"). `tenant-microservice` never sees this class
 * or the Clerk SDK (spec Boundaries: "tenant-microservice sigue siendo
 * NATS-only, sin SDK de Clerk").
 *
 * Called from `TenantAgentController.invite()` only AFTER the NATS
 * `invite_tenant_agent` command has already validated + persisted the
 * `TenantAgent` domain state -- see that controller's doc comment for why
 * the ordering matters (I/O matrix: a duplicate must never reach Clerk).
 */
@Injectable()
export class ClerkInvitationService {
  private readonly logger = new Logger(ClerkInvitationService.name);
  private readonly clerkClient = createClerkClient({
    secretKey: envs.clerkSecretKey,
  });

  async inviteToOrganization(
    params: InviteToOrganizationParams,
  ): Promise<{ id: string }> {
    const invitation =
      await this.clerkClient.organizations.createOrganizationInvitation({
        organizationId: params.organizationId,
        inviterUserId: params.inviterUserId,
        emailAddress: params.emailAddress,
        role: DEFAULT_ORGANIZATION_ROLE,
        publicMetadata: { tenantId: params.tenantId },
      });

    this.logger.log(
      `Clerk Organization Invitation ${invitation.id} sent to ${params.emailAddress} (tenantId=${params.tenantId})`,
    );

    return { id: invitation.id };
  }
}
