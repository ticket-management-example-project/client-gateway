import { EmailSendException } from 'src/shared/email/email-send.exception';
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
      isRequesterConnected: jest.fn().mockResolvedValue(true),
      fetchTicket: jest.fn().mockResolvedValue(null),
    };
    const emailSender = { send: jest.fn().mockResolvedValue(undefined) };
    const consumer = new ChatEventsConsumer(
      domainEventConsumer as any,
      gateway as any,
      emailSender as any,
    );
    return { consumer, domainEventConsumer, gateway, emailSender };
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

  it("never checks presence/notifies for a Requester's own message (a Requester never emails itself)", async () => {
    const { consumer, domainEventConsumer, gateway, emailSender } =
      makeConsumer();
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({
      eventType: 'ChatMessagePosted',
      key: '42',
      value: {
        data: {
          ticketId: '42',
          messageId: 'm-1',
          senderType: 'requester',
          senderId: null,
          body: 'Hola',
        },
      },
    });

    expect(gateway.isRequesterConnected).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('an agent reply while the Requester is connected never sends an email (already live + aria-live, Story 3.1)', async () => {
    const { consumer, domainEventConsumer, gateway, emailSender } =
      makeConsumer();
    gateway.isRequesterConnected.mockResolvedValue(true);
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({
      eventType: 'ChatMessagePosted',
      key: '42',
      value: {
        data: {
          ticketId: '42',
          messageId: 'm-1',
          senderType: 'agent',
          senderId: 'user_1',
          body: 'Ya lo resolvimos',
        },
      },
    });

    expect(gateway.isRequesterConnected).toHaveBeenCalledWith('42');
    expect(gateway.fetchTicket).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('an agent reply while the Requester is disconnected, WITH a captured contactEmail, sends the email', async () => {
    const { consumer, domainEventConsumer, gateway, emailSender } =
      makeConsumer();
    gateway.isRequesterConnected.mockResolvedValue(false);
    gateway.fetchTicket.mockResolvedValue({
      id: '42',
      tenantId: 't-1',
      contactEmail: 'maria@example.com',
    });
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({
      eventType: 'ChatMessagePosted',
      key: '42',
      value: {
        data: {
          ticketId: '42',
          messageId: 'm-1',
          senderType: 'agent',
          senderId: 'user_1',
          body: 'Ya lo resolvimos',
        },
      },
    });

    expect(gateway.fetchTicket).toHaveBeenCalledWith('42');
    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'maria@example.com' }),
    );
  });

  it('skips sending when the Requester reconnects between the initial presence check and the send (re-checked immediately before send)', async () => {
    const { consumer, domainEventConsumer, gateway, emailSender } =
      makeConsumer();
    gateway.isRequesterConnected
      .mockResolvedValueOnce(false) // initial gate
      .mockResolvedValueOnce(true); // re-check right before sending
    gateway.fetchTicket.mockResolvedValue({
      id: '42',
      tenantId: 't-1',
      contactEmail: 'maria@example.com',
    });
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({
      eventType: 'ChatMessagePosted',
      key: '42',
      value: {
        data: {
          ticketId: '42',
          messageId: 'm-1',
          senderType: 'agent',
          senderId: 'user_1',
          body: 'Ya lo resolvimos',
        },
      },
    });

    expect(gateway.isRequesterConnected).toHaveBeenCalledTimes(2);
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('an agent reply while the Requester is disconnected, WITHOUT a captured contactEmail, sends nothing', async () => {
    const { consumer, domainEventConsumer, gateway, emailSender } =
      makeConsumer();
    gateway.isRequesterConnected.mockResolvedValue(false);
    gateway.fetchTicket.mockResolvedValue({
      id: '42',
      tenantId: 't-1',
      contactEmail: null,
    });
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({
      eventType: 'ChatMessagePosted',
      key: '42',
      value: {
        data: {
          ticketId: '42',
          messageId: 'm-1',
          senderType: 'agent',
          senderId: 'user_1',
          body: 'Ya lo resolvimos',
        },
      },
    });

    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('an EmailSender failure is logged as a typed exception and never rethrown (broadcast already happened)', async () => {
    const { consumer, domainEventConsumer, gateway, emailSender } =
      makeConsumer();
    gateway.isRequesterConnected.mockResolvedValue(false);
    gateway.fetchTicket.mockResolvedValue({
      id: '42',
      tenantId: 't-1',
      contactEmail: 'maria@example.com',
    });
    emailSender.send.mockRejectedValue(new EmailSendException('boom'));
    const handler = await getHandler(domainEventConsumer, consumer);
    const errorSpy = jest.spyOn(
      (consumer as unknown as { logger: { error: (msg: string) => void } })
        .logger,
      'error',
    );

    await expect(
      handler({
        eventType: 'ChatMessagePosted',
        key: '42',
        value: {
          data: {
            ticketId: '42',
            messageId: 'm-1',
            senderType: 'agent',
            senderId: 'user_1',
            body: 'Ya lo resolvimos',
          },
        },
      }),
    ).resolves.toBeUndefined();

    expect(gateway.broadcastMessagePosted).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('EmailSendException'),
    );
  });

  it('logs an "Unexpected error" (not an EmailSendException) when gateway.fetchTicket rejects, and never rethrows', async () => {
    const { consumer, domainEventConsumer, gateway } = makeConsumer();
    gateway.isRequesterConnected.mockResolvedValue(false);
    gateway.fetchTicket.mockRejectedValue(new Error('NATS timeout'));
    const handler = await getHandler(domainEventConsumer, consumer);
    const errorSpy = jest.spyOn(
      (consumer as unknown as { logger: { error: (msg: string) => void } })
        .logger,
      'error',
    );

    await expect(
      handler({
        eventType: 'ChatMessagePosted',
        key: '42',
        value: {
          data: {
            ticketId: '42',
            messageId: 'm-1',
            senderType: 'agent',
            senderId: 'user_1',
            body: 'Ya lo resolvimos',
          },
        },
      }),
    ).resolves.toBeUndefined();

    expect(gateway.broadcastMessagePosted).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unexpected error notifying requester'),
    );
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
