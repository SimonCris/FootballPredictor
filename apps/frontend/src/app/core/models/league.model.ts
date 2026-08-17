/**
 * Modelli condivisi con il backend (vedi apps/backend/src/types/domain.ts).
 * Mantenuti sincronizzati manualmente: se si cambia un'interfaccia sul
 * backend, aggiornare anche qui.
 */

export interface League {
  code: string;
  name: string;
  country: string;
  isTop5: boolean;
  providerIds: {
    footballData?: string;
    theSportsDb?: string;
  };
}

export interface Team {
  id: string;
  name: string;
  shortName?: string;
  crestUrl?: string;
}

export interface Match {
  id: string;
  leagueCode: string;
  utcDate: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'UNKNOWN';
  homeTeam: Team;
  awayTeam: Team;
  venue?: string;
  matchday?: number;
  source: string;
  detailsUrl?: string;
}

export interface MatchdayResponse {
  league: League;
  matches: Match[];
  /** Presente se il backend rileva un possibile limite di dati del provider gratuito. */
  warning?: string;
}
