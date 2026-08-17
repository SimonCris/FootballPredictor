/**
 * GET /api/top-predictions?n=2..5 -> migliori N pronostici aggregati tra i
 * top 5 campionati, con quota combinata.
 */
import { Request, Response } from 'express';
import { getTopPredictions } from '../services/top-predictions.service';
import { logger } from '../utils/logger';

export async function getTopPredictionsHandler(req: Request, res: Response): Promise<void> {
  const rawN = req.query.n as string | undefined;
  const n = rawN ? parseInt(rawN, 10) : 5;

  if (Number.isNaN(n) || n < 2 || n > 5) {
    res.status(400).json({ error: 'Il parametro "n" deve essere un intero tra 2 e 5' });
    return;
  }

  try {
    const result = await getTopPredictions(n);
    res.json(result);
  } catch (err) {
    logger.error('Errore nel calcolo dei top pronostici', err);
    res.status(502).json({
      error: 'Impossibile calcolare i top pronostici al momento. Riprovare più tardi.',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
