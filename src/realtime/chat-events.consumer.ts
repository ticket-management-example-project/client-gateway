import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DOMAIN_EVENT_CONSUMER } from 'src/shared/config/services';
import {
  DomainEventConsumer,
  DomainEventMessage,
} from 'src/shared/kafka/domain-event-consumer.port';
import { ChatGateway } from './chat.gateway';

export const CHAT_EVENTS_TOPIC = 'tm.chatthread.events';

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
