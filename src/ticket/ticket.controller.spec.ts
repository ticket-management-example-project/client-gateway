import { of } from 'rxjs';
import { TicketController } from './ticket.controller';

describe('TicketController', () => {
  const makeController = (response: unknown = { id: 't-1' }) => {
    const client = { send: jest.fn().mockReturnValue(of(response)) };
    return {
      controller: new TicketController(client as any),
      client,
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
        correlationId: 'req-1',
      },
    );
    expect(result.trackingToken).toBe('abc123');
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
});
