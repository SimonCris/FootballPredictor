import { withRetry } from '../src/utils/http-retry';

function makeHttpError(status: number, headers: Record<string, string> = {}): Error {
  const err = new Error(`HTTP ${status}`) as Error & { response: { status: number; headers: Record<string, string> } };
  err.response = { status, headers };
  return err;
}

describe('withRetry', () => {
  it('non ritenta su errore 401 (chiave API non valida): fallisce al primo tentativo', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      throw makeHttpError(401);
    });

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 1 })).rejects.toThrow('HTTP 401');
    expect(calls).toBe(1);
  });

  it('non ritenta su errore 403 (quota/account disabilitato): fallisce al primo tentativo', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      throw makeHttpError(403);
    });

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 1 })).rejects.toThrow('HTTP 403');
    expect(calls).toBe(1);
  });

  it('ritenta normalmente su errore 500 fino a esaurire i tentativi', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      throw makeHttpError(500);
    });

    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow('HTTP 500');
    expect(calls).toBe(3);
  });

  it('ritenta su 429 rispettando Retry-After e infine ha successo', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls < 2) {
        throw makeHttpError(429, { 'retry-after': '0' });
      }
      return 'ok';
    });

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('restituisce il risultato al primo tentativo se non ci sono errori', async () => {
    const fn = jest.fn(async () => 'ok');
    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
