import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { ClerkAuthGuard } from './clerk-auth.guard';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));

const mockedVerifyToken = verifyToken as jest.MockedFunction<
  typeof verifyToken
>;

/** I/O Matrix: "No autenticado" -> 401, guard rejects before the handler. */
describe('ClerkAuthGuard', () => {
  const guard = new ClerkAuthGuard();

  const makeContext = (request: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('rejects with UnauthorizedException when there is no Authorization header', async () => {
    const context = makeContext({ headers: {} });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it('rejects with UnauthorizedException when the header is not a Bearer token', async () => {
    const context = makeContext({ headers: { authorization: 'Basic abc' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it('rejects with UnauthorizedException when Clerk fails to verify the token', async () => {
    mockedVerifyToken.mockRejectedValue(new Error('invalid signature'));
    const context = makeContext({
      headers: { authorization: 'Bearer bad-token' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockedVerifyToken).toHaveBeenCalledWith(
      'bad-token',
      expect.any(Object),
    );
  });

  it('allows the request through and attaches userId when the token is valid', async () => {
    mockedVerifyToken.mockResolvedValue({ sub: 'user_123' } as never);
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer good-token' },
    };
    const context = makeContext(request);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.userId).toBe('user_123');
  });
});
