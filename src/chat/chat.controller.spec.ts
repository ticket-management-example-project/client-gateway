import { Test, TestingModule } from '@nestjs/testing';
import { NATS_SERVICE } from 'src/shared/config/services';
import { ChatController } from './chat.controller';

describe('ChatController', () => {
  let controller: ChatController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: NATS_SERVICE, useValue: { send: jest.fn() } }],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
