import { of, throwError } from 'rxjs';
import { verifyToken } from '@clerk/backend';
import { ProvisioningGateway } from './provisioning.gateway';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));

const mockedVerifyToken = verifyToken as jest.MockedFunction<
  typeof verifyToken
>;

describe('ProvisioningGateway', () => {
  const makeGateway = (overrides?: { isOwner?: boolean }) => {
    const client = { send: jest.fn() };
    const membership = {
      isOwner: jest.fn().mockResolvedValue(overrides?.isOwner ?? true),
    };
    const gateway = new ProvisioningGateway(client as any, membership as any);
    const server = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    (gateway as any).server = server;
    return { gateway, client, server, membership };
  };

  const makeSocket = () => ({
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
    data: {} as Record<string, unknown>,
    handshake: { auth: { token: 'valid-token' }, headers: {} },
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('handleConnection', () => {
    it('disconnects a socket with no token', async () => {
      const { gateway } = makeGateway();
      const socket = { ...makeSocket(), handshake: { auth: {}, headers: {} } };

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(mockedVerifyToken).not.toHaveBeenCalled();
    });

    it('disconnects a socket whose token Clerk rejects', async () => {
      mockedVerifyToken.mockRejectedValue(new Error('invalid signature'));
      const { gateway } = makeGateway();
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(mockedVerifyToken).toHaveBeenCalledWith(
        'valid-token',
        expect.any(Object),
      );
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.data.userId).toBeUndefined();
    });

    it('accepts a socket with a valid token and binds userId to socket.data', async () => {
      mockedVerifyToken.mockResolvedValue({ sub: 'user_123' } as never);
      const { gateway } = makeGateway();
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.data.userId).toBe('user_123');
    });
  });

  describe('handleSubscribe', () => {
    it('joins the org room and emits the queried status when the caller owns the organization', async () => {
      const { gateway, client } = makeGateway({ isOwner: true });
      client.send.mockReturnValue(of({ organizationId: '1', status: 'ready' }));
      const socket = makeSocket();
      socket.data.userId = 'user_123';

      await gateway.handleSubscribe(socket as any, { organizationId: '1' });

      expect(socket.join).toHaveBeenCalledWith('org:1');
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'get_provisioning_status' },
        { organizationId: '1' },
      );
      expect(socket.emit).toHaveBeenCalledWith('provisioning_status', {
        organizationId: '1',
        status: 'ready',
      });
    });

    it('rejects without joining the room when the caller does not own the organization', async () => {
      const { gateway, client } = makeGateway({ isOwner: false });
      const socket = makeSocket();
      socket.data.userId = 'someone-else';

      await gateway.handleSubscribe(socket as any, { organizationId: '1' });

      expect(socket.join).not.toHaveBeenCalled();
      expect(client.send).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('provisioning_status_error', {
        organizationId: '1',
        message: 'Not authorized for this organization',
      });
    });

    it('degrades to status "provisioning" when infra-microservice has no record yet', async () => {
      const { gateway, client } = makeGateway({ isOwner: true });
      client.send.mockReturnValue(
        throwError(() => ({ code: 'PROVISIONING_NOT_FOUND' })),
      );
      const socket = makeSocket();
      socket.data.userId = 'user_123';

      await gateway.handleSubscribe(socket as any, { organizationId: '1' });

      expect(socket.emit).toHaveBeenCalledWith('provisioning_status', {
        organizationId: '1',
        status: 'provisioning',
      });
    });

    it('emits an explicit error event (not silence) when the resync call fails for any other reason', async () => {
      const { gateway, client } = makeGateway({ isOwner: true });
      client.send.mockReturnValue(throwError(() => new Error('NATS down')));
      const socket = makeSocket();
      socket.data.userId = 'user_123';

      await gateway.handleSubscribe(socket as any, { organizationId: '1' });

      expect(socket.emit).toHaveBeenCalledWith('provisioning_status_error', {
        organizationId: '1',
        message: 'Could not fetch the current provisioning status',
      });
    });
  });

  it('broadcast emits provisioning_status to the org room', () => {
    const { gateway, server } = makeGateway();

    gateway.broadcast({ organizationId: '1', status: 'ready' });

    expect(server.to).toHaveBeenCalledWith('org:1');
    expect(server.emit).toHaveBeenCalledWith('provisioning_status', {
      organizationId: '1',
      status: 'ready',
    });
  });
});
