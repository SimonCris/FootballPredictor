/**
 * Entry point del backend Express. Avvia il server HTTP ed espone l'API
 * REST sotto /api (vedi src/routes/index.ts).
 */
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { env } from './config/env';
import { apiRouter } from './routes';
import { logger } from './utils/logger';

const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', env: env.nodeEnv });
});

app.use('/api', apiRouter);

// Gestore 404 per rotte non definite.
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Risorsa non trovata' });
});

// Gestore errori centralizzato: evita che eccezioni non gestite crashino il processo
// senza rispondere al client.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Errore non gestito', err);
  res.status(500).json({ error: 'Errore interno del server' });
});

app.listen(env.port, () => {
  logger.info(`Backend in ascolto su http://localhost:${env.port} (env: ${env.nodeEnv})`);
});
