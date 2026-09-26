/**
 * `client-gateway`'s first LOCAL typed exception -- unlike the rest of this
 * service (which only re-normalizes RPC/HTTP errors coming FROM other
 * services, via `DomainErrorFilter`), an `EmailSender` failure happens
 * entirely inside this gateway and is never surfaced to an HTTP caller (spec
 * Boundaries & Constraints: "una falla de envío se loguea con excepción
 * tipada, nunca un throw crudo"). `EmailSender` implementations throw this
 * instead of letting a raw provider error escape, so `ChatEventsConsumer`'s
 * catch always logs a stable `name`/`message` pair regardless of which
 * adapter is wired in (`ConsoleLogEmailSenderAdapter` today, a real
 * SMTP/SendGrid adapter later).
 */
export class EmailSendException extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EmailSendException';
  }
}
