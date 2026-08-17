/**
 * Definizioni dei tipi di dominio condivisi in tutto il backend.
 * Queste interfacce rappresentano il modello dati normalizzato che l'API
 * espone al frontend, indipendentemente dal provider esterno usato per
 * recuperare i dati grezzi.
 */

/** Campionato supportato dall'applicazione. */
export interface League {
  /** Codice interno usato nelle query (?league=CODE), es. "SA", "PL". */
  code: string;
  /** Nome leggibile, es. "Serie A". */
  name: string;
  /** Paese del campionato. */
  country: string;
  /** true se il campionato fa parte dei "top 5" usati in Top Pronostici. */
  isTop5: boolean;
  /** Codice/i usati dai provider esterni per mappare questo campionato. */
  providerIds: {
    footballData?: string; // es. "SA", "PL", "PD" (football-data.org competition code)
    theSportsDb?: string; // es. id lega TheSportsDB
  };
}

/** Squadra normalizzata. */
export interface Team {
  id: string;
  name: string;
  shortName?: string;
  crestUrl?: string;
}

/** Statistiche recenti di una squadra, usate come input del motore pronostici. */
export interface TeamForm {
  teamId: string;
  /** Risultati delle ultime N partite, dal più recente al meno recente: 'W' | 'D' | 'L'. */
  lastResults: Array<'W' | 'D' | 'L'>;
  goalsScoredAvg: number;
  goalsConcededAvg: number;
  /** Posizione in classifica, se disponibile. */
  leaguePosition?: number;
}

/** Partita normalizzata, indipendente dal provider di origine. */
export interface Match {
  id: string;
  leagueCode: string;
  /** Data/ora in ISO 8601 UTC. */
  utcDate: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'UNKNOWN';
  homeTeam: Team;
  awayTeam: Team;
  venue?: string;
  /** Giornata/matchday numerico, se disponibile. */
  matchday?: number;
  /** Provider da cui e' stato ottenuto il dato ("football-data" | "thesportsdb"). */
  source: string;
  /** Link a pagina dettagli esterna, se disponibile. */
  detailsUrl?: string;
}

/** Esito 1X2 possibile. */
export type MatchOutcome = '1' | 'X' | '2';

/** Suggerimento Over/Under sulla linea 2.5 gol. */
export type OverUnderSuggestion = 'OVER_2_5' | 'UNDER_2_5';

/** Metriche di debug che spiegano come e' stato calcolato un pronostico (solo dev). */
export interface PredictionDebugMetrics {
  homeAttackStrength: number;
  homeDefenseStrength: number;
  awayAttackStrength: number;
  awayDefenseStrength: number;
  homeFormScore: number;
  awayFormScore: number;
  headToHeadFactor: number;
  homeAdvantageFactor: number;
  expectedGoalsHome: number;
  expectedGoalsAway: number;
}

/** Pronostico calcolato per una partita. */
export interface Prediction {
  matchId: string;
  /** Probabilita' percentuali per i tre esiti, sommano a 100 (arrotondamenti a parte). */
  probabilities: {
    home: number; // probabilità 1
    draw: number; // probabilità X
    away: number; // probabilità 2
  };
  /** Esito consigliato tra 1, X, 2. */
  suggestedOutcome: MatchOutcome;
  overUnder: {
    suggestion: OverUnderSuggestion;
    expectedTotalGoals: number;
  };
  /** Punteggio di affidabilità 0-100: piu' alto = piu' affidabile. */
  confidence: number;
  /** Quota stimata (decimal odds) per l'esito consigliato, con margine bookmaker. */
  estimatedOdds: number;
  /** Statistiche usate per generare il pronostico, mostrate nel dettaglio partita. */
  stats: {
    homeForm: TeamForm;
    awayForm: TeamForm;
    headToHead: {
      totalMatches: number;
      homeWins: number;
      draws: number;
      awayWins: number;
    };
    injuries?: {
      home: string[];
      away: string[];
    };
  };
  /** Presente solo in sviluppo (NODE_ENV !== 'production'), per debug del calcolo. */
  debugMetrics?: PredictionDebugMetrics;
}

/** Voce della classifica Top Pronostici. */
export interface TopPredictionEntry {
  match: Match;
  prediction: Prediction;
}

/** Risposta dell'endpoint /api/top-predictions. */
export interface TopPredictionsResponse {
  n: number;
  entries: TopPredictionEntry[];
  /** Prodotto delle quote stimate dei pronostici selezionati, arrotondato a 3 decimali. */
  combinedOdds: number;
}

/** Interfaccia comune implementata da ogni provider dati esterno. */
export interface MatchProvider {
  name: string;
  /** Recupera le partite della prossima giornata per un dato campionato. */
  getNextMatchday(league: League): Promise<Match[]>;
  /** Recupera la forma recente di una squadra. */
  getTeamForm(teamId: string, leagueCode: string): Promise<TeamForm>;
  /** Recupera lo storico scontri diretti tra due squadre. */
  getHeadToHead(
    homeTeamId: string,
    awayTeamId: string
  ): Promise<{ totalMatches: number; homeWins: number; draws: number; awayWins: number }>;
}
