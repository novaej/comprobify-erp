import { pino, type DestinationStream, type TransportTargetOptions } from 'pino';

export type LogFields = {
  requestId?: string;
  tenantId?: string;
  userId?: string;
  jobId?: string;
  accessKey?: string;
  event?: string;
  reason?: string;
  durationMs?: number;
  err?: unknown;
};

export type Logger = {
  [Level in 'debug' | 'info' | 'warn' | 'error']: (message: string, fields?: LogFields) => void;
} & {
  child: (fields: LogFields) => Logger;
};

export type LoggerOptions = {
  service: string;
  level: string;
  pretty?: boolean;
  betterstackSourceToken?: string | undefined;
  destination?: DestinationStream;
};

const ALLOWED: readonly (keyof LogFields)[] = [
  'requestId',
  'tenantId',
  'userId',
  'jobId',
  'accessKey',
  'event',
  'reason',
  'durationMs',
];

function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { type: typeof err };
  const code = 'code' in err && typeof err.code === 'string' ? err.code : undefined;
  return { type: err.name, message: err.message, stack: err.stack, code };
}

// Copies known keys only, so a spread request can't reach the logs (lesson 6).
function pick(fields: LogFields = {}): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (fields[key] !== undefined) picked[key] = fields[key];
  }
  if (fields.err !== undefined) picked.err = serializeError(fields.err);
  return picked;
}

function wrap(base: pino.Logger): Logger {
  return {
    debug: (message, fields) => base.debug(pick(fields), message),
    info: (message, fields) => base.info(pick(fields), message),
    warn: (message, fields) => base.warn(pick(fields), message),
    error: (message, fields) => base.error(pick(fields), message),
    child: (fields) => wrap(base.child(pick(fields))),
  };
}

function transportTargets(options: LoggerOptions): TransportTargetOptions[] {
  const stdout: TransportTargetOptions = options.pretty
    ? { target: 'pino-pretty', options: { destination: 1 } }
    : { target: 'pino/file', options: { destination: 1 } };
  if (!options.betterstackSourceToken) return [stdout];
  return [
    stdout,
    { target: '@logtail/pino', options: { sourceToken: options.betterstackSourceToken } },
  ];
}

export function createLogger(options: LoggerOptions): Logger {
  const config = {
    level: options.level,
    base: { service: options.service },
    // pick() already serialized it; pino's default would rewrite `type`.
    serializers: { err: (value: unknown) => value },
  };
  if (options.destination) return wrap(pino(config, options.destination));
  return wrap(pino(config, pino.transport({ targets: transportTargets(options) })));
}
