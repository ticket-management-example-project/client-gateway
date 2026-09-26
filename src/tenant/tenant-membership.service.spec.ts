import { of, throwError } from 'rxjs';
import { TenantMembershipService } from './tenant-membership.service';

describe('TenantMembershipService', () => {
  const makeService = (overrides?: {
    tenant?: { id: string; organizationId: string } | null;
    isOwner?: boolean;
    agents?: Array<{ clerkUserId: string | null; status: string }>;
  }) => {
    const client = {
      send: jest.fn((pattern: { cmd: string }) => {
        if (pattern.cmd === 'get_tenant_by_id') {
          return of(
            overrides?.tenant !== undefined
              ? overrides.tenant
              : { id: 't-1', organizationId: 'org-1' },
          );
        }
        if (pattern.cmd === 'list_tenant_agents') {
          return of(overrides?.agents ?? []);
        }
        return throwError(() => new Error(`unexpected cmd ${pattern.cmd}`));
      }),
    };
    const organizationMembership = {
      isOwner: jest.fn().mockResolvedValue(overrides?.isOwner ?? false),
    };

    return {
      service: new TenantMembershipService(
        client as any,
        organizationMembership as any,
      ),
      client,
      organizationMembership,
    };
  };

  it('grants access to the Organization owner without checking tenant agents', async () => {
    const { service, client, organizationMembership } = makeService({
      isOwner: true,
    });

    const result = await service.isAgentOrOwner('user_1', 't-1');

    expect(result).toBe(true);
    expect(organizationMembership.isOwner).toHaveBeenCalledWith(
      'user_1',
      'org-1',
    );
    expect(client.send).not.toHaveBeenCalledWith(
      { cmd: 'list_tenant_agents' },
      expect.anything(),
    );
  });

  it('grants access to an active TenantAgent of that Tenant', async () => {
    const { service } = makeService({
      isOwner: false,
      agents: [{ clerkUserId: 'user_2', status: 'active' }],
    });

    const result = await service.isAgentOrOwner('user_2', 't-1');

    expect(result).toBe(true);
  });

  it('denies access to a merely invited (not yet accepted) TenantAgent', async () => {
    const { service } = makeService({
      isOwner: false,
      agents: [{ clerkUserId: 'user_2', status: 'invited' }],
    });

    await expect(service.isAgentOrOwner('user_2', 't-1')).resolves.toBe(false);
  });

  it('fails closed when the Tenant does not resolve', async () => {
    const { service } = makeService({ tenant: null });

    await expect(service.isAgentOrOwner('user_1', 'missing')).resolves.toBe(
      false,
    );
  });

  it('fails closed on a get_tenant_by_id RPC error, never treating it as membership', async () => {
    const client = {
      send: jest.fn().mockReturnValue(throwError(() => new Error('timeout'))),
    };
    const organizationMembership = { isOwner: jest.fn() };
    const service = new TenantMembershipService(
      client as any,
      organizationMembership as any,
    );

    await expect(service.isAgentOrOwner('user_1', 't-1')).resolves.toBe(false);
    expect(organizationMembership.isOwner).not.toHaveBeenCalled();
  });
});
