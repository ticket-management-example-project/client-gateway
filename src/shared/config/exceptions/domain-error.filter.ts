import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Response } from 'express';
import { RequestWithCorrelationId } from 'src/shared/middleware/correlation-id.middleware';

interface ErrorEnvelope {
  code: string;
  message: string;
  correlationId: string;
  details?: Record<string, unknown>;
}

/** Internal-only: carries the HTTP status alongside the wire envelope
 * without putting it in the envelope itself (the wire shape is frozen to
 * `{code, message, correlationId, details?}`). */
interface NormalizedError extends ErrorEnvelope {
  httpStatus: number;
}

interface RpcErrorShape {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

const CODE_TO_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  // Story 1.3: Organization exists but isn't `ready` yet (`provisioning`/
  // `failed`) -- a Tenant cannot be created for it. Domain conflict, not a
  // generic 500 (see spec I/O matrix).
  ORGANIZATION_NOT_READY: 409,
  // Story 1.4: email already invited/active -- same Tenant or a different
  // one in the same Organization (spec I/O matrix, both 409).
  AGENT_ALREADY_INVITED: 409,
  AGENT_ALREADY_IN_ANOTHER_TENANT: 409,
};

function statusFromCode(code: string): number {
  if (CODE_TO_STATUS[code]) {
    return CODE_TO_STATUS[code];
  }
  if (code.endsWith('_ALREADY_EXISTS')) {
    return 409;
  }
  if (code.endsWith('_NOT_FOUND')) {
    return 404;
  }
  return 500;
}

function codeFromHttpStatus(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    default:
      return 'INTERNAL_ERROR';
  }
}

function looksLikeRpcErrorShape(value: unknown): value is RpcErrorShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('code' in value || 'message' in value)
  );
}

/**
 * Global exception filter for `client-gateway`. No raw exception (RPC or
 * HTTP) crosses this boundary: everything is normalized to
 * `{code, message, correlationId, details?}`, with explicit status mapping
 * (`NotFoundException`->404, conflict->409, `ValidationException`->400).
 * Replaces the old ad-hoc `RpcCustomExceptionFilter`.
 */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('DomainErrorFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithCorrelationId>();
    const correlationId = request?.correlationId ?? 'unknown';

    const { httpStatus, ...envelope } = this.normalize(
      exception,
      correlationId,
    );

    if (envelope.code === 'INTERNAL_ERROR') {
      this.logger.error(
        `[${correlationId}] ${envelope.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(httpStatus).json(envelope);
  }

  private normalize(
    exception: unknown,
    correlationId: string,
  ): NormalizedError {
    if (exception instanceof RpcException) {
      return this.fromRpcError(exception.getError(), correlationId);
    }

    if (exception instanceof HttpException) {
      // Use Nest's own computed status directly. Re-deriving it via
      // statusFromCode(codeFromHttpStatus(status)) would collapse any
      // status not in CODE_TO_STATUS (e.g. 422, 429) down to 500.
      const httpStatus = exception.getStatus();
      const body = exception.getResponse();
      const rawMessage =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] })?.message ??
            exception.message);
      const message = Array.isArray(rawMessage)
        ? rawMessage.join('; ')
        : rawMessage;

      return {
        code: codeFromHttpStatus(httpStatus),
        message,
        correlationId,
        httpStatus,
      };
    }

    if (looksLikeRpcErrorShape(exception)) {
      return this.fromRpcError(exception, correlationId);
    }

    const message =
      exception instanceof Error ? exception.message : 'Unexpected error';
    return {
      code: 'INTERNAL_ERROR',
      message,
      correlationId,
      httpStatus: 500,
    };
  }

  private fromRpcError(error: unknown, correlationId: string): NormalizedError {
    if (looksLikeRpcErrorShape(error)) {
      const code = error.code ?? 'INTERNAL_ERROR';
      return {
        code,
        message: error.message ?? 'Unexpected error',
        correlationId,
        details: error.details,
        httpStatus: statusFromCode(code),
      };
    }

    return {
      code: 'INTERNAL_ERROR',
      message: typeof error === 'string' ? error : 'Unexpected error',
      correlationId,
      httpStatus: 500,
    };
  }
}
