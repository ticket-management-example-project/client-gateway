/**
 * First email port of the system (spec Boundaries & Constraints: "el
 * adapter de email es un puerto... ningún import directo de una librería de
 * envío real desde el dominio/handler"), same token-DI shape as
 * `DOMAIN_EVENT_CONSUMER`/`NATS_SERVICE` (`src/shared/config/services.ts`).
 * `ConsoleLogEmailSenderAdapter` is the only implementation today; a real
 * SMTP/SendGrid adapter can be swapped in later behind this same interface
 * without touching `ChatEventsConsumer` (spec: "queda listo para enchufar un
 * provider real... sin tocar el dominio").
 */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailSender {
  /** Best-effort from the caller's perspective (spec: "el envío nunca
   * bloquea") -- implementations reject with `EmailSendException`, never a
   * raw `Error`, so callers can log a stable typed failure. */
  send(message: EmailMessage): Promise<void>;
}
