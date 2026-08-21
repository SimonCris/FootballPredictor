/**
 * Helper generico per eseguire una richiesta HTTP (o qualsiasi funzione
 * asincrona) con retry esponenziale e timeout, in modo da gestire in modo
 * resiliente i rate limit e i timeout dei provider gratuiti.
 */
import { logger } from './logger';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
}

/** Estrae lo status HTTP dall'errore, se presente (es. errori Axios). */
function extractStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

/**
 * Errori 401 (chiave API non valida) e 403 (quota esaurita/account disabilitato)
 * sono permanenti per la richiesta corrente: ritentare non cambia l'esito e
 * spreca tempo/chiamate, quindi vanno propagati subito senza retry.
 */
function isNonRetryableStatus(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/** Estrae, se presente, il valore in secondi dell'header Retry-After di una risposta 429. */
function extractRetryAfterMs(err: unknown): number | undefined {
  const response = (err as { response?: { status?: number; headers?: Record<string, string> } })
    ?.response;
  if (response?.status !== 429) return undefined;

  const retryAfterHeader = response.headers?.['retry-after'];
  if (!retryAfterHeader) return undefined;

  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isNaN(retryAfterSeconds)) return undefined;

  // Limitiamo l'attesa massima a 15s per non bloccare troppo a lungo una
  // singola richiesta HTTP verso il nostro backend.
  return Math.min(retryAfterSeconds * 1000, 15000);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries, baseDelayMs = 300 }: RetryOptions
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Chiave non valida (401) o quota/account disabilitato (403): errore
      // permanente, non ha senso ritentare, falliamo subito.
      if (isNonRetryableStatus(extractStatus(err))) {
        logger.warn(
          `Richiesta fallita con status non ritentabile (401/403), interrompo senza retry`,
          err
        );
        throw err;
      }

      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt) break;

      // Se il provider risponde 429 con un header Retry-After, rispettiamo
      // quel valore invece del backoff esponenziale standard.
      const retryAfterMs = extractRetryAfterMs(err);
      const delay = retryAfterMs ?? baseDelayMs * Math.pow(2, attempt);
      logger.warn(`Tentativo ${attempt + 1} fallito, retry tra ${delay}ms`, err);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
