import { of } from 'rxjs';
import { ForbiddenException } from '@nestjs/common';
import { TenantController } from './tenant.controller';

describe('TenantController', () => {
  const makeController = (overrides?: { isOwner?: boolean }) => {
    const client = {
      send: jest.fn().mockReturnValue(of({ id: '1', name: 'Soporte', status: 'active' })),
    };
    const membership = {
      isOwner: jest.fn().mockResolvedValue(overrides?.isOwner ?? true),
    };
    const controller = new TenantController(client as any, membership as any);
    return { controller, client, membership };
  };

  it('create() sends create_tenant with organizationId/name/correlationId when the caller owns the Organization', async () => {
    const { controller, client, membership } = makeController();

    await controller.create('org-1', { name: 'Soporte Nivel 1' }, 'owner-1', {
      correlationId: 'req-1',
    } as any);

    expect(membership.isOwner).toHaveBeenCalledWith('owner-1', 'org-1');
    expect(client.send).toHaveBeenCalledWith(
      { cmd: 'create_tenant' },
      { organizationId: 'org-1', name: 'Soporte Nivel 1', correlationId: 'req-1' },
    );
  });

  it('create() rejects with ForbiddenException when the caller does not own the Organization', async () => {
    const { controller, client } = makeController({ isOwner: false });

    await expect(
      controller.create('org-1', { name: 'Soporte' }, 'someone-else', {
        correlationId: 'req-2',
      } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('list() sends list_tenants_by_organization when the caller owns the Organization', async () => {
    const { controller, client, membership } = makeController();

    await controller.list('org-1', 'owner-1');

    expect(membership.isOwner).toHaveBeenCalledWith('owner-1', 'org-1');
    expect(client.send).toHaveBeenCalledWith(
      { cmd: 'list_tenants_by_organization' },
      { organizationId: 'org-1' },
    );
  });

  it('list() rejects with ForbiddenException when the caller does not own the Organization', async () => {
    const { controller, client } = makeController({ isOwner: false });

    await expect(controller.list('org-1', 'someone-else')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(client.send).not.toHaveBeenCalled();
  });
});
