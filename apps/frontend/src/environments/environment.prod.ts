// Configurazione ambiente di produzione. CHANGE_ME con l'URL reale del
// backend distribuito.
export const environment = {
  production: true,
  apiBaseUrl: '/api',
  cacheTtlMs: {
    leagues: 24 * 60 * 60 * 1000,
    matchday: 15 * 60 * 1000,
    prediction: 15 * 60 * 1000,
    topPredictions: 15 * 60 * 1000,
  },
};
