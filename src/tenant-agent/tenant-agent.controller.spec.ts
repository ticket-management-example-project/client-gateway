import { of, throwError } from 'rxjs';
import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { TenantAgentController } from './tenant-agent.controller';

describe('TenantAgentController', () => {
  const makeController = (overrides?: {
    isOwner?: boolean;
    tenants?: { id: string }[];
    clerkFails?: boolean;
  }) => {
    const client = {
      send: jest.fn((pattern: { cmd: string }) => {
        if (pattern.cmd === 'list_tenants_by_organization') {
          return of(overrides?.tenants ?? [{ id: 't-1' }]);
        }
        return of({
          id: 'agent-1',
          tenantId: 't-1',
          email: 'a@b.com',
          status: 'invited',
        });
      }),
    };
    const membership = {
      isOwner: jest.fn().mockResolvedValue(overrides?.isOwner ?? true),
    };
    const clerkInvitations = {
      inviteToOrganization: overrides?.clerkFails
        ? jest.fn().mockRejectedValue(new Error('Clerk API down'))
        : jest.fn().mockResolvedValue({ id: 'inv_123' }),
    };
    const controller = new TenantAgentController(
      client as any,
      membership as any,
      clerkInvitations as any,
    );
    return { controller, client, membership, clerkInvitations };
  };

  describe('invite()', () => {
    it('checks ownership, checks tenant membership, persists via NATS BEFORE calling Clerk, then calls Clerk', async () => {
      const { controller, client, membership, clerkInvitations } =
        makeController();

      const result = await controller.invite(
        'org-1',
        't-1',
        { email: 'agent@example.com' },
        'owner-1',
        { correlationId: 'req-1' } as any,
      );

      expect(membership.isOwner).toHaveBeenCalledWith('owner-1', 'org-1');
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'list_tenants_by_organization' },
        { organizationId: 'org-1' },
      );
      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'invite_tenant_agent' },
        {
          tenantId: 't-1',
          organizationId: 'org-1',
          email: 'agent@example.com',
          correlationId: 'req-1',
        },
      );
      expect(clerkInvitations.inviteToOrganization).toHaveBeenCalledWith({
        organizationId: 'org-1',
        inviterUserId: 'owner-1',
        emailAddress: 'agent@example.com',
        tenantId: 't-1',
      });
      expect(result).toEqual({
        id: 'agent-1',
        tenantId: 't-1',
        email: 'a@b.com',
        status: 'invited',
      });
    });

    it('rejects with ForbiddenException when the caller does not own the Organization, without calling NATS or Clerk', async () => {
      const { controller, client, clerkInvitations } = makeController({
        isOwner: false,
      });

      await expect(
        controller.invite(
          'org-1',
          't-1',
          { email: 'a@b.com' },
          'someone-else',
          {
            correlationId: 'req-1',
          } as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(client.send).not.toHaveBeenCalledWith(
        { cmd: 'invite_tenant_agent' },
        expect.anything(),
      );
      expect(clerkInvitations.inviteToOrganization).not.toHaveBeenCalled();
    });

    it('rejects with ForbiddenException when tenantId does not belong to organizationId, without calling NATS invite or Clerk', async () => {
      const { controller, client, clerkInvitations } = makeController({
        tenants: [{ id: 't-OTHER' }],
      });

      await expect(
        controller.invite('org-1', 't-1', { email: 'a@b.com' }, 'owner-1', {
          correlationId: 'req-1',
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(client.send).not.toHaveBeenCalledWith(
        { cmd: 'invite_tenant_agent' },
        expect.anything(),
      );
      expect(clerkInvitations.inviteToOrganization).not.toHaveBeenCalled();
    });

    it('surfaces a ServiceUnavailableException when the Clerk call fails after NATS already persisted the invite', async () => {
      const { controller } = makeController({ clerkFails: true });

      await expect(
        controller.invite('org-1', 't-1', { email: 'a@b.com' }, 'owner-1', {
          correlationId: 'req-1',
        } as any),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('never calls Clerk when the NATS invite_tenant_agent command rejects (e.g. a duplicate conflict)', async () => {
      const client = {
        send: jest.fn((pattern: { cmd: string }) => {
          if (pattern.cmd === 'list_tenants_by_organization') {
            return of([{ id: 't-1' }]);
          }
          return throwError(() => new Error('AGENT_ALREADY_INVITED'));
        }),
      };
      const membership = { isOwner: jest.fn().mockResolvedValue(true) };
      const clerkInvitations = {
        inviteToOrganization: jest.fn().mockResolvedValue({ id: 'inv_123' }),
      };
      const controller = new TenantAgentController(
        client as any,
        membership as any,
        clerkInvitations as any,
      );

      await expect(
        controller.invite('org-1', 't-1', { email: 'a@b.com' }, 'owner-1', {
          correlationId: 'req-1',
        } as any),
      ).rejects.toBeInstanceOf(RpcException);
      expect(clerkInvitations.inviteToOrganization).not.toHaveBeenCalled();
    });
  });

  describe('list()', () => {
    it('lists agents once ownership and tenant membership are both verified', async () => {
      const { controller, client } = makeController();

      await controller.list('org-1', 't-1', 'owner-1');

      expect(client.send).toHaveBeenCalledWith(
        { cmd: 'list_tenant_agents' },
        { tenantId: 't-1' },
      );
    });

    it('rejects with ForbiddenException when the caller does not own the Organization', async () => {
      const { controller } = makeController({ isOwner: false });

      await expect(
        controller.list('org-1', 't-1', 'someone-else'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
