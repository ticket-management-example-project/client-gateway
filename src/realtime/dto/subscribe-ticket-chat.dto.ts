import { IsNotEmpty, IsString } from 'class-validator';

/** Only consulted for the Agent auth branch -- the Requester branch always
 * joins the room bound to the ticketId its tracking token already resolved
 * to at `handleConnection` time, ignoring whatever this DTO carries (spec
 * I/O matrix: "Socket de un Tenant intenta unirse a la sala de otro Tenant"
 * -- never let the payload itself pick the room for an anonymous caller). */
export class SubscribeTicketChatDto {
  @IsString()
  @IsNotEmpty()
  ticketId: string;
}
