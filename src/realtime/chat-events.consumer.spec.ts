import { CHAT_EVENTS_TOPIC, ChatEventsConsumer } from './chat-events.consumer';

describe('ChatEventsConsumer', () => {
  const makeConsumer = () => {
    const domainEventConsumer = {
      subscribe: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    };
    const gateway = {
      broadcastMessagePosted: jest.fn(),
      broadcastMessageSeen: jest.fn(),
    };
    const consumer = new ChatEventsConsumer(
      domainEventConsumer as any,
      gateway as any,
    );
    return { consumer, domainEventConsumer, gateway };
  };

  const getHandler = async (
    domainEventConsumer: ReturnType<typeof makeConsumer>['domainEventConsumer'],
    consumer: ChatEventsConsumer,
  ) => {
    await consumer.onModuleInit();
    expect(domainEventConsumer.subscribe).toHaveBeenCalledWith(
      CHAT_EVENTS_TOPIC,
      expect.any(Function),
    );
    return domainEventConsumer.subscribe.mock.calls[0][1];
  };

  it('forwards ChatMessagePosted to the ticket room', async () => {
    const { consumer, domainEventConsumer, gateway } = makeConsumer();
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({
      eventType: 'ChatMessagePosted',
      key: '42',
      value: {
        correlationId: '42',
        occurredAt: '2026-01-01T00:00:00.000Z',
        data: {
          ticketId: '42',
          messageId: 'm-1',
          senderType: 'requester',
          senderId: null,
          body: 'Hola',
          lang: 'es',
        },
      },
    });

    expect(gateway.broadcastMessagePosted).toHaveBeenCalledWith('42', {
      id: 'm-1',
      senderType: 'requester',
      senderId: null,
      body: 'Hola',
      lang: 'es',
      status: 'delivered',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('forwards ChatMessageSeen to the ticket room', async () => {
    const { consumer, domainEventConsumer, gateway } = makeConsumer();
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({
      eventType: 'ChatMessageSeen',
      key: '42',
      value: {
        correlationId: '42',
        data: { ticketId: '42', viewerType: 'agent' },
      },
    });

    expect(gateway.broadcastMessageSeen).toHaveBeenCalledWith('42', {
      ticketId: '42',
      viewerType: 'agent',
    });
  });

  it('ignores an unrelated eventType', async () => {
    const { consumer, domainEventConsumer, gateway } = makeConsumer();
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({
      eventType: 'TicketCreated',
      key: '42',
      value: { correlationId: '42', data: {} },
    });

    expect(gateway.broadcastMessagePosted).not.toHaveBeenCalled();
    expect(gateway.broadcastMessageSeen).not.toHaveBeenCalled();
  });

  it('skips a malformed ChatMessagePosted message with no data/ticketId', async () => {
    const { consumer, domainEventConsumer, gateway } = makeConsumer();
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({ eventType: 'ChatMessagePosted', key: '42', value: {} });

    expect(gateway.broadcastMessagePosted).not.toHaveBeenCalled();
  });

  it('skips a ChatMessagePosted message missing messageId/senderType/body instead of defaulting senderType to agent', async () => {
    const { consumer, domainEventConsumer, gateway } = makeConsumer();
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({
      eventType: 'ChatMessagePosted',
      key: '42',
      value: {
        correlationId: '42',
        occurredAt: '2026-01-01T00:00:00.000Z',
        data: { ticketId: '42' },
      },
    });

    expect(gateway.broadcastMessagePosted).not.toHaveBeenCalled();
  });
});
