import {
  ORGANIZATION_EVENTS_TOPIC,
  OrganizationEventsConsumer,
} from './organization-events.consumer';

describe('OrganizationEventsConsumer', () => {
  const makeConsumer = () => {
    const domainEventConsumer = {
      subscribe: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
      isConnected: jest.fn().mockReturnValue(true),
    };
    const gateway = { broadcast: jest.fn() };
    const consumer = new OrganizationEventsConsumer(
      domainEventConsumer as any,
      gateway as any,
    );
    return { consumer, domainEventConsumer, gateway };
  };

  const getHandler = async (
    domainEventConsumer: ReturnType<typeof makeConsumer>['domainEventConsumer'],
    consumer: OrganizationEventsConsumer,
  ) => {
    await consumer.onModuleInit();
    expect(domainEventConsumer.subscribe).toHaveBeenCalledWith(
      ORGANIZATION_EVENTS_TOPIC,
      expect.any(Function),
    );
    return domainEventConsumer.subscribe.mock.calls[0][1];
  };

  it('forwards OrganizationProvisioned as status "ready"', async () => {
    const { consumer, domainEventConsumer, gateway } = makeConsumer();
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({
      eventType: 'OrganizationProvisioned',
      key: '1',
      value: {
        correlationId: '1',
        data: { organizationId: '1', namespace: 'org-acme-1' },
      },
    });

    expect(gateway.broadcast).toHaveBeenCalledWith({
      organizationId: '1',
      status: 'ready',
      namespace: 'org-acme-1',
      failureReason: undefined,
      failureMessage: undefined,
    });
  });

  it('forwards OrganizationProvisioningFailed as status "failed" with reason/message', async () => {
    const { consumer, domainEventConsumer, gateway } = makeConsumer();
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({
      eventType: 'OrganizationProvisioningFailed',
      key: '1',
      value: {
        correlationId: '1',
        data: {
          organizationId: '1',
          namespace: 'org-acme-1',
          reason: 'timeout',
          message: 'timed out',
        },
      },
    });

    expect(gateway.broadcast).toHaveBeenCalledWith({
      organizationId: '1',
      status: 'failed',
      namespace: 'org-acme-1',
      failureReason: 'timeout',
      failureMessage: 'timed out',
    });
  });

  it('ignores OrganizationCreated (not a provisioning status change)', async () => {
    const { consumer, domainEventConsumer, gateway } = makeConsumer();
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({
      eventType: 'OrganizationCreated',
      key: '1',
      value: { correlationId: '1', data: { id: '1', name: 'Acme' } },
    });

    expect(gateway.broadcast).not.toHaveBeenCalled();
  });

  it('ignores a message with no eventType header (cannot safely tell it apart)', async () => {
    const { consumer, domainEventConsumer, gateway } = makeConsumer();
    const handler = await getHandler(domainEventConsumer, consumer);

    await handler({ eventType: undefined, key: '1', value: {} });

    expect(gateway.broadcast).not.toHaveBeenCalled();
  });
});
