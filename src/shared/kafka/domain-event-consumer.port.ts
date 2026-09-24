/**
 * Same port as `infra-microservice/src/shared/kafka/domain-event-consumer.port.ts`
 * (duplicated, not shared, since services in this repo don't share code
 * today): `client-gateway` becomes the second real Kafka consumer, listening
 * for `OrganizationProvisioned`/`OrganizationProvisioningFailed` to forward
 * over WebSocket. `kafkajs` must never be imported outside
 * `kafka-domain-event-consumer.adapter.ts`.
 */
export interface DomainEventMessage {
  eventType?: string;
  key: string | null;
  value: Record<string, unknown> | null;
}

export type DomainEventHandler = (message: DomainEventMessage) => Promise<void>;

export interface DomainEventConsumer {
  subscribe(topic: string, handler: DomainEventHandler): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}
