/**
 * Servizio "Top Pronostici": aggrega le partite della prossima giornata dei
 * top 5 campionati, calcola il pronostico per ciascuna e restituisce i primi
 * N (2-5) ordinati per confidenza decrescente, insieme alla quota combinata
 * (prodotto delle quote stimate).
 */
import { getTop5Leagues } from '../config/leagues';
import { TopPredictionEntry, TopPredictionsResponse } from '../types/domain';
import { getNextMatchday } from './matchday.service';
import { getMatchPrediction } from './prediction.service';
import { roundTo } from '../utils/normalize';
import { logger } from '../utils/logger';

export async function getTopPredictions(n: number): Promise<TopPredictionsResponse> {
  const clampedN = Math.min(5, Math.max(2, n));
  const leagues = getTop5Leagues();

  // Recupera le partite di tutti i top 5 campionati in parallelo; un singolo
  // campionato che fallisce non deve bloccare gli altri (Promise.allSettled).
  const matchesByLeague = await Promise.allSettled(leagues.map((league) => getNextMatchday(league)));

  const allMatches = matchesByLeague.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    logger.warn(`Impossibile recuperare le partite per ${leagues[index].name}`, result.reason);
    return [];
  });

  // Calcola i pronostici per tutte le partite in parallelo (tollerando singoli fallimenti).
  const predictionResults = await Promise.allSettled(
    allMatches.map(async (match) => ({ match, prediction: await getMatchPrediction(match) }))
  );

  const entries: TopPredictionEntry[] = predictionResults
    .filter(
      (r): r is PromiseFulfilledResult<TopPredictionEntry> => r.status === 'fulfilled'
    )
    .map((r) => r.value)
    .sort((a, b) => b.prediction.confidence - a.prediction.confidence)
    .slice(0, clampedN);

  const combinedOdds = roundTo(
    entries.reduce((product, entry) => product * entry.prediction.estimatedOdds, 1),
    3
  );

  return { n: clampedN, entries, combinedOdds };
}
