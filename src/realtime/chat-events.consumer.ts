import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { firstValueFrom, from, timeout } from 'rxjs';
import {
  DOMAIN_EVENT_CONSUMER,
  EMAIL_SENDER,
} from 'src/shared/config/services';
import {
  DomainEventConsumer,
  DomainEventMessage,
} from 'src/shared/kafka/domain-event-consumer.port';
import { EmailSender } from 'src/shared/email/email-sender.port';
import { EmailSendException } from 'src/shared/email/email-send.exception';
import { ChatGateway } from './chat.gateway';

export const CHAT_EVENTS_TOPIC = 'tm.chatthread.events';
const RPC_TIMEOUT_MS = 5000;

interface ChatMessagePostedEnvelope {
  correlationId?: string;
  data?: {
    ticketId?: string;
    messageId?: string;
    senderType?: 'agent' | 'requester';
    senderId?: string | null;
    body?: string;
    lang?: string | null;
  };
  occurredAt?: string;
}

interface ChatMessageSeenEnvelope {
  correlationId?: string;
  data?: {
    ticketId?: string;
    viewerType?: 'agent' | 'requester';
  };
}

/**
 * Consumes `tm.chatthread.events` (Debezium's outbox router, routing by
 * `chat-microservice`'s `aggregate_type` = 'chatthread') and forwards
 * `ChatMessagePosted`/`ChatMessageSeen` to subscribed WebSocket clients via
 * `ChatGateway.broadcast*` -- same shape as `OrganizationEventsConsumer`.
 * This is the ONLY path a message reaches a socket OTHER than the sender's
 * own (spec I/O matrix: "el envío nunca bloquea por destinatario
 * desconectado" -- the REST `post_chat_message` call already succeeded and
 * returned before this consumer ever sees the event).
 */
@Injectable()
export class ChatEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(ChatEventsConsumer.name);

  constructor(
    @Inject(DOMAIN_EVENT_CONSUMER)
    private readonly consumer: DomainEventConsumer,
    private readonly gateway: ChatGateway,
    @Inject(EMAIL_SENDER)
    private readonly emailSender: EmailSender,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consumer.subscribe(CHAT_EVENTS_TOPIC, (message) =>
      this.handle(message),
    );
  }

  private async handle(message: DomainEventMessage): Promise<void> {
    if (message.eventType === 'ChatMessagePosted') {
      return this.handlePosted(message);
    }
    if (message.eventType === 'ChatMessageSeen') {
      return this.handleSeen(message);
    }
  }

  private async handlePosted(message: DomainEventMessage): Promise<void> {
    const envelope = message.value as ChatMessagePostedEnvelope | null;
    const ticketId = envelope?.data?.ticketId ?? envelope?.correlationId;
    // Every field the payload below actually relies on must be present --
    // a message missing any of them is just as malformed as one missing
    // `data`/`ticketId` entirely (previously `senderType` silently defaulted
    // to 'agent', which could mislabel a Requester's message).
    if (
      !ticketId ||
      !envelope?.data ||
      !envelope.data.messageId ||
      !envelope.data.senderType ||
      !envelope.data.body
    ) {
      this.logger.warn(
        `Skipping malformed ChatMessagePosted message: ${JSON.stringify(message.value)}`,
      );
      return;
    }

    this.gateway.broadcastMessagePosted(ticketId, {
      id: envelope.data.messageId,
      senderType: envelope.data.senderType,
      senderId: envelope.data.senderId ?? null,
      body: envelope.data.body,
      lang: envelope.data.lang ?? null,
      status: 'delivered',
      createdAt: envelope.occurredAt ?? new Date().toISOString(),
    });

    // Story 3.2 (FR-18): the broadcast above already happened -- everything
    // from here on is a best-effort side effect that must never affect it.
    // Only the agent->Requester direction notifies; the Requester's own
    // messages never trigger an email to themselves.
    if (envelope.data.senderType === 'agent') {
      await this.notifyRequesterIfDisconnected(ticketId);
    }
  }

  private async notifyRequesterIfDisconnected(ticketId: string): Promise<void> {
    try {
      const connected = await this.gateway.isRequesterConnected(ticketId);
      if (connected) {
        // Already covered live by the broadcast + Story 3.1's aria-live --
        // an email here would be redundant (spec I/O matrix).
        return;
      }

      const ticket = await this.gateway.fetchTicket(ticketId);
      if (!ticket?.contactEmail) {
        // No channel captured at creation -- the Requester still sees the
        // reply on reopening their tracking link (Story 3.1, no regression);
        // nothing to send here (spec I/O matrix).
        return;
      }

      // Re-check right before sending: the two lookups above (presence +
      // NATS round-trip for the ticket) take enough wall-clock time for the
      // Requester to reconnect in between, which would otherwise fire a
      // redundant email despite the AC "nunca se dispara un email" while
      // active.
      const stillDisconnected =
        !(await this.gateway.isRequesterConnected(ticketId));
      if (!stillDisconnected) {
        return;
      }

      await firstValueFrom(
        from(
          this.emailSender.send({
            to: ticket.contactEmail,
            subject: 'Nueva respuesta en tu ticket',
            body: 'Un agente respondió tu ticket. Volvé a tu link de seguimiento para verla.',
          }),
        ).pipe(timeout(RPC_TIMEOUT_MS)),
      );
    } catch (error) {
      // Never let a notification failure bubble up past this point -- the
      // message was already broadcast/persisted successfully (spec
      // Boundaries: "el envío nunca bloquea... una falla se loguea con
      // excepción tipada, nunca un throw crudo").
      this.logger.error(
        error instanceof EmailSendException
          ? `EmailSendException notifying requester for ticket ${ticketId}: ${error.message}`
          : `Unexpected error notifying requester for ticket ${ticketId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
      );
    }
  }

  private async handleSeen(message: DomainEventMessage): Promise<void> {
    const envelope = message.value as ChatMessageSeenEnvelope | null;
    const ticketId = envelope?.data?.ticketId ?? envelope?.correlationId;
    const viewerType = envelope?.data?.viewerType;
    if (!ticketId || !viewerType) {
      this.logger.warn(
        `Skipping malformed ChatMessageSeen message: ${JSON.stringify(message.value)}`,
      );
      return;
    }

    this.gateway.broadcastMessageSeen(ticketId, { ticketId, viewerType });
  }
}
