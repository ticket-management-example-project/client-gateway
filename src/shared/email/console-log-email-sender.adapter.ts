import { Injectable, Logger } from '@nestjs/common';
import { EmailMessage, EmailSender } from './email-sender.port';
import { EmailSendException } from './email-send.exception';

/**
 * Human decision (spec Approach): no real email provider in this story --
 * this adapter only logs the email it WOULD have sent, so the port's
 * contract/wiring exists end-to-end before any external credential/account
 * is introduced. The only file in this service allowed to be "the" email
 * sender until a real SMTP/SendGrid adapter replaces it (same "one file
 * imports the real thing" discipline as `KafkaDomainEventConsumerAdapter`).
 */
@Injectable()
export class ConsoleLogEmailSenderAdapter implements EmailSender {
  private readonly logger = new Logger(ConsoleLogEmailSenderAdapter.name);

  async send(message: EmailMessage): Promise<void> {
    try {
      this.logger.log(
        `[ConsoleLogEmailSender] to=${message.to} subject="${message.subject}" body="${message.body}"`,
      );
    } catch (error) {
      // Defensive: `Logger.log` never throws in practice, but the port's
      // contract (spec: "excepción tipada, nunca un throw crudo") must hold
      // even if a future real adapter's underlying call rejects here.
      throw new EmailSendException(
        `Failed to send email to ${message.to}`,
        error,
      );
    }
  }
}
