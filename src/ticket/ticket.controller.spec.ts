import { of } from 'rxjs';
import { TicketController } from './ticket.controller';

describe('TicketController', () => {
  const makeController = (
    response: unknown = { id: 't-1' },
    isAgentOrOwner = true,
  ) => {
    const client = { send: jest.fn().mockReturnValue(of(response)) };
    const tenantMembership = {
      isAgentOrOwner: jest.fn().mockResolvedValue(isAgentOrOwner),
    };
    return {
      controller: new TicketController(client as any, tenantMembership as any),
      client,
      tenantMembership,
    };
  };

  it('create() sends create_ticket with tenantSlug/subject/description/correlationId and no auth check', async () => {
    const { controller, client } = makeController({
      id: 't-1',
      tenantId: 'tenant-1',
      subject: 'Asunto',
      description: 'Descripción',
      status: 'open',
      trackingToken: 'abc123',
    });

    const result = await controller.create(
      'mi-empresa',
      { subject: 'Asunto', description: 'Descripción' },
      { correlationId: 'req-1' } as any,
    );

    expect(client.send).toHaveBeenCalledWith(
      { cmd: 'create_ticket' },
      {
        tenantSlug: 'mi-empresa',
        subject: 'Asunto',
        description: 'Descripción',
        contactEmail: undefined,
        correlationId: 'req-1',
      },
    );
    expect(result.trackingToken).toBe('abc123');
  });

  it('create() forwards contactEmail when the Requester captured one', async () => {
    const { controller, client } = makeController({
      id: 't-1',
      tenantId: 'tenant-1',
      subject: 'Asunto',
      description: 'Descripción',
      status: 'open',
      trackingToken: 'abc123',
      contactEmail: 'maria@example.com',
    });

    const result = await controller.create(
      'mi-empresa',
      {
        subject: 'Asunto',
        description: 'Descripción',
        contactEmail: 'maria@example.com',
      },
      { correlationId: 'req-1' } as any,
    );

    expect(client.send).toHaveBeenCalledWith(
      { cmd: 'create_ticket' },
      {
        tenantSlug: 'mi-empresa',
        subject: 'Asunto',
        description: 'Descripción',
        contactEmail: 'maria@example.com',
        correlationId: 'req-1',
      },
    );
    expect(result.contactEmail).toBe('maria@example.com');
  });

  it('trackByToken() sends get_ticket_by_token with the token and no auth check', async () => {
    const { controller, client } = makeController({
      id: 't-1',
      status: 'open',
      chatThread: [],
    });

    const result = await controller.trackByToken('abc123');

    expect(client.send).toHaveBeenCalledWith(
      { cmd: 'get_ticket_by_token' },
      { token: 'abc123' },
    );
    expect(result.chatThread).toEqual([]);
  });

  it('linkToAccount() sends link_ticket_to_account with token/requesterId/correlationId', async () => {
    const { controller, client } = makeController({
      id: 't-1',
      tenantId: 'tenant-1',
      subject: 'Asunto',
      description: 'Descripción',
      status: 'open',
      requesterId: 'user_1',
    });

    const result = await controller.linkToAccount('abc123', 'user_1', {
      correlationId: 'req-1',
    } as any);

    expect(client.send).toHaveBeenCalledWith(
      { cmd: 'link_ticket_to_account' },
      { token: 'abc123', requesterId: 'user_1', correlationId: 'req-1' },
    );
    expect(result.requesterId).toBe('user_1');
  });

  it('myTickets() sends get_tickets_by_requester with tenantSlug/requesterId/correlationId', async () => {
    const { controller, client } = makeController([
      { id: '1', subject: 'Asunto', status: 'open' },
    ]);

    const result = await controller.myTickets('mi-empresa', 'user_1', {
      correlationId: 'req-2',
    } as any);

    expect(client.send).toHaveBeenCalledWith(
      { cmd: 'get_tickets_by_requester' },
      {
        tenantSlug: 'mi-empresa',
        requesterId: 'user_1',
        correlationId: 'req-2',
      },
    );
    expect(result).toHaveLength(1);
  });

  it('getById() returns the Ticket when the caller is an Agent/owner of its Tenant', async () => {
    const { controller, client, tenantMembership } = makeController(
      {
        id: '42',
        tenantId: 't-1',
        subject: 'Asunto',
        description: 'Descripción',
        status: 'open',
      },
      true,
    );

    const result = await controller.getById('42', 'user_1');

    expect(client.send).toHaveBeenCalledWith(
      { cmd: 'get_ticket_by_id' },
      { id: '42' },
    );
    expect(tenantMembership.isAgentOrOwner).toHaveBeenCalledWith(
      'user_1',
      't-1',
    );
    expect(result.id).toBe('42');
  });

  it("getById() never leaks the Requester's contactEmail into the Agent-facing response", async () => {
    const { controller } = makeController(
      {
        id: '42',
        tenantId: 't-1',
        subject: 'Asunto',
        description: 'Descripción',
        status: 'open',
        contactEmail: 'maria@example.com',
      },
      true,
    );

    const result = await controller.getById('42', 'user_1');

    expect(result).toEqual({
      id: '42',
      tenantId: 't-1',
      subject: 'Asunto',
      description: 'Descripción',
      status: 'open',
    });
  });

  it('getById() throws NotFoundException when the ticket does not resolve', async () => {
    const { controller } = makeController(null);

    await expect(controller.getById('missing', 'user_1')).rejects.toThrow(
      'Ticket not found',
    );
  });

  it('getById() throws ForbiddenException when the caller has no membership in the Ticket Tenant', async () => {
    const { controller } = makeController(
      {
        id: '42',
        tenantId: 't-1',
        subject: 'Asunto',
        description: 'Descripción',
        status: 'open',
      },
      false,
    );

    await expect(controller.getById('42', 'user_2')).rejects.toThrow(
      'You do not have access to this Ticket',
    );
  });
});
