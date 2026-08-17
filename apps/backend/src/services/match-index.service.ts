/**
 * Indice in memoria delle partite recuperate, usato per risolvere
 * GET /api/match/:id/predictions senza dover richiamare tutti i provider.
 * Viene popolato ogni volta che matchday.service recupera le partite di un
 * campionato (vedi matchday.service.ts).
 */
import { Match } from '../types/domain';

const matchIndex = new Map<string, Match>();

export function indexMatches(matches: Match[]): void {
  for (const match of matches) {
    matchIndex.set(match.id, match);
  }
}

export function findMatchById(id: string): Match | undefined {
  return matchIndex.get(id);
}
