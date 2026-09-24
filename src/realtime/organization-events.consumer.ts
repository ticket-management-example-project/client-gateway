import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DOMAIN_EVENT_CONSUMER } from 'src/shared/config/services';
import {
  DomainEventConsumer,
  DomainEventMessage,
} from 'src/shared/kafka/domain-event-consumer.port';
import { ProvisioningStatusPayload } from './provisioning-status.payload';
import { ProvisioningGateway } from './provisioning.gateway';

export const ORGANIZATION_EVENTS_TOPIC = 'tm.organization.events';
const FORWARDED_EVENT_TYPES = new Set([
  'OrganizationProvisioned',
  'OrganizationProvisioningFailed',
]);

interface ProvisioningEventEnvelope {
  correlationId?: string;
  data?: {
    organizationId?: string;
    namespace?: string;
    reason?: string;
    message?: string;
  };
}

/**
 * Consumes `tm.organization.events` (same topic `infra-microservice`
 * consumes `OrganizationCreated` from) and forwards only
 * `OrganizationProvisioned`/`OrganizationProvisioningFailed` to subscribed
 * WebSocket clients (spec Boundaries: "client-gateway expone un gateway
 * WebSocket que reenvía... nunca polling"). `OrganizationCreated` itself is
 * ignored here — it isn't part of the provisioning status the banner
 * displays.
 */
@Injectable()
export class OrganizationEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrganizationEventsConsumer.name);

  constructor(
    @Inject(DOMAIN_EVENT_CONSUMER)
    private readonly consumer: DomainEventConsumer,
    private readonly gateway: ProvisioningGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.consumer.subscribe(ORGANIZATION_EVENTS_TOPIC, (message) =>
      this.handle(message),
    );
  }

  private async handle(message: DomainEventMessage): Promise<void> {
    if (!message.eventType || !FORWARDED_EVENT_TYPES.has(message.eventType)) {
      return;
    }

    const envelope = message.value as ProvisioningEventEnvelope | null;
    const organizationId =
      envelope?.data?.organizationId ?? envelope?.correlationId;
    if (!organizationId) {
      this.logger.warn(
        `Skipping malformed ${message.eventType} message: ${JSON.stringify(message.value)}`,
      );
      return;
    }

    const payload: ProvisioningStatusPayload = {
      organizationId,
      status:
        message.eventType === 'OrganizationProvisioned' ? 'ready' : 'failed',
      namespace: envelope?.data?.namespace,
      failureReason: envelope?.data?.reason,
      failureMessage: envelope?.data?.message,
    };

    this.gateway.broadcast(payload);
  }
}
