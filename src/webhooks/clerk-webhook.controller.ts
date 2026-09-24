import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { Webhook } from 'svix';
import { Request } from 'express';
import { envs } from 'src/shared/config/envs';
import { NATS_SERVICE } from 'src/shared/config/services';

const RPC_TIMEOUT_MS = 5000;
const ACCEPTED_EVENT_TYPE = 'organizationInvitation.accepted';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ClerkWebhookEvent {
  type: string;
  data: {
    email_address?: string;
    organization_id?: string;
    public_metadata?: Record<string, unknown>;
    user_id?: string;
  };
}

/**
 * `POST /webhooks/clerk` -- public (no `ClerkAuthGuard`: Clerk sends no user
 * JWT), verified instead by the Svix signature (spec Boundaries &
 * Constraints). The only route excluded from the global `/api` prefix
 * besides `/health` (see `main.ts`).
 *
 * Only `organizationInvitation.accepted` is handled; every other Clerk event
 * type this endpoint might also receive (Clerk webhooks are configured per
 * *endpoint*, not per event type sent to it) is acknowledged with 200 and
 * ignored, so Clerk never retries a type this story doesn't care about.
 */
@Controller('webhooks')
export class ClerkWebhookController {
  private readonly logger = new Logger(ClerkWebhookController.name);

  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  @Post('clerk')
  @HttpCode(200)
  async handle(@Req() req: RawBodyRequest<Request>) {
    this.verifySignature(req);

    const event = req.body as ClerkWebhookEvent;

    if (event?.type !== ACCEPTED_EVENT_TYPE) {
      return { received: true };
    }

    const tenantId = event.data?.public_metadata?.tenantId;
    const emailAddress = event.data?.email_address;

    // I/O Matrix: "Webhook de un tenant inexistente/borrado -> se ignora
    // (log warning), 200 a Clerk". A malformed/incomplete payload (missing
    // tenantId or email) is the same shape of problem -- nothing this
    // service can act on -- so it gets the same treatment: warn + 200,
    // never a 4xx/5xx that would make Clerk retry forever.
    if (
      typeof tenantId !== 'string' ||
      !tenantId ||
      !emailAddress ||
      !EMAIL_REGEX.test(emailAddress)
    ) {
      this.logger.warn(
        `${ACCEPTED_EVENT_TYPE} webhook missing or invalid tenantId (publicMetadata) or email_address -- ignoring`,
      );
      return { received: true };
    }

    await firstValueFrom(
      this.client
        .send(
          { cmd: 'accept_tenant_agent' },
          {
            tenantId,
            email: emailAddress,
            clerkUserId: event.data.user_id ?? null,
          },
        )
        .pipe(timeout(RPC_TIMEOUT_MS)),
    );

    return { received: true };
  }

  private verifySignature(req: RawBodyRequest<Request>): void {
    const payload = req.rawBody;
    if (!payload) {
      throw new BadRequestException('Missing raw request body');
    }

    const headers = {
      'svix-id': req.headers['svix-id'],
      'svix-timestamp': req.headers['svix-timestamp'],
      'svix-signature': req.headers['svix-signature'],
    } as Record<string, string>;

    try {
      new Webhook(envs.clerkWebhookSecret).verify(payload, headers);
    } catch {
      // I/O Matrix: "rechazo sin loguear el payload" -- log a fixed message
      // only, never the (untrusted, possibly forged) request body.
      this.logger.warn('Clerk webhook signature verification failed');
      throw new BadRequestException('Invalid webhook signature');
    }
  }
}
