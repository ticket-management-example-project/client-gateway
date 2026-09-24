import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { catchError, firstValueFrom, timeout } from 'rxjs';
import { CurrentUserId } from 'src/auth/current-user-id.decorator';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { OrganizationMembershipService } from 'src/organization/organization-membership.service';
import { NATS_SERVICE } from 'src/shared/config/services';
import { RequestWithCorrelationId } from 'src/shared/middleware/correlation-id.middleware';
import { CreateTenantDto } from './dto/create-tenant.dto';

const RPC_TIMEOUT_MS = 5000;

/**
 * Rewritten from the `nest g resource` prototype (no auth, empty DTO) --
 * see spec Code Map: "reescribir, no extender". Follows the exact pattern
 * already proven by `OrganizationController` (guard + ownership check +
 * correlationId + timeout/catchError/RpcException), reusing
 * `OrganizationMembershipService.isOwner` from Story 1.2 (same 403 as
 * `retryProvisioning`) since a Tenant cannot be created or listed by anyone
 * but the parent Organization's owner.
 */
@Controller('organizations/:organizationId/tenants')
export class TenantController {
  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
    private readonly membership: OrganizationMembershipService,
  ) {}

  @Post()
  @HttpCode(201)
  @UseGuards(ClerkAuthGuard)
  async create(
    @Param('organizationId') organizationId: string,
    @Body() createTenantDto: CreateTenantDto,
    @CurrentUserId() userId: string,
    @Req() request: RequestWithCorrelationId,
  ) {
    await this.assertIsOwner(organizationId, userId);

    return firstValueFrom(
      this.client
        .send(
          { cmd: 'create_tenant' },
          {
            organizationId,
            name: createTenantDto.name,
            correlationId: request.correlationId,
          },
        )
        .pipe(
          timeout(RPC_TIMEOUT_MS),
          catchError((error) => {
            throw new RpcException(error);
          }),
        ),
    );
  }

  @Get()
  @UseGuards(ClerkAuthGuard)
  async list(
    @Param('organizationId') organizationId: string,
    @CurrentUserId() userId: string,
  ) {
    await this.assertIsOwner(organizationId, userId);

    return firstValueFrom(
      this.client
        .send({ cmd: 'list_tenants_by_organization' }, { organizationId })
        .pipe(
          timeout(RPC_TIMEOUT_MS),
          catchError((error) => {
            throw new RpcException(error);
          }),
        ),
    );
  }

  private async assertIsOwner(
    organizationId: string,
    userId: string,
  ): Promise<void> {
    const isOwner = await this.membership.isOwner(userId, organizationId);
    if (!isOwner) {
      throw new ForbiddenException(
        'You do not have access to this Organization',
      );
    }
  }
}
