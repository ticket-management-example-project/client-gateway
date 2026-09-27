import { ConsoleLogEmailSenderAdapter } from './console-log-email-sender.adapter';
import { EmailSendException } from './email-send.exception';

describe('ConsoleLogEmailSenderAdapter', () => {
  it('logs the email instead of sending it through a real provider', async () => {
    const adapter = new ConsoleLogEmailSenderAdapter();
    const logSpy = jest.spyOn(
      (adapter as unknown as { logger: { log: (msg: string) => void } }).logger,
      'log',
    );

    await adapter.send({
      to: 'maria@example.com',
      subject: 'Nueva respuesta en tu ticket',
      body: 'Un agente respondió tu ticket.',
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('maria@example.com'),
    );
  });

  it('wraps an unexpected logging failure in a typed EmailSendException, never a raw throw', async () => {
    const adapter = new ConsoleLogEmailSenderAdapter();
    jest
      .spyOn(
        (adapter as unknown as { logger: { log: (msg: string) => void } })
          .logger,
        'log',
      )
      .mockImplementation(() => {
        throw new Error('unexpected logger failure');
      });

    await expect(
      adapter.send({
        to: 'maria@example.com',
        subject: 'Nueva respuesta en tu ticket',
        body: 'Un agente respondió tu ticket.',
      }),
    ).rejects.toBeInstanceOf(EmailSendException);
  });
});
