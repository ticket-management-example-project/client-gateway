import { Test, TestingModule } from '@nestjs/testing';
import {
  HealthCheckError,
  MicroserviceHealthIndicator,
  TerminusModule,
} from '@nestjs/terminus';
import { HealthController } from './health.controller';

/**
 * I/O Matrix: "Dependencia caída" (NATS) -> /health reports `unhealthy` with
 * the specific check failing, never a fixed 200. `client-gateway` has no
 * database of its own, so NATS is its only dependency here.
 */
describe('HealthController', () => {
  const buildController = async (natsHealthy: boolean) => {
    const microservice = {
      pingCheck: natsHealthy
        ? jest.fn().mockResolvedValue({ nats: { status: 'up' } })
        : jest.fn().mockRejectedValue(
            new HealthCheckError('nats timed out', {
              nats: { status: 'down', message: 'connection refused' },
            }),
          ),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: MicroserviceHealthIndicator, useValue: microservice },
      ],
    }).compile();

    return module.get(HealthController);
  };

  it('reports "ok" when NATS is reachable', async () => {
    const controller = await buildController(true);

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.info).toMatchObject({ nats: { status: 'up' } });
  });

  it('reports unhealthy with nats marked "down", not a fixed 200, when NATS is unreachable', async () => {
    const controller = await buildController(false);

    try {
      await controller.check();
      throw new Error('expected check() to reject');
    } catch (error) {
      const response = (
        error as { getResponse: () => Record<string, unknown> }
      ).getResponse();
      expect(response.status).toBe('error');
      expect(response.error).toEqual({
        nats: { status: 'down', message: 'connection refused' },
      });
    }
  });
});
