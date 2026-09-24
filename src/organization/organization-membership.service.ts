import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { NATS_SERVICE } from 'src/shared/config/services';

interface OrganizationRecord {
  id: string;
  ownerId: string;
}

const RPC_TIMEOUT_MS = 5000;

/**
 * Organization-membership check, reusing organization-microservice's own
 * read model (Story 1.1) via NATS `get_organization`. Used to keep both the
 * realtime provisioning WebSocket channel and the "Reintentar" retry
 * endpoint scoped to the Organization's owner -- an authenticated user
 * cannot subscribe to, or retry provisioning for, an Organization they
 * don't own just by knowing/guessing its id.
 */
@Injectable()
export class OrganizationMembershipService {
  private readonly logger = new Logger(OrganizationMembershipService.name);

  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  async isOwner(userId: string, organizationId: string): Promise<boolean> {
    try {
      const organization = await firstValueFrom(
        this.client
          .send<OrganizationRecord | null>(
            { cmd: 'get_organization' },
            { id: organizationId },
          )
          .pipe(timeout(RPC_TIMEOUT_MS)),
      );
      return organization?.ownerId === userId;
    } catch (error) {
      // Fail closed: a lookup error (organization-microservice down/slow)
      // must never be treated as "is the owner".
      this.logger.error(
        `get_organization failed for org ${organizationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
