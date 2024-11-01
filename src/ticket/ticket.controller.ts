import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { catchError } from 'rxjs';
import { NATS_SERVICE } from 'src/shared/config/services';

@Controller('ticket')
export class TicketController {
  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  // @Post()
  // create(@Body() createTicketDto: CreateTicketDto) {
  //   return this.ticketService.create(createTicketDto);
  // }
  //
  // @Get()
  // findAll() {
  //   return this.ticketService.findAll();
  // }
  //
  // @Get(':id')
  // findOne(@Param('id') id: string) {
  @Get()
  findOne() {
    console.log('g');
    return this.client.send({ cmd: 'caaaab' }, {}).pipe(
      catchError((error) => {
        throw new RpcException(error);
      }),
    );
  }

  //
  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateTicketDto: UpdateTicketDto) {
  //   return this.ticketService.update(+id, updateTicketDto);
  // }
  //
  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.ticketService.remove(+id);
  // }
}
