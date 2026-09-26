import { of, throwError } from 'rxjs';
import { verifyToken } from '@clerk/backend';
import { ChatGateway } from './chat.gateway';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));

const mockedVerifyToken = verifyToken as jest.MockedFunction<
  typeof verifyToken
>;

describe('ChatGateway', () => {
  const makeGateway = (overrides?: { isAgentOrOwner?: boolean }) => {
    const client = { send: jest.fn() };
    const tenantMembership = {
      isAgentOrOwner: jest
        .fn()
        .mockResolvedValue(overrides?.isAgentOrOwner ?? true),
    };
    const gateway = new ChatGateway(client as any, tenantMembership as any);
    const server = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([]) }),
    };
    (gateway as any).server = server;
    return { gateway, client, server, tenantMembership };
  };

  const makeSocket = (handshake: Record<string, unknown> = {}) => ({
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
    data: {} as Record<string, unknown>,
    handshake: { auth: {}, headers: {}, ...handshake },
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('handleConnection', () => {
    it('disconnects a socket with neither a Clerk token nor a tracking token', async () => {
      const { gateway } = makeGateway();
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('authenticates the Agent branch via Clerk JWT', async () => {
      mockedVerifyToken.mockResolvedValue({ sub: 'user_123' } as never);
      const { gateway } = makeGateway();
      const socket = makeSocket({ auth: { token: 'valid-token' } });

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.data.actorType).toBe('agent');
      expect(socket.data.userId).toBe('user_123');
    });

    it('disconnects when Clerk rejects the token', async () => {
      mockedVerifyToken.mockRejectedValue(new Error('invalid signature'));
      const { gateway } = makeGateway();
      const socket = makeSocket({ auth: { token: 'bad-token' } });

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('authenticates the Requester branch via a valid tracking token, binding its resolved ticketId', async () => {
      const { gateway, client } = makeGateway();
      client.send.mockReturnValue(of({ ticketId: '42' }));
      const socket = makeSocket({ auth: { trackingToken: 'tok-123' } });

      await gateway.handleConnection(socket as any);

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'verify_tracking_token' },
        { token: 'tok-123' },
      );
      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.data.actorType).toBe('requester');
      expect(socket.data.ticketId).toBe('42');
    });

    it('disconnects for an unknown/malformed tracking token', async () => {
      const { gateway, client } = makeGateway();
      client.send.mockReturnValue(of({ ticketId: null }));
      const socket = makeSocket({ auth: { trackingToken: 'bad-token' } });

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('handleSubscribe', () => {
    it('Requester branch joins the room bound to ITS OWN ticketId, ignoring the dto', async () => {
      const { gateway, client } = makeGateway();
      client.send.mockImplementation((pattern: { cmd: string }) => {
        if (pattern.cmd === 'get_ticket_by_id') {
          return of({ id: '42', tenantId: 't-1' });
        }
        if (pattern.cmd === 'get_chat_thread') {
          return of([]);
        }
        return of(undefined);
      });
      const socket = makeSocket();
      socket.data = { actorType: 'requester', ticketId: '42' };

      // Attempting to smuggle a DIFFERENT ticketId in the subscribe payload.
      await gateway.handleSubscribe(socket as any, { ticketId: '999' });

      expect(socket.join).toHaveBeenCalledWith('ticket:42');
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'get_ticket_by_id' },
        { id: '42' },
      );
      expect(socket.emit).toHaveBeenCalledWith('chat_thread_synced', {
        ticketId: '42',
        messages: [],
      });
    });

    it('Agent branch joins the room when Tenant membership check passes', async () => {
      const { gateway, client, tenantMembership } = makeGateway({
        isAgentOrOwner: true,
      });
      client.send.mockImplementation((pattern: { cmd: string }) => {
        if (pattern.cmd === 'get_ticket_by_id') {
          return of({ id: '42', tenantId: 't-1' });
        }
        if (pattern.cmd === 'get_chat_thread') {
          return of([]);
        }
        return of(undefined);
      });
      const socket = makeSocket();
      socket.data = { actorType: 'agent', userId: 'user_1' };

      await gateway.handleSubscribe(socket as any, { ticketId: '42' });

      expect(tenantMembership.isAgentOrOwner).toHaveBeenCalledWith(
        'user_1',
        't-1',
      );
      expect(socket.join).toHaveBeenCalledWith('ticket:42');
    });

    it('Agent branch disconnects (never a data leak) when membership check fails -- cross-Tenant room join', async () => {
      const { gateway, client } = makeGateway({ isAgentOrOwner: false });
      client.send.mockReturnValue(of({ id: '42', tenantId: 't-other' }));
      const socket = makeSocket();
      socket.data = { actorType: 'agent', userId: 'user_1' };

      await gateway.handleSubscribe(socket as any, { ticketId: '42' });

      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects when the ticket does not resolve', async () => {
      const { gateway, client } = makeGateway();
      client.send.mockReturnValue(of(null));
      const socket = makeSocket();
      socket.data = { actorType: 'agent', userId: 'user_1' };

      await gateway.handleSubscribe(socket as any, { ticketId: 'missing' });

      expect(socket.join).not.toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects a socket with no resolved actorType', async () => {
      const { gateway } = makeGateway();
      const socket = makeSocket();
      socket.data = {};

      await gateway.handleSubscribe(socket as any, { ticketId: '42' });

      expect(socket.disconnect).toHaveBeenCalledWith(true);
    });
  });

  it('broadcastMessagePosted emits chat_message_posted to the ticket room', () => {
    const { gateway, server } = makeGateway();

    gateway.broadcastMessagePosted('42', {
      id: 'm-1',
      senderType: 'agent',
      senderId: 'user_1',
      body: 'Hola',
      lang: null,
      status: 'delivered',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(server.to).toHaveBeenCalledWith('ticket:42');
    expect(server.emit).toHaveBeenCalledWith(
      'chat_message_posted',
      expect.objectContaining({ id: 'm-1', body: 'Hola' }),
    );
  });

  it('broadcastMessageSeen emits chat_message_seen to the ticket room', () => {
    const { gateway, server } = makeGateway();

    gateway.broadcastMessageSeen('42', { ticketId: '42', viewerType: 'requester' });

    expect(server.to).toHaveBeenCalledWith('ticket:42');
    expect(server.emit).toHaveBeenCalledWith('chat_message_seen', {
      ticketId: '42',
      viewerType: 'requester',
    });
  });

  describe('isRequesterConnected', () => {
    it('returns true when a socket with actorType "requester" is in the room', async () => {
      const { gateway, server } = makeGateway();
      server.in.mockReturnValue({
        fetchSockets: jest
          .fn()
          .mockResolvedValue([
            { data: { actorType: 'agent' } },
            { data: { actorType: 'requester' } },
          ]),
      });

      await expect(gateway.isRequesterConnected('42')).resolves.toBe(true);
      expect(server.in).toHaveBeenCalledWith('ticket:42');
    });

    it('returns false when only agent sockets (or none) are in the room', async () => {
      const { gateway, server } = makeGateway();
      server.in.mockReturnValue({
        fetchSockets: jest.fn().mockResolvedValue([{ data: { actorType: 'agent' } }]),
      });

      await expect(gateway.isRequesterConnected('42')).resolves.toBe(false);
    });

    it('returns false when the room is empty', async () => {
      const { gateway } = makeGateway();

      await expect(gateway.isRequesterConnected('42')).resolves.toBe(false);
    });
  });

  describe('fetchTicket', () => {
    it('is public and resolves contactEmail from get_ticket_by_id', async () => {
      const { gateway, client } = makeGateway();
      client.send.mockReturnValue(
        of({ id: '42', tenantId: 't-1', contactEmail: 'maria@example.com' }),
      );

      const ticket = await gateway.fetchTicket('42');

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'get_ticket_by_id' },
        { id: '42' },
      );
      expect(ticket).toEqual({
        id: '42',
        tenantId: 't-1',
        contactEmail: 'maria@example.com',
      });
    });
  });
});
