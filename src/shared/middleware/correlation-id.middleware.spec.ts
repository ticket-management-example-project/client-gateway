import { Request, Response } from 'express';
import {
  CorrelationIdMiddleware,
  RequestWithCorrelationId,
} from './correlation-id.middleware';

describe('CorrelationIdMiddleware', () => {
  const middleware = new CorrelationIdMiddleware();

  const makeReq = (headerValue?: string): Partial<Request> => ({
    method: 'POST',
    path: '/organizations',
    header: jest.fn().mockReturnValue(headerValue),
  });

  const makeRes = (): Partial<Response> => ({
    setHeader: jest.fn(),
    on: jest.fn(),
    statusCode: 201,
  });

  it('reuses the inbound x-correlation-id header when present', () => {
    const req = makeReq('incoming-correlation-id');
    const res = makeRes();
    const next = jest.fn();

    middleware.use(req as Request, res as Response, next);

    expect((req as RequestWithCorrelationId).correlationId).toBe(
      'incoming-correlation-id',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      'incoming-correlation-id',
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a new correlationId when no header is present', () => {
    const req = makeReq(undefined);
    const res = makeRes();
    const next = jest.fn();

    middleware.use(req as Request, res as Response, next);

    const assigned = (req as RequestWithCorrelationId).correlationId;
    // v4 UUID shape, good enough to prove it wasn't just echoed from the header.
    expect(assigned).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', assigned);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a new correlationId when the header is blank', () => {
    const req = makeReq('   ');
    const res = makeRes();
    const next = jest.fn();

    middleware.use(req as Request, res as Response, next);

    expect((req as RequestWithCorrelationId).correlationId).not.toBe('   ');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
