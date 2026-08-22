/**
 * Modelli dei pronostici, condivisi con il backend
 * (vedi apps/backend/src/types/domain.ts).
 */
import { Match } from './league.model';

export type MatchOutcome = '1' | 'X' | '2';
export type OverUnderSuggestion = 'OVER_2_5' | 'UNDER_2_5';

export interface TeamForm {
  teamId: string;
  lastResults: Array<'W' | 'D' | 'L'>;
  goalsScoredAvg: number;
  goalsConcededAvg: number;
  leaguePosition?: number;
}

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
  standingsFactor: number;
  marketBlendWeight: number;
  marketSkew: number;
  modelProbabilitiesBeforeBlend: { home: number; draw: number; away: number };
  overUnderModelProbability: { over: number; under: number };
}

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

export interface OverUnderMarketOdds {
  line: number;
  bookmakersCount: number;
  averageOdds: { over: number; under: number };
  impliedProbabilities: { over: number; under: number };
}

export interface AsianHandicapMarketOdds {
  line: number;
  bookmakersCount: number;
  averageOdds: { home: number; away: number };
  impliedProbabilities: { home: number; away: number };
}

export interface MarketOdds {
  source: string;
  bookmakersCount: number;
  averageOdds: { home: number; draw: number; away: number };
  impliedProbabilities: { home: number; draw: number; away: number };
  totals?: OverUnderMarketOdds;
  spreads?: AsianHandicapMarketOdds;
}

export interface MarketPick {
  outcome: string;
  label: string;
  probability: number;
}

export interface OverUnderLineEntry {
  line: number;
  over: number;
  under: number;
}

export interface MultigoalRangeEntry {
  label: string;
  min: number;
  max: number;
  probability: number;
}

export interface HalfTimeFullTimeEntry {
  half: MatchOutcome;
  full: MatchOutcome;
  label: string;
  probability: number;
}

export interface ExactGoalsEntry {
  goals: number;
  label: string;
  probability: number;
}

export interface ComboMarketEntry {
  label: string;
  probability: number;
}

export interface PredictionMarkets {
  matchResult1x2: { probabilities: { home: number; draw: number; away: number }; pick: MarketPick };
  doubleChance: { oneOrDraw: number; drawOrTwo: number; oneOrTwo: number; pick: MarketPick };
  halfTimeResult: { probabilities: { home: number; draw: number; away: number }; pick: MarketPick };
  secondHalfResult: { probabilities: { home: number; draw: number; away: number }; pick: MarketPick };
  halfTimeFullTime: { entries: HalfTimeFullTimeEntry[]; pick: HalfTimeFullTimeEntry };
  overUnder: { lines: OverUnderLineEntry[]; pick: MarketPick };
  bothTeamsToScore: { yes: number; no: number; pick: MarketPick };
  multigoal: { ranges: MultigoalRangeEntry[]; pick: MultigoalRangeEntry };
  teamToScore: { home: MarketPick; away: MarketPick };
  exactTotalGoals: { entries: ExactGoalsEntry[]; pick: ExactGoalsEntry };
  combos: {
    resultAndOverUnder: ComboMarketEntry;
    resultAndBtts: ComboMarketEntry;
    doubleChanceAndBtts: ComboMarketEntry;
    multigoalAndResult: ComboMarketEntry;
  };
}

export interface BestPick {
  marketKey: string;
  marketLabel: string;
  outcomeLabel: string;
  probability: number;
  confidence: number;
  estimatedOdds: number;
}


export interface Prediction {
  matchId: string;
  probabilities: {
    home: number;
    draw: number;
    away: number;
  };
  suggestedOutcome: MatchOutcome;
  overUnder: {
    suggestion: OverUnderSuggestion;
    expectedTotalGoals: number;
    probabilityOver: number;
    probabilityUnder: number;
  };
  doubleChance: {
    oneOrDraw: number;
    drawOrTwo: number;
    oneOrTwo: number;
  };
  bothTeamsToScore: {
    suggestion: 'YES' | 'NO';
    probabilityYes: number;
    probabilityNo: number;
  };
  confidence: number;
  estimatedOdds: number;
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
    standings?: {
      home?: Standing;
      away?: Standing;
    };
    marketOdds?: MarketOdds;
  };
  debugMetrics?: PredictionDebugMetrics;
  markets: PredictionMarkets;
  bestPick: BestPick;
  /** true se il motore ha usato valori neutri di fallback per mancanza di dati (forma squadre non disponibile). */
  dataQuality: {
    insufficientData: boolean;
    reasons: string[];
  };
}

export interface MatchPredictionResponse {
  match: Match;
  prediction: Prediction;
}

export interface TopPredictionEntry {
  match: Match;
  prediction: Prediction;
}

export interface TopPredictionsResponse {
  n: number;
  entries: TopPredictionEntry[];
  combinedOdds: number;
}
