/**
 * Caricamento e validazione delle variabili d'ambiente.
 * Personalizzare i valori in apps/backend/.env (copiare da .env.example).
 */
import dotenv from 'dotenv';

dotenv.config();

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variabile d'ambiente mancante: ${name}`);
  }
  return value;
}

function getEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const env = {
  port: getEnvInt('PORT', 3000),
  nodeEnv: getEnv('NODE_ENV', 'development'),
  isProduction: getEnv('NODE_ENV', 'development') === 'production',

  // CHANGE_ME: inserire la propria chiave gratuita ottenuta da football-data.org
  footballDataApiKey: getEnv('FOOTBALL_DATA_API_KEY', ''),
  footballDataBaseUrl: getEnv('FOOTBALL_DATA_BASE_URL', 'https://api.football-data.org/v4'),

  /**
   * True solo se è stata impostata una chiave reale (non vuota e diversa dal
   * placeholder di .env.example). Usato per evitare di tentare chiamate
   * HTTP a football-data.org destinate a fallire con 400/401 quando la
   * chiave non è ancora stata configurata, saltando subito al fallback
   * TheSportsDB e risparmiando tempo/retry inutili.
   */
  isFootballDataConfigured:
    !!process.env.FOOTBALL_DATA_API_KEY &&
    !process.env.FOOTBALL_DATA_API_KEY.startsWith('CHANGE_ME'),

  // Chiave pubblica di test "3" valida per TheSportsDB senza registrazione.
  theSportsDbApiKey: getEnv('THESPORTSDB_API_KEY', '3'),
  theSportsDbBaseUrl: getEnv('THESPORTSDB_BASE_URL', 'https://www.thesportsdb.com/api/v1/json'),

  cacheTtlMatchday: getEnvInt('CACHE_TTL_MATCHDAY', 900),
  cacheTtlPredictions: getEnvInt('CACHE_TTL_PREDICTIONS', 900),

  httpTimeoutMs: getEnvInt('HTTP_TIMEOUT_MS', 8000),
  httpMaxRetries: getEnvInt('HTTP_MAX_RETRIES', 2),

  corsOrigin: getEnv('CORS_ORIGIN', 'http://localhost:4200'),
};
