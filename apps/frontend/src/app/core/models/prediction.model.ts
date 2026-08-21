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
  modelProbabilitiesBeforeBlend: { home: number; draw: number; away: number };
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

export interface MarketOdds {
  source: string;
  bookmakersCount: number;
  averageOdds: { home: number; draw: number; away: number };
  impliedProbabilities: { home: number; draw: number; away: number };
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
