import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class PostMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body: string;

  /** BCP-47 language tag of THIS message's content, independent of the
   * caller's UI locale (spec Acceptance Criteria / WCAG 3.1.2). Bounded to
   * match `chat_read_model.lang` (`VARCHAR(35)`, chat-microservice) so an
   * overlong value fails here as a clean 400, not a raw Postgres error. */
  @IsOptional()
  @IsString()
  @MaxLength(35)
  lang?: string;
}
