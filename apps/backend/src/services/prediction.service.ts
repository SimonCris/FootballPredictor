/**
 * Motore di calcolo dei pronostici statistici.
 *
 * Approccio: modello di Poisson bivariato semplificato per stimare i gol
 * attesi di ciascuna squadra, combinato con un aggiustamento basato su
 * forma recente e scontri diretti. Il modulo espone una funzione pura
 * `computePrediction` (facilmente testabile in isolamento, vedi
 * tests/prediction.service.spec.ts) e una funzione `getMatchPrediction`
 * che recupera i dati necessari dai provider e li passa al calcolo.
 *
 * Step dell'algoritmo (vedi commenti inline):
 *  1. Forza attacco/difesa di ciascuna squadra, normalizzata sulla media gol di lega.
 *  2. Punteggio "forma recente" pesato (le partite più recenti contano di più).
 *  3. Gol attesi (expected goals) per squadra, con fattore vantaggio-casa.
 *  4. Probabilità 1X2 tramite distribuzione di Poisson bivariata.
 *  5. Aggiustamento delle probabilità con forma recente e scontri diretti.
 *  6. Suggerimento Over/Under 2.5 dai gol attesi totali.
 *  7. Punteggio di confidenza dallo scarto tra le probabilità.
 *  8. Quota stimata dalla probabilità dell'esito consigliato, con margine bookmaker.
 */
import {
  Match,
  MatchOutcome,
  Prediction,
  TeamForm,
} from '../types/domain';
import { roundTo } from '../utils/normalize';
import { providerManager } from './provider-manager';
import { getOrSetCache } from './cache.service';
import { env } from '../config/env';

/** Media gol per squadra a partita, usata come baseline campionato (valore tipico nei top campionati europei). */
const LEAGUE_AVG_GOALS_PER_TEAM = 1.35;
/** Fattore moltiplicativo che modella il vantaggio di giocare in casa. */
const HOME_ADVANTAGE_FACTOR = 1.15;
/** Margine bookmaker applicato alla quota "equa" (overround tipico ~7%). */
const BOOKMAKER_MARGIN = 1.07;
/** Numero massimo di gol per squadra considerato nella distribuzione di Poisson. */
const MAX_GOALS = 6;
/** Pesi per le ultime 5 partite, dal più recente (indice 0) al meno recente. */
const FORM_WEIGHTS = [5, 4, 3, 2, 1];
const RESULT_POINTS: Record<'W' | 'D' | 'L', number> = { W: 3, D: 1, L: 0 };

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

