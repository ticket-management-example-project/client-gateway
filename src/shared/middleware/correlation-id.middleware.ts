import { Injectable, NestMiddleware } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export interface RequestWithCorrelationId extends Request {
  correlationId: string;
}

const tracer = trace.getTracer('client-gateway');

/**
 * Assigns a `correlationId` to every request (reused from an inbound
 * `x-correlation-id` header when present) so it can travel as trace context
 * and be embedded in the uniform error envelope.
 *
 * This also opens the OTel root span for the request and attaches
 * `correlationId` to it. It is a root span rather than a span propagated in
 * from further upstream because there is no caller here to propagate from
 * for this story's flow, and, symmetrically, `organization-microservice`
 * opens its own root span rather than continuing this one because NATS has
 * no standard OTel context carrier in this stack (`@nestjs/microservices`
 * does not inject/extract W3C trace-context headers on NATS messages). See
 * the spec's `## Implementation Notes` for the full decision record.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header('x-correlation-id');
    const correlationId =
      incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

    (req as RequestWithCorrelationId).correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    const span = tracer.startSpan(`${req.method} ${req.path}`, {
      attributes: { correlationId },
    });
    res.on('finish', () => {
      span.setAttribute('http.status_code', res.statusCode);
      span.end();
    });

    next();
  }
}
