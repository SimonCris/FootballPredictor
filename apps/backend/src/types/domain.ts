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
    oddsApi?: string; // sport key di The Odds API, es. "soccer_italy_serie_a"
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

/** Riga di classifica normalizzata (posizione, punti, statistiche stagionali). */
export interface Standing {
  teamId: string;
  position: number;
  played: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

/**
 * Mercato Over/Under aggregato (es. linea 2.5 gol), con quote medie e
 * probabilità implicite "de-vigged" (margine bookmaker rimosso).
 */
export interface OverUnderMarketOdds {
  /** Linea gol usata (es. 2.5). Scelta come la più vicina a 2.5 tra quelle offerte. */
  line: number;
  bookmakersCount: number;
  averageOdds: { over: number; under: number };
  impliedProbabilities: { over: number; under: number };
}

/**
 * Mercato handicap asiatico aggregato, riferito alla squadra di casa
 * (es. linea -1.5 significa "casa vince con almeno 2 gol di scarto").
 */
export interface AsianHandicapMarketOdds {
  /** Linea handicap applicata alla squadra di casa (es. -1.5, +0.5). Scelta come la più vicina a 0. */
  line: number;
  bookmakersCount: number;
  averageOdds: { home: number; away: number };
  impliedProbabilities: { home: number; away: number };
}

/**
 * Quote di mercato aggregate da servizi di betting gratuiti (es. The Odds API,
 * piano free), usate come segnale aggiuntivo per "correggere" il pronostico
 * statistico verso il consenso reale dei bookmaker.
 */
export interface MarketOdds {
  /** Nome del servizio da cui provengono le quote (es. "the-odds-api"). */
  source: string;
  /** Numero di bookmaker aggregati per calcolare la media (mercato 1X2). */
  bookmakersCount: number;
  /** Quote decimali medie per esito 1X2. */
  averageOdds: {
    home: number;
    draw: number;
    away: number;
  };
  /** Probabilità implicite dalle quote medie 1X2, "de-vigged" (normalizzate a 100%). */
  impliedProbabilities: {
    home: number;
    draw: number;
    away: number;
  };
  /** Mercato Over/Under reale, se il bookmaker lo offre (facoltativo, nessun errore se assente). */
  totals?: OverUnderMarketOdds;
  /** Mercato handicap asiatico reale, se il bookmaker lo offre (facoltativo, nessun errore se assente). */
  spreads?: AsianHandicapMarketOdds;
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
  /** Aggiustamento derivato dalla differenza di posizione in classifica. */
  standingsFactor: number;
  /** Peso [0-1] dato alle quote di mercato nel blend con il modello statistico (dinamico, vedi calculateMarketTrustWeight). */
  marketBlendWeight: number;
  /** Quanto e' "sbilanciato" il mercato verso un singolo esito, in [0-1] (0 = equilibrato, 1 = fortemente sbilanciato). */
  marketSkew: number;
  /** Probabilità del modello statistico prima del blend con il mercato. */
  modelProbabilitiesBeforeBlend: { home: number; draw: number; away: number };
  /** Probabilità Over/Under 2.5 secondo il solo modello statistico (prima del blend con il mercato totals). */
  overUnderModelProbability: { over: number; under: number };
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
    /** Probabilità percentuale di Over/Under sulla linea usata (default 2.5), dopo il blend con il mercato "totals" reale se disponibile. */
    probabilityOver: number;
    probabilityUnder: number;
  };
  /**
   * Doppia chance (1X, X2, 12), derivata matematicamente sommando le
   * probabilità 1X2 finali corrispondenti (nessun mercato dedicato
   * disponibile gratuitamente, ma la derivazione è aritmetica esatta).
   */
  doubleChance: {
    oneOrDraw: number; // 1X
    drawOrTwo: number; // X2
    oneOrTwo: number; // 12
  };
  /**
   * Both Teams To Score, derivato dal modello di Poisson bivariato
   * (nessun mercato "btts" fetchabile gratuitamente da The Odds API).
   */
  bothTeamsToScore: {
    suggestion: 'YES' | 'NO';
    probabilityYes: number;
    probabilityNo: number;
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
    /** Classifica delle due squadre, se disponibile (football-data.org o TheSportsDB). */
    standings?: {
      home?: Standing;
      away?: Standing;
    };
    /** Quote di mercato aggregate da servizi di betting gratuiti, se disponibili. */
    marketOdds?: MarketOdds;
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
  /** Recupera la classifica corrente del campionato. */
  getStandings(league: League): Promise<Standing[]>;
}
