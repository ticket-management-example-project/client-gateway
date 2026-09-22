import {
  ArgumentsHost,
  HttpException,
  ImATeapotException,
  NotFoundException,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { DomainErrorFilter } from './domain-error.filter';

describe('DomainErrorFilter', () => {
  const filter = new DomainErrorFilter();

  const makeHost = (request: Record<string, unknown> = { correlationId: 'corr-1' }) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status };

    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;

    return { host, status, json };
  };

  it('normalizes an RpcException carrying {code, message, details} using statusFromCode', () => {
    const { host, status, json } = makeHost();
    const exception = new RpcException({
      code: 'ORGANIZATION_ALREADY_EXISTS',
      message: 'Owner already has an Organization',
      details: { ownerId: 'owner-1' },
    });

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      code: 'ORGANIZATION_ALREADY_EXISTS',
      message: 'Owner already has an Organization',
      correlationId: 'corr-1',
      details: { ownerId: 'owner-1' },
    });
  });

  it('uses exception.getStatus() directly for an HttpException with a mapped status', () => {
    const { host, status, json } = makeHost();
    const exception = new NotFoundException('Organization not found');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NOT_FOUND', correlationId: 'corr-1' }),
    );
  });

  it('uses exception.getStatus() directly for an HttpException with a status NOT in CODE_TO_STATUS (regression: must not collapse to 500)', () => {
    const { host, status, json } = makeHost();
    const exception = new ImATeapotException('I am a teapot');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(418);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'corr-1' }),
    );
  });

  it('maps a raw HttpException with an object response body', () => {
    const { host, status, json } = makeHost();
    const exception = new HttpException(
      { message: ['name should not be empty'] },
      400,
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 'VALIDATION_ERROR',
      message: 'name should not be empty',
      correlationId: 'corr-1',
    });
  });

  it('normalizes a raw Error/unknown throw to INTERNAL_ERROR / 500', () => {
    const { host, status, json } = makeHost();
    const exception = new Error('boom');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'boom',
      correlationId: 'corr-1',
    });
  });

  it('falls back to "unknown" correlationId when the request has none', () => {
    const { host, status, json } = makeHost({});
    const exception = new Error('boom');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'unknown' }),
    );
  });
});
