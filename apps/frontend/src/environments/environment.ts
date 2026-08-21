// Configurazione ambiente di sviluppo. CHANGE_ME se il backend gira su un
// host/porta diversi da quelli di default.
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000/api',
  // TTL (ms) della cache lato FE per le risposte del backend, allineati alle
  // durate di cache già usate lato server (vedi apps/backend/src/config/env.ts)
  // così da evitare inutili richieste HTTP mentre i dati sono ancora validi.
  cacheTtlMs: {
    leagues: 24 * 60 * 60 * 1000, // 24h: lista campionati statica, cambia raramente
    matchday: 15 * 60 * 1000, // 15min, come CACHE_TTL_MATCHDAY
    prediction: 15 * 60 * 1000, // 15min, come CACHE_TTL_PREDICTIONS
    topPredictions: 15 * 60 * 1000, // 15min, coerente con matchday/predictions
  },
};
