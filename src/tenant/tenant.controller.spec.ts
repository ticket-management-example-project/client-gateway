import { Test, TestingModule } from '@nestjs/testing';
import { NATS_SERVICE } from 'src/shared/config/services';
import { TenantController } from './tenant.controller';

describe('TenantController', () => {
  let controller: TenantController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantController],
      providers: [{ provide: NATS_SERVICE, useValue: { send: jest.fn() } }],
    }).compile();

    controller = module.get<TenantController>(TenantController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
