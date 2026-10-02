import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Story 5.2: body of `POST tickets/:ticketId/triage/correct`. The allowed
 * priorities mirror `TicketPriority` in `ticket-microservice`. */
export class CorrectTriageDto {
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsIn(['alta', 'media'])
  priority: 'alta' | 'media';

  /** Omitted/`null` = no suggested agent. */
  @IsOptional()
  @IsString()
  suggestedAgentId?: string | null;
}
