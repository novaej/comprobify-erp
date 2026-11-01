import { describe, expect, it } from 'vitest';
import { createLogger, type LogFields } from './logger';

function capture(level = 'info') {
  const lines: Record<string, unknown>[] = [];
  const destination = {
    write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>),
  };
  return { lines, logger: createLogger({ service: 'test', level, destination }) };
}

describe('createLogger', () => {
  it('writes JSON with the service and allowed fields', () => {
    const { lines, logger } = capture();
    logger.info('hello', { tenantId: 't-1', jobId: 'j-1', durationMs: 5 });
    expect(lines[0]).toMatchObject({
      service: 'test',
      msg: 'hello',
      tenantId: 't-1',
      jobId: 'j-1',
      durationMs: 5,
    });
  });

  it('drops fields outside the allow-list', () => {
    const { lines, logger } = capture();
    const request = { requestId: 'r-1', authorization: 'Bearer x', query: 'token=y' };
    logger.info('request', request);
    expect(lines[0]).toHaveProperty('requestId', 'r-1');
    expect(JSON.stringify(lines[0])).not.toMatch(/Bearer|token=y/);
  });

  it('keeps child fields on the allow-list too', () => {
    const { lines, logger } = capture();
    logger.child({ requestId: 'r-1', password: 'x' } as LogFields).warn('child');
    expect(lines[0]).toHaveProperty('requestId', 'r-1');
    expect(lines[0]).not.toHaveProperty('password');
  });

  it('serializes only known error fields', () => {
    const { lines, logger } = capture();
    const err = Object.assign(new Error('boom'), { code: 'E_X', config: { headers: 'secret' } });
    logger.error('failed', { err });
    expect(lines[0]?.err).toMatchObject({ type: 'Error', message: 'boom', code: 'E_X' });
    expect(JSON.stringify(lines[0])).not.toContain('secret');
  });

  it('does not stringify a thrown non-error', () => {
    const { lines, logger } = capture();
    logger.error('failed', { err: { password: 'x' } });
    expect(lines[0]?.err).toEqual({ type: 'object' });
  });

  it('respects the level', () => {
    const { lines, logger } = capture('warn');
    logger.info('hidden');
    logger.warn('shown');
    expect(lines.map((line) => line.msg)).toEqual(['shown']);
  });
});
