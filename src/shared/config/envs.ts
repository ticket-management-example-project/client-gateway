import 'dotenv/config';
import * as joi from 'joi';

interface Envs {
  PORT: number;
  NATS_SERVERS: string[];
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_AUTHORIZED_PARTIES?: string[];
}

const envsSchema = joi
  .object({
    PORT: joi.number().required(),
    NATS_SERVERS: joi.array().items(joi.string()).required(),
    CLERK_SECRET_KEY: joi.string().required(),
    CLERK_PUBLISHABLE_KEY: joi.string().optional(),
    CLERK_AUTHORIZED_PARTIES: joi.array().items(joi.string()).optional(),
  })
  .unknown(true);

const { error, value } = envsSchema.validate({
  ...process.env,
  NATS_SERVERS: process.env.NATS_SERVERS?.split(','),
  CLERK_AUTHORIZED_PARTIES: process.env.CLERK_AUTHORIZED_PARTIES?.split(','),
});

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const envVars: Envs = value;

export const envs = {
  port: envVars.PORT,
  natsServers: envVars.NATS_SERVERS,
  clerkSecretKey: envVars.CLERK_SECRET_KEY,
  clerkPublishableKey: envVars.CLERK_PUBLISHABLE_KEY,
  clerkAuthorizedParties: envVars.CLERK_AUTHORIZED_PARTIES,
};
