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
import { firstValueFrom, from, timeout } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { envs } from 'src/shared/config/envs';
import { NATS_SERVICE } from 'src/shared/config/services';
import { TenantMembershipService } from 'src/tenant/tenant-membership.service';
import { SubscribeTicketChatDto } from './dto/subscribe-ticket-chat.dto';
import {
  ChatMessagePayload,
  ChatMessageSeenPayload,
  ChatThreadSyncedPayload,
} from './chat-message.payload';

const RPC_TIMEOUT_MS = 5000;
const THREAD_SYNCED_EVENT = 'chat_thread_synced';
const MESSAGE_POSTED_EVENT = 'chat_message_posted';
const MESSAGE_SEEN_EVENT = 'chat_message_seen';

type ActorType = 'agent' | 'requester';

interface SocketData {
  actorType?: ActorType;
  userId?: string;
  /** Only ever set for the Requester branch -- the ticketId its tracking
   * token resolved to at `handleConnection`. */
  ticketId?: string;
}

interface TicketRecord {
  id: string;
  tenantId: string;
  /** Story 3.2: `null` when the Requester never captured one at creation --
   * `ChatEventsConsumer` uses this to resolve the "new reply" email's
   * destination. */
  contactEmail: string | null;
}

/**
 * `<ChatThread>`'s real-time transport (spec Tasks/Code Map), a SECOND
 * namespace (`/chat`) alongside `ProvisioningGateway`'s default namespace --
 * a Requester socket only ever carries a `trackingToken`, never a Clerk
 * `token`, and `ProvisioningGateway.handleConnection` unconditionally
 * disconnects any socket without one; a distinct namespace keeps the two
 * gateways' connection lifecycles independent (still the same underlying
 * Socket.IO server/HTTP port -- `namespace` is a Socket.IO-level concept,
 * transported over the same `/socket.io` path Console's Vite proxy already
 * forwards).
 *
 * Auth dual (spec Design Notes): `handleConnection` branches on which
 * credential the socket presents --
 *  - `auth.token` (Clerk JWT): same verification as `ProvisioningGateway`,
 *    actor = 'agent'. Tenant/Organization membership for a SPECIFIC ticket
 *    is checked later, in `handleSubscribe` (only known once a ticketId is
 *    requested).
 *  - `auth.trackingToken`: verified via NATS `verify_tracking_token`
 *    (ticket-microservice, `TrackingTokenProvider.verify()`), actor =
 *    'requester', bound to the ticketId it resolves to -- this socket may
 *    NEVER join any other ticket's room, regardless of what
 *    `subscribe_ticket_chat` is called with (spec I/O matrix: cross-Tenant
 *    room join must never succeed).
 * Neither credential present, or verification fails -> disconnect, never a
 * generic 500 (spec I/O matrix).
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: true, credentials: true },
})
export class ChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
    private readonly tenantMembership: TenantMembershipService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const data = socket.data as SocketData;
    const clerkToken = this.extractClerkToken(socket);
    if (clerkToken) {
      try {
        const verified = await verifyToken(clerkToken, {
          secretKey: envs.clerkSecretKey,
          authorizedParties: envs.clerkAuthorizedParties,
        });
        data.actorType = 'agent';
        data.userId = verified.sub;
        return;
      } catch {
        socket.disconnect(true);
        return;
      }
    }

    const trackingToken = socket.handshake.auth?.trackingToken as
      | string
      | undefined;
    if (trackingToken) {
      try {
        const result = await firstValueFrom(
          this.client
            .send<{
              ticketId: string | null;
            }>({ cmd: 'verify_tracking_token' }, { token: trackingToken })
            .pipe(timeout(RPC_TIMEOUT_MS)),
        );
        if (!result?.ticketId) {
          socket.disconnect(true);
          return;
        }
        data.actorType = 'requester';
        data.ticketId = result.ticketId;
        return;
      } catch (error) {
        this.logger.error(
          `verify_tracking_token failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        socket.disconnect(true);
        return;
      }
    }

    socket.disconnect(true);
  }

  @SubscribeMessage('subscribe_ticket_chat')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async handleSubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: SubscribeTicketChatDto,
  ): Promise<void> {
    const data = socket.data as SocketData;

    let ticketId: string;
    if (data.actorType === 'requester') {
      // Ignore dto.ticketId entirely -- the tracking token already fixed
      // which ticket this socket may ever see (spec I/O matrix).
      ticketId = data.ticketId as string;
    } else if (data.actorType === 'agent') {
      ticketId = dto.ticketId;
    } else {
      socket.disconnect(true);
      return;
    }

    const ticket = await this.fetchTicket(ticketId);
    if (!ticket) {
      socket.disconnect(true);
      return;
    }

    if (data.actorType === 'agent') {
      const allowed = await this.tenantMembership.isAgentOrOwner(
        data.userId as string,
        ticket.tenantId,
      );
      if (!allowed) {
        // I/O matrix: "Socket de un Tenant intenta unirse a la sala de otro
        // Tenant" -> disconnect, never a data leak, never a generic 500.
        socket.disconnect(true);
        return;
      }
    }

    await socket.join(this.room(ticketId));

    await this.markSeen(ticketId, data.actorType);
    const messages = await this.fetchThread(ticketId, ticket.tenantId);

    const payload: ChatThreadSyncedPayload = { ticketId, messages };
    socket.emit(THREAD_SYNCED_EVENT, payload);
  }

  /** Called by `ChatEventsConsumer` for every `ChatMessagePosted` consumed
   * from Kafka. */
  broadcastMessagePosted(ticketId: string, message: ChatMessagePayload): void {
    this.server.to(this.room(ticketId)).emit(MESSAGE_POSTED_EVENT, message);
  }

  /** Called by `ChatEventsConsumer` for every `ChatMessageSeen` consumed. */
  broadcastMessageSeen(
    ticketId: string,
    payload: ChatMessageSeenPayload,
  ): void {
    this.server.to(this.room(ticketId)).emit(MESSAGE_SEEN_EVENT, payload);
  }

  /**
   * Story 3.2: `ChatEventsConsumer`'s email-notification gate (spec I/O
   * matrix: "el email solo se dispara cuando el Requester no está
   * conectado"). Inspects the room's LIVE sockets via Socket.IO's own
   * `fetchSockets()` (never a separate presence store) -- a Requester who
   * closed the tab is simply absent from this list, no explicit disconnect
   * bookkeeping needed.
   */
  async isRequesterConnected(ticketId: string): Promise<boolean> {
    const sockets = await firstValueFrom(
      from(this.server.in(this.room(ticketId)).fetchSockets()).pipe(
        timeout(RPC_TIMEOUT_MS),
      ),
    );
    return sockets.some(
      (socket) =>
        (socket.data as SocketData | undefined)?.actorType === 'requester',
    );
  }

  private room(ticketId: string): string {
    return `ticket:${ticketId}`;
  }

  private extractClerkToken(socket: Socket): string | undefined {
    const fromAuth = socket.handshake.auth?.token as string | undefined;
    if (fromAuth) return fromAuth;
    const header = socket.handshake.headers?.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim() || undefined;
    }
    return undefined;
  }

  /** Public: also called directly by `ChatEventsConsumer` to resolve
   * `contactEmail` for the Story 3.2 email-notification path (spec Code
   * Map), reusing this same NATS lookup instead of duplicating it. */
  async fetchTicket(ticketId: string): Promise<TicketRecord | null> {
    try {
      return await firstValueFrom(
        this.client
          .send<TicketRecord | null>(
            { cmd: 'get_ticket_by_id' },
            { id: ticketId },
          )
          .pipe(timeout(RPC_TIMEOUT_MS)),
      );
    } catch (error) {
      this.logger.error(
        `get_ticket_by_id failed for ticket ${ticketId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async fetchThread(
    ticketId: string,
    tenantId: string,
  ): Promise<ChatMessagePayload[]> {
    try {
      return await firstValueFrom(
        this.client
          .send<
            ChatMessagePayload[]
          >({ cmd: 'get_chat_thread' }, { ticketId, tenantId })
          .pipe(timeout(RPC_TIMEOUT_MS)),
      );
    } catch (error) {
      this.logger.error(
        `get_chat_thread failed for ticket ${ticketId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async markSeen(
    ticketId: string,
    viewerType: ActorType,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.client
          .send({ cmd: 'mark_chat_seen' }, { ticketId, viewerType })
          .pipe(timeout(RPC_TIMEOUT_MS)),
      );
    } catch (error) {
      this.logger.error(
        `mark_chat_seen failed for ticket ${ticketId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
