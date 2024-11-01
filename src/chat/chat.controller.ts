import {
  Controller,
  Inject,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NATS_SERVICE } from 'src/shared/config/services';

@Controller('chat')
export class ChatController {
  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  // @Post()
  // create(@Body() createChatDto: CreateChatDto) {
  //   return this.client.send('createOrder', createOrderDto);
  // }
  //
  // @Get()
  // findAll() {
  //   return this.chatService.findAll();
  // }
  //
  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.chatService.findOne(+id);
  // }
  //
  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateChatDto: UpdateChatDto) {
  //   return this.chatService.update(+id, updateChatDto);
  // }
  //
  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.chatService.remove(+id);
  // }
}
