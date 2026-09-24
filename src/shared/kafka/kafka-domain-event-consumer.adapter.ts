import { Injectable, Logger } from '@nestjs/common';
import { Consumer, Kafka, KafkaMessage } from 'kafkajs';
import { envs } from 'src/shared/config/envs';
import {
  DomainEventConsumer,
  DomainEventHandler,
  DomainEventMessage,
} from './domain-event-consumer.port';

/** The only file in this service allowed to `import ... from 'kafkajs'`. */
@Injectable()
export class KafkaDomainEventConsumerAdapter implements DomainEventConsumer {
  private readonly logger = new Logger(KafkaDomainEventConsumerAdapter.name);
  private readonly kafka = new Kafka({
    clientId: 'client-gateway',
    brokers: envs.kafkaBrokers,
  });
  private consumer: Consumer | null = null;
  private connected = false;

  async subscribe(topic: string, handler: DomainEventHandler): Promise<void> {
    this.consumer = this.kafka.consumer({ groupId: envs.kafkaGroupId });

    // /health must report "down" after a real outage, not just before the
    // first successful connect -- listen for kafkajs's own CRASH/DISCONNECT
    // events instead of only ever setting `connected = true` once.
    this.consumer.on(this.consumer.events.CRASH, () => {
      this.connected = false;
    });
    this.consumer.on(this.consumer.events.DISCONNECT, () => {
      this.connected = false;
    });

    await this.consumer.connect();
    this.connected = true;
    await this.consumer.subscribe({ topic, fromBeginning: false });

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        try {
          await handler(this.toDomainMessage(message));
        } catch (error) {
          this.logger.error(
            `Failed to handle message from "${topic}": ${
              error instanceof Error ? error.stack : String(error)
            }`,
          );
        }
      },
    });

    this.logger.log(`Kafka consumer subscribed to "${topic}"`);
  }

  async disconnect(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private toDomainMessage(message: KafkaMessage): DomainEventMessage {
    const eventTypeHeader = message.headers?.eventType;
    return {
      eventType: eventTypeHeader ? eventTypeHeader.toString() : undefined,
      key: message.key ? message.key.toString() : null,
      value: message.value ? JSON.parse(message.value.toString()) : null,
    };
  }
}
