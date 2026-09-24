import { of } from 'rxjs';
import { BadRequestException } from '@nestjs/common';

const verifyMock = jest.fn();
jest.mock('svix', () => ({
  Webhook: jest.fn().mockImplementation(() => ({ verify: verifyMock })),
}));

// Imported AFTER the mock so the controller picks up the mocked `Webhook`.
import { ClerkWebhookController } from './clerk-webhook.controller';

describe('ClerkWebhookController', () => {
  const makeController = () => {
    const client = { send: jest.fn().mockReturnValue(of({ updated: true })) };
    const controller = new ClerkWebhookController(client as any);
    return { controller, client };
  };

  const makeRequest = (overrides?: {
    body?: unknown;
    rawBody?: Buffer | undefined;
  }) => {
    const body = overrides?.body ?? {
      type: 'organizationInvitation.accepted',
      data: {
        email_address: 'agent@example.com',
        organization_id: 'org-1',
        public_metadata: { tenantId: 't-1' },
        user_id: 'user_123',
      },
    };
    return {
      body,
      rawBody:
        'rawBody' in (overrides ?? {})
          ? overrides!.rawBody
          : Buffer.from(JSON.stringify(body)),
      headers: {
        'svix-id': 'msg_1',
        'svix-timestamp': '123',
        'svix-signature': 'v1,signature',
      },
    } as any;
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects with 400 and does not call NATS when the Svix signature is invalid', async () => {
    verifyMock.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    const { controller, client } = makeController();

    await expect(controller.handle(makeRequest())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(client.send).not.toHaveBeenCalled();
  });

  it('rejects with 400 when the raw body is missing (rawBody capture misconfigured)', async () => {
    const { controller, client } = makeController();

    await expect(
      controller.handle(makeRequest({ rawBody: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.send).not.toHaveBeenCalled();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('dispatches accept_tenant_agent with tenantId/email/clerkUserId on a valid organizationInvitation.accepted event', async () => {
    verifyMock.mockReturnValue(undefined);
    const { controller, client } = makeController();

    const result = await controller.handle(makeRequest());

    expect(client.send).toHaveBeenCalledWith(
      { cmd: 'accept_tenant_agent' },
      { tenantId: 't-1', email: 'agent@example.com', clerkUserId: 'user_123' },
    );
    expect(result).toEqual({ received: true });
  });

  it('ignores (200, no NATS call) any event type other than organizationInvitation.accepted', async () => {
    verifyMock.mockReturnValue(undefined);
    const { controller, client } = makeController();

    const result = await controller.handle(
      makeRequest({
        body: { type: 'organizationMembership.created', data: {} },
      }),
    );

    expect(client.send).not.toHaveBeenCalled();
    expect(result).toEqual({ received: true });
  });

  it('ignores (200, no NATS call, logs warning) a payload missing tenantId in publicMetadata -- e.g. a dead Tenant', async () => {
    verifyMock.mockReturnValue(undefined);
    const { controller, client } = makeController();

    const result = await controller.handle(
      makeRequest({
        body: {
          type: 'organizationInvitation.accepted',
          data: { email_address: 'agent@example.com', public_metadata: {} },
        },
      }),
    );

    expect(client.send).not.toHaveBeenCalled();
    expect(result).toEqual({ received: true });
  });
});
