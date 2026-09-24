import { of } from 'rxjs';
import { ForbiddenException } from '@nestjs/common';
import { OrganizationController } from './organization.controller';

describe('OrganizationController', () => {
  const makeController = (overrides?: { isOwner?: boolean }) => {
    const client = {
      send: jest.fn().mockReturnValue(of({ status: 'provisioning' })),
    };
    const membership = {
      isOwner: jest.fn().mockResolvedValue(overrides?.isOwner ?? true),
    };
    const controller = new OrganizationController(
      client as any,
      membership as any,
    );
    return { controller, client, membership };
  };

  it('create() sends create_organization with ownerId/name/correlationId', () => {
    const { controller, client } = makeController();

    controller.create({ name: 'Acme' }, 'owner-1', {
      correlationId: 'req-1',
    } as any);

    expect(client.send).toHaveBeenCalledWith(
      { cmd: 'create_organization' },
      { ownerId: 'owner-1', name: 'Acme', correlationId: 'req-1' },
    );
  });

  it('retryProvisioning() sends retry_provisioning when the caller owns the organization', async () => {
    const { controller, client, membership } = makeController({
      isOwner: true,
    });

    await controller.retryProvisioning('1', 'owner-1', {
      correlationId: 'req-2',
    } as any);

    expect(membership.isOwner).toHaveBeenCalledWith('owner-1', '1');
    expect(client.send).toHaveBeenCalledWith(
      { cmd: 'retry_provisioning' },
      { organizationId: '1', correlationId: 'req-2' },
    );
  });

  it('retryProvisioning() rejects with ForbiddenException when the caller does not own the organization', async () => {
    const { controller, client, membership } = makeController({
      isOwner: false,
    });

    await expect(
      controller.retryProvisioning('1', 'someone-else', {
        correlationId: 'req-3',
      } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(client.send).not.toHaveBeenCalled();
  });
});
