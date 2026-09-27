import { of, throwError } from 'rxjs';
import { ChatController } from './chat.controller';

const makeRequest = (correlationId = 'corr-1') => ({ correlationId }) as any;

describe('ChatController', () => {
  const makeController = (overrides?: {
    ticket?: { id: string; tenantId: string } | null;
    isAgentOrOwner?: boolean;
    responses?: Record<string, unknown>;
  }) => {
    const responses: Record<string, unknown> = {
      verify_tracking_token: { ticketId: '42' },
      get_ticket_by_id:
        overrides?.ticket !== undefined
          ? overrides.ticket
          : { id: '42', tenantId: 't-1' },
      post_chat_message: { id: 'm-1', status: 'delivered' },
      get_chat_thread: [],
      mark_chat_seen: undefined,
      ...overrides?.responses,
    };
    const client = {
      send: jest.fn((pattern: { cmd: string }) => {
        if (!(pattern.cmd in responses)) {
          return throwError(() => new Error(`unexpected cmd ${pattern.cmd}`));
        }
        return of(responses[pattern.cmd]);
      }),
    };
    const tenantMembership = {
      isAgentOrOwner: jest
        .fn()
        .mockResolvedValue(overrides?.isAgentOrOwner ?? true),
    };

    return {
      controller: new ChatController(client as any, tenantMembership as any),
      client,
      tenantMembership,
    };
  };

  describe('Requester surface (tracking token)', () => {
    it('sendAsRequester resolves the token then posts as requester with no senderId', async () => {
      const { controller, client } = makeController();

      const result = await controller.sendAsRequester(
        'tok-123',
        { body: 'Hola', lang: 'es' },
        makeRequest('corr-1'),
      );

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'verify_tracking_token' },
        { token: 'tok-123' },
      );
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'post_chat_message' },
        {
          ticketId: '42',
          senderType: 'requester',
          senderId: null,
          body: 'Hola',
          lang: 'es',
          correlationId: 'corr-1',
        },
      );
      expect(result).toEqual({ id: 'm-1', status: 'delivered' });
    });

    it('sendAsRequester throws NotFoundException for an unknown/malformed token', async () => {
      const { controller } = makeController({
        responses: { verify_tracking_token: { ticketId: null } },
      });

      await expect(
        controller.sendAsRequester(
          'bad-token',
          { body: 'Hola' },
          makeRequest(),
        ),
      ).rejects.toThrow('Ticket not found');
    });

    it('getThreadAsRequester marks agent messages seen (forwarding correlationId), then returns the thread scoped by tenantId', async () => {
      const { controller, client } = makeController({
        responses: {
          get_chat_thread: [{ id: 'm-1', senderType: 'agent', body: 'Hola' }],
        },
      });

      const result = await controller.getThreadAsRequester(
        'tok-123',
        makeRequest('corr-2'),
      );

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'mark_chat_seen' },
        { ticketId: '42', viewerType: 'requester', correlationId: 'corr-2' },
      );
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'get_chat_thread' },
        { ticketId: '42', tenantId: 't-1' },
      );
      expect(result).toHaveLength(1);
    });

    it('getThreadAsRequester still returns the thread even when mark_chat_seen fails', async () => {
      const { controller, client } = makeController();
      client.send.mockImplementation((pattern: { cmd: string }) => {
        if (pattern.cmd === 'mark_chat_seen') {
          return throwError(() => new Error('down'));
        }
        if (pattern.cmd === 'verify_tracking_token') {
          return of({ ticketId: '42' });
        }
        if (pattern.cmd === 'get_ticket_by_id') {
          return of({ id: '42', tenantId: 't-1' });
        }
        return of([]);
      });

      await expect(
        controller.getThreadAsRequester('tok-123', makeRequest()),
      ).resolves.toEqual([]);
    });
  });

  describe('Agent surface (Clerk-authenticated + Tenant membership)', () => {
    it('sendAsAgent posts with senderType agent and the authenticated userId', async () => {
      const { controller, client, tenantMembership } = makeController();

      const result = await controller.sendAsAgent(
        '42',
        { body: 'Hola desde soporte' },
        'user_1',
        makeRequest('corr-3'),
      );

      expect(tenantMembership.isAgentOrOwner).toHaveBeenCalledWith(
        'user_1',
        't-1',
      );
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'post_chat_message' },
        {
          ticketId: '42',
          senderType: 'agent',
          senderId: 'user_1',
          body: 'Hola desde soporte',
          lang: undefined,
          correlationId: 'corr-3',
        },
      );
      expect(result).toEqual({ id: 'm-1', status: 'delivered' });
    });

    it('sendAsAgent throws NotFoundException when the ticket does not resolve', async () => {
      const { controller } = makeController({ ticket: null });

      await expect(
        controller.sendAsAgent(
          'missing',
          { body: 'Hola' },
          'user_1',
          makeRequest(),
        ),
      ).rejects.toThrow('Ticket not found');
    });

    it('sendAsAgent throws ForbiddenException when the caller lacks Tenant membership', async () => {
      const { controller } = makeController({ isAgentOrOwner: false });

      await expect(
        controller.sendAsAgent('42', { body: 'Hola' }, 'user_2', makeRequest()),
      ).rejects.toThrow('You do not have access to this Ticket');
    });

    it('getThreadAsAgent marks requester messages seen (forwarding correlationId), then returns the thread', async () => {
      const { controller, client } = makeController();

      await controller.getThreadAsAgent('42', 'user_1', makeRequest('corr-4'));

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'mark_chat_seen' },
        { ticketId: '42', viewerType: 'agent', correlationId: 'corr-4' },
      );
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'get_chat_thread' },
        { ticketId: '42', tenantId: 't-1' },
      );
    });
  });
});
