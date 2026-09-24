import { Inject, Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { verifyToken } from '@clerk/backend';
import { firstValueFrom, timeout } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { envs } from 'src/shared/config/envs';
import { NATS_SERVICE } from 'src/shared/config/services';
import { OrganizationMembershipService } from 'src/organization/organization-membership.service';
import { SubscribeOrganizationDto } from './dto/subscribe-organization.dto';
import { ProvisioningStatusPayload } from './provisioning-status.payload';

const RPC_TIMEOUT_MS = 5000;
const STATUS_EVENT = 'provisioning_status';
const STATUS_ERROR_EVENT = 'provisioning_status_error';

/**
 * WebSocket gateway (spec Boundaries: "client-gateway expone un gateway
 * WebSocket que reenvía OrganizationProvisioned/OrganizationProvisioningFailed
 * a clientes suscritos por organizationId; nunca polling"). `@nestjs/websockets`
 * over Socket.IO, per the spec's Design Notes ("nativo del stack NestJS ya
 * usado en todo el repo").
 *
 * On every (re)connect + subscribe, does exactly ONE `get_provisioning_status`
 * NATS call to sync the client to the current real state (spec Boundaries:
 * "en reconexión, hace una única consulta a la proyección de lectura...no
 * polling continuo") -- `OrganizationEventsConsumer` is what pushes live
 * updates afterwards.
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class ProvisioningGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ProvisioningGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
    private readonly membership: OrganizationMembershipService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const token = this.extractToken(socket);
    if (!token) {
      socket.disconnect(true);
      return;
    }
    try {
      const verified = await verifyToken(token, {
        secretKey: envs.clerkSecretKey,
        authorizedParties: envs.clerkAuthorizedParties,
      });
      // Bound to the socket so `handleSubscribe` can check Organization
      // membership against the *authenticated* user, not whatever
      // `organizationId` the client happens to send.
      socket.data.userId = verified.sub;
    } catch {
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe_organization')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async handleSubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: SubscribeOrganizationDto,
  ): Promise<void> {
    const userId = socket.data?.userId as string | undefined;
    const isOwner =
      !!userId && (await this.membership.isOwner(userId, dto.organizationId));
    if (!isOwner) {
      socket.emit(STATUS_ERROR_EVENT, {
        organizationId: dto.organizationId,
        message: 'Not authorized for this organization',
      });
      return;
    }

    await socket.join(this.room(dto.organizationId));

    try {
      const status = await firstValueFrom(
        this.client
          .send<ProvisioningStatusPayload>(
            { cmd: 'get_provisioning_status' },
            { organizationId: dto.organizationId },
          )
          .pipe(timeout(RPC_TIMEOUT_MS)),
      );
      socket.emit(STATUS_EVENT, status);
    } catch (error) {
      // No record yet (e.g. infra-microservice hasn't consumed
      // OrganizationCreated yet) is not an error worth surfacing to the
      // client -- 'provisioning' is already what it optimistically shows
      // right after POST /organizations succeeds.
      if (this.isNotFound(error)) {
        socket.emit(STATUS_EVENT, {
          organizationId: dto.organizationId,
          status: 'provisioning',
        } satisfies ProvisioningStatusPayload);
        return;
      }
      // Any other resync failure: the client that just (re)subscribed must
      // still get SOMETHING, never silence -- otherwise it's stuck showing
      // stale state with no way to know the resync itself failed (I/O
      // matrix: "WebSocket desconectado... banner refleja el estado real").
      this.logger.error(
        `get_provisioning_status failed for org ${dto.organizationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      socket.emit(STATUS_ERROR_EVENT, {
        organizationId: dto.organizationId,
        message: 'Could not fetch the current provisioning status',
      });
    }
  }

  /** Called by `OrganizationEventsConsumer` for every
   * `OrganizationProvisioned`/`OrganizationProvisioningFailed` consumed. */
  broadcast(payload: ProvisioningStatusPayload): void {
    this.server
      .to(this.room(payload.organizationId))
      .emit(STATUS_EVENT, payload);
  }

  private room(organizationId: string): string {
    return `org:${organizationId}`;
  }

  private extractToken(socket: Socket): string | undefined {
    const fromAuth = socket.handshake.auth?.token as string | undefined;
    if (fromAuth) return fromAuth;
    const header = socket.handshake.headers?.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim() || undefined;
    }
    return undefined;
  }

  private isNotFound(error: unknown): boolean {
    const code = (error as { code?: string } | undefined)?.code;
    return code === 'PROVISIONING_NOT_FOUND';
  }
}
