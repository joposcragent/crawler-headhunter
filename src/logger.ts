import util from 'node:util';
import type TransportStream from 'winston-transport';
import winston from 'winston';

const { combine, timestamp, printf } = winston.format;

export type CreateServiceLoggerOptions = {
  extraTransports?: TransportStream[];
};

const lineFormat = printf((info) => {
  const ts = String(info.timestamp ?? '');
  const prefix = String((info as { prefix?: string }).prefix ?? '');
  const { level, message, ...rest } = info;
  const meta = { ...rest };
  delete (meta as { prefix?: string }).prefix;
  const metaKeys = Object.keys(meta).filter((k) => !k.startsWith('_') && k !== 'splat');
  const tail =
    metaKeys.length > 0
      ? ` ${util.inspect(Object.fromEntries(metaKeys.map((k) => [k, meta[k as keyof typeof meta]])), { depth: 3, breakLength: 120 })}`
      : '';
  return `${ts} ${prefix} ${level}: ${String(message)}${tail}`;
});

export function createServiceLogger(
  prefix: string,
  options?: CreateServiceLoggerOptions,
): winston.Logger {
  const transports: winston.transport[] = [
    new winston.transports.Console(),
    ...(options?.extraTransports ?? []),
  ];
  return winston.createLogger({
    level: 'info',
    defaultMeta: { prefix },
    format: combine(timestamp(), lineFormat),
    transports,
  });
}
