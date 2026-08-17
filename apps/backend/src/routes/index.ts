/**
 * Definizione delle rotte REST dell'API, montate sotto /api in src/index.ts.
 */
import { Router } from 'express';
import { listLeagues } from '../controllers/leagues.controller';
import { getMatchday } from '../controllers/matchday.controller';
import { getMatchPredictions } from '../controllers/match.controller';
import { getTopPredictionsHandler } from '../controllers/top-predictions.controller';

export const apiRouter = Router();

apiRouter.get('/leagues', listLeagues);
apiRouter.get('/matchday', getMatchday);
apiRouter.get('/match/:id/predictions', getMatchPredictions);
apiRouter.get('/top-predictions', getTopPredictionsHandler);