/** Probabilità di Poisson P(X = k) con media lambda. */
function poissonProbability(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Calcola un punteggio di forma normalizzato in [0, 1] a partire dagli ultimi
 * risultati, dando più peso alle partite più recenti.
 */
export function computeFormScore(lastResults: Array<'W' | 'D' | 'L'>): number {
  if (lastResults.length === 0) return 0.5; // nessun dato: forma neutra
  let weightedSum = 0;
  let weightTotal = 0;
  lastResults.forEach((result, index) => {
    const weight = FORM_WEIGHTS[index] ?? 1;
    weightedSum += RESULT_POINTS[result] * weight;
    weightTotal += weight * 3; // 3 = punteggio massimo (vittoria)
  });
  return weightTotal === 0 ? 0.5 : weightedSum / weightTotal;
}

/**
 * Calcola le probabilità 1X2 tramite distribuzione di Poisson bivariata
 * (assumendo indipendenza tra i gol delle due squadre, semplificazione
 * comune per modelli statistici entry-level).
 */
function computePoissonOutcomeProbabilities(
  expectedGoalsHome: number,
  expectedGoalsAway: number
): { home: number; draw: number; away: number } {
  let homeWinProb = 0;
  let drawProb = 0;
  let awayWinProb = 0;

  for (let homeGoals = 0; homeGoals <= MAX_GOALS; homeGoals++) {
    for (let awayGoals = 0; awayGoals <= MAX_GOALS; awayGoals++) {
      const jointProb =
        poissonProbability(expectedGoalsHome, homeGoals) *
        poissonProbability(expectedGoalsAway, awayGoals);
      if (homeGoals > awayGoals) homeWinProb += jointProb;
      else if (homeGoals === awayGoals) drawProb += jointProb;
      else awayWinProb += jointProb;
    }
  }

  // Normalizza per compensare la probabilità residua troncata oltre MAX_GOALS.
  const total = homeWinProb + drawProb + awayWinProb;
  return {
    home: homeWinProb / total,
    draw: drawProb / total,
    away: awayWinProb / total,
  };
}

export interface HeadToHeadStats {
  totalMatches: number;
  homeWins: number;
  draws: number;
  awayWins: number;
}

export interface PredictionInput {
  match: Match;
  homeForm: TeamForm;
  awayForm: TeamForm;
  headToHead: HeadToHeadStats;
  injuries?: { home: string[]; away: string[] };
  /** Se true, include le metriche di debug nel risultato (solo dev). */
  includeDebug?: boolean;
}

/**
 * Funzione pura che calcola il pronostico completo a partire dalle
 * statistiche già raccolte. Isolata dal recupero dati per facilitare i test
 * unitari (vedi tests/prediction.service.spec.ts).
 */
export function computePrediction({
  match,
  homeForm,
  awayForm,
  headToHead,
  injuries,
  includeDebug,
}: PredictionInput): Prediction {
  // Step 1: forza attacco/difesa normalizzata sulla media gol di lega.
  const homeAttackStrength = homeForm.goalsScoredAvg / LEAGUE_AVG_GOALS_PER_TEAM || 1;
  const homeDefenseStrength = homeForm.goalsConcededAvg / LEAGUE_AVG_GOALS_PER_TEAM || 1;
  const awayAttackStrength = awayForm.goalsScoredAvg / LEAGUE_AVG_GOALS_PER_TEAM || 1;
  const awayDefenseStrength = awayForm.goalsConcededAvg / LEAGUE_AVG_GOALS_PER_TEAM || 1;

  // Step 2: punteggio di forma recente pesato (0-1), usato come piccolo aggiustamento.
  const homeFormScore = computeFormScore(homeForm.lastResults);
  const awayFormScore = computeFormScore(awayForm.lastResults);

  // Step 3: gol attesi, combinando attacco della squadra con difesa avversaria e
  // applicando il vantaggio campo alla squadra di casa.
  const expectedGoalsHome =
    homeAttackStrength * awayDefenseStrength * LEAGUE_AVG_GOALS_PER_TEAM * HOME_ADVANTAGE_FACTOR;
  const expectedGoalsAway = awayAttackStrength * homeDefenseStrength * LEAGUE_AVG_GOALS_PER_TEAM;

  // Step 4: probabilità 1X2 grezze da Poisson bivariata.
  const rawProbabilities = computePoissonOutcomeProbabilities(expectedGoalsHome, expectedGoalsAway);

  // Step 5: aggiustamento con forma recente (differenza forma sposta leggermente
  // probabilità verso la squadra in forma migliore) e scontri diretti (se la
  // squadra di casa ha un H2H storicamente favorevole, piccolo bonus).
  const formDelta = (homeFormScore - awayFormScore) * 0.08; // max +/-8 punti percentuali
  const headToHeadFactor =
    headToHead.totalMatches > 0
      ? ((headToHead.homeWins - headToHead.awayWins) / headToHead.totalMatches) * 0.05
      : 0;

  let home = rawProbabilities.home + formDelta + headToHeadFactor;
  let draw = rawProbabilities.draw;
  let away = rawProbabilities.away - formDelta - headToHeadFactor;

  // Evita probabilità negative dopo l'aggiustamento, poi rinormalizza a 1.
  home = Math.max(home, 0.01);
  draw = Math.max(draw, 0.01);
  away = Math.max(away, 0.01);
  const sum = home + draw + away;
  home /= sum;
  draw /= sum;
  away /= sum;

  const probabilities = {
    home: roundTo(home * 100, 1),
    draw: roundTo(draw * 100, 1),
    away: roundTo(away * 100, 1),
  };

  // Step 6: esito consigliato = probabilità massima tra 1, X, 2.
  const outcomeEntries: Array<[MatchOutcome, number]> = [
    ['1', probabilities.home],
    ['X', probabilities.draw],
    ['2', probabilities.away],
  ];
  outcomeEntries.sort((a, b) => b[1] - a[1]);
  const suggestedOutcome = outcomeEntries[0][0];
  const topProbability = outcomeEntries[0][1];
  const secondProbability = outcomeEntries[1][1];

  // Step 7: suggerimento Over/Under 2.5 dai gol attesi totali.
  const expectedTotalGoals = roundTo(expectedGoalsHome + expectedGoalsAway, 2);
  const overUnder = {
    suggestion: (expectedTotalGoals >= 2.5 ? 'OVER_2_5' : 'UNDER_2_5') as Prediction['overUnder']['suggestion'],
    expectedTotalGoals,
  };

  // Step 8: confidenza = scarto tra la probabilità più alta e la seconda più alta,
  // scalato in 0-100 (uno scarto di 50 punti percentuali corrisponde a confidenza massima).
  const confidence = roundTo(Math.min(100, ((topProbability - secondProbability) / 50) * 100), 1);

  // Step 9: quota stimata = quota "equa" (100/probabilità) ridotta dal margine bookmaker.
  // Il valore minimo è vincolato a 1.01 poiché le quote decimali reali non scendono mai sotto 1.
  const estimatedOdds = Math.max(1.01, roundTo(100 / topProbability / BOOKMAKER_MARGIN, 2));

  const prediction: Prediction = {
    matchId: match.id,
    probabilities,
    suggestedOutcome,
    overUnder,
    confidence,
    estimatedOdds,
    stats: {
      homeForm,
      awayForm,
      headToHead,
      injuries,
    },
  };

  if (includeDebug) {
    prediction.debugMetrics = {
      homeAttackStrength: roundTo(homeAttackStrength, 3),
      homeDefenseStrength: roundTo(homeDefenseStrength, 3),
      awayAttackStrength: roundTo(awayAttackStrength, 3),
      awayDefenseStrength: roundTo(awayDefenseStrength, 3),
      homeFormScore: roundTo(homeFormScore, 3),
      awayFormScore: roundTo(awayFormScore, 3),
      headToHeadFactor: roundTo(headToHeadFactor, 3),
      homeAdvantageFactor: HOME_ADVANTAGE_FACTOR,
      expectedGoalsHome: roundTo(expectedGoalsHome, 3),
      expectedGoalsAway: roundTo(expectedGoalsAway, 3),
    };
  }

  return prediction;
}

/**
 * Recupera dai provider (con cache) tutte le statistiche necessarie per una
 * partita e calcola il pronostico completo.
 */
export async function getMatchPrediction(match: Match): Promise<Prediction> {
  const cacheKey = `prediction:${match.id}`;
  return getOrSetCache(cacheKey, env.cacheTtlPredictions, async () => {
    const [homeForm, awayForm, headToHead] = await Promise.all([
      providerManager.getTeamForm(match.homeTeam.id, match.leagueCode),
      providerManager.getTeamForm(match.awayTeam.id, match.leagueCode),
      providerManager.getHeadToHead(match.homeTeam.id, match.awayTeam.id),
    ]);

    return computePrediction({
      match,
      homeForm,
      awayForm,
      headToHead,
      includeDebug: !env.isProduction,
    });
  });
}
