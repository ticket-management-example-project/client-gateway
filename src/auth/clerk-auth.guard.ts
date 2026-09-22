import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { Request } from 'express';
import { envs } from 'src/shared/config/envs';

export interface AuthenticatedRequest extends Request {
  userId: string;
}

/**
 * Verifies the Clerk session token (Bearer) and attaches `userId` to the
 * request. Rejects before the handler runs (I/O matrix: "No autenticado").
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing bearer session token');
    }

    try {
      const verified = await verifyToken(token, {
        secretKey: envs.clerkSecretKey,
        authorizedParties: envs.clerkAuthorizedParties,
      });
      request.userId = verified.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired session token');
    }
  }

  private extractBearerToken(request: Request): string | undefined {
    const header = request.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return undefined;
    }
    return header.slice('Bearer '.length).trim() || undefined;
  }
}
