import { Controller, Get, Inject } from '@nestjs/common';
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
  @Get()
  findOne() {
    return this.client.send({ cmd: 'find_one_ticket' }, {}).pipe(
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
