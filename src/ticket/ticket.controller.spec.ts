import { Test, TestingModule } from '@nestjs/testing';
import { NATS_SERVICE } from 'src/shared/config/services';
import { TicketController } from './ticket.controller';

describe('TicketController', () => {
  let controller: TicketController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TicketController],
      providers: [{ provide: NATS_SERVICE, useValue: { send: jest.fn() } }],
    }).compile();

    controller = module.get<TicketController>(TicketController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
