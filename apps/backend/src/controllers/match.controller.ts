/**
 * GET /api/match/:id/predictions -> pronostico dettagliato per una partita.
 */
import { Request, Response } from 'express';
import { findMatchById } from '../services/match-index.service';
import { getMatchPrediction } from '../services/prediction.service';
import { logger } from '../utils/logger';

export async function getMatchPredictions(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const match = findMatchById(id);
  if (!match) {
    res.status(404).json({
      error:
        'Partita non trovata. Richiamare prima GET /api/matchday?league=CODE per popolare i dati.',
    });
    return;
  }

  try {
    const prediction = await getMatchPrediction(match);
    res.json({ match, prediction });
  } catch (err) {
    logger.error('Errore nel calcolo del pronostico', err);
    res.status(502).json({
      error: 'Impossibile calcolare il pronostico al momento. Riprovare più tardi.',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
