/**
 * Servizio che espone le partite della prossima giornata per un campionato,
 * con caching per ridurre le chiamate ai provider esterni.
 */
import { League, Match } from '../types/domain';
import { providerManager } from './provider-manager';
import { getOrSetCache } from './cache.service';
import { env } from '../config/env';
import { indexMatches } from './match-index.service';

export async function getNextMatchday(league: League): Promise<Match[]> {
  const cacheKey = `matchday:${league.code}`;
  const matches = await getOrSetCache(cacheKey, env.cacheTtlMatchday, () =>
    providerManager.getNextMatchday(league)
  );
  // Mantiene aggiornato l'indice usato da GET /api/match/:id/predictions.
  indexMatches(matches);
  return matches;
}
