/**
 * Motore di calcolo dei pronostici statistici.
 *
 * Approccio: modello di Poisson bivariato semplificato per stimare i gol
 * attesi di ciascuna squadra, combinato con aggiustamenti basati su forma
 * recente, scontri diretti e posizione in classifica, e infine "corretto"
 * miscelando le probabilità del modello con quelle implicite nelle quote
 * reali dei bookmaker (se disponibili tramite The Odds API, piano free).
 * Il modulo espone una funzione pura `computePrediction` (facilmente
 * testabile in isolamento, vedi tests/prediction.service.spec.ts) e una
 * funzione `getMatchPrediction` che recupera i dati necessari dai provider
 * e li passa al calcolo.
 *
 * Step dell'algoritmo (vedi commenti inline):
 *  1. Forza attacco/difesa di ciascuna squadra, normalizzata sulla media gol di lega.
 *  2. Punteggio "forma recente" pesato (le partite più recenti contano di più).
 *  3. Gol attesi (expected goals) per squadra, con fattore vantaggio-casa.
 *  4. Probabilità 1X2 tramite distribuzione di Poisson bivariata.
 *  5. Aggiustamento delle probabilità con forma recente, scontri diretti e
 *     differenza di posizione in classifica.
 *  6. Blend con le probabilità implicite nelle quote di mercato reali (se disponibili).
 *  7. Suggerimento Over/Under 2.5 dai gol attesi totali.
 *  8. Punteggio di confidenza dallo scarto tra le probabilità.
 *  9. Quota stimata: media tra la quota "equa" del modello e la quota di mercato reale (se disponibile).
 */
import {
  Match,
  MatchOutcome,
  Prediction,
  Standing,
  MarketOdds,
  TeamForm,
} from '../types/domain';
import { roundTo } from '../utils/normalize';
import { providerManager } from './provider-manager';
import { oddsProvider } from '../providers/odds.provider';
import { getOrSetCache } from './cache.service';
import { env } from '../config/env';
import { findLeagueByCode } from '../config/leagues';
import { logger } from '../utils/logger';

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
/** Peso massimo dato alle quote di mercato reali nel blend con il modello statistico. */
const MARKET_BLEND_WEIGHT = 0.4;
/** Numero tipico di squadre in un campionato europeo, usato per normalizzare il fattore classifica. */
const TYPICAL_LEAGUE_SIZE = 20;

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
  /** Classifica delle due squadre, se disponibile (posizione, punti, ecc.). */
  homeStanding?: Standing;
  awayStanding?: Standing;
  /** Numero di squadre nel campionato, per normalizzare il fattore classifica (default 20). */
  leagueSize?: number;
  /** Quote di mercato reali aggregate da servizi di betting gratuiti, se disponibili. */
  marketOdds?: MarketOdds;
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
  homeStanding,
  awayStanding,
  leagueSize = TYPICAL_LEAGUE_SIZE,
  marketOdds,
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
  // probabilità verso la squadra in forma migliore), scontri diretti (se la
  // squadra di casa ha un H2H storicamente favorevole, piccolo bonus) e
  // posizione in classifica (una squadra molto più in alto in classifica
  // riceve un piccolo bonus aggiuntivo, indipendente dalla sola forma/gol,
  // perché riflette la qualità della rosa sull'intera stagione).
  const formDelta = (homeFormScore - awayFormScore) * 0.08; // max +/-8 punti percentuali
  const headToHeadFactor =
    headToHead.totalMatches > 0
      ? ((headToHead.homeWins - headToHead.awayWins) / headToHead.totalMatches) * 0.05
      : 0;
  const standingsFactor =
    homeStanding && awayStanding
      ? ((awayStanding.position - homeStanding.position) / leagueSize) * 0.06 // max +/-6 punti percentuali circa
      : 0;

  let home = rawProbabilities.home + formDelta + headToHeadFactor + standingsFactor;
  let draw = rawProbabilities.draw;
  let away = rawProbabilities.away - formDelta - headToHeadFactor - standingsFactor;

  // Evita probabilità negative dopo l'aggiustamento, poi rinormalizza a 1.
  home = Math.max(home, 0.01);
  draw = Math.max(draw, 0.01);
  away = Math.max(away, 0.01);
  const sum = home + draw + away;
  home /= sum;
  draw /= sum;
  away /= sum;

  const modelProbabilitiesBeforeBlend = {
    home: roundTo(home * 100, 1),
    draw: roundTo(draw * 100, 1),
    away: roundTo(away * 100, 1),
  };

  // Step 6: blend con le probabilità di mercato reali (se disponibili da The
  // Odds API). Diamo un peso fisso al mercato (MARKET_BLEND_WEIGHT) perché
  // riflette il consenso aggregato di molti bookmaker e tipicamente include
  // informazioni (infortuni dell'ultima ora, formazioni, meteo) che il
  // nostro modello statistico non può conoscere. Se il mercato non è
  // disponibile, il peso è 0 e il risultato resta invariato.
  const marketBlendWeight = marketOdds ? MARKET_BLEND_WEIGHT : 0;
  if (marketOdds) {
    home = home * (1 - marketBlendWeight) + marketOdds.impliedProbabilities.home * marketBlendWeight;
    draw = draw * (1 - marketBlendWeight) + marketOdds.impliedProbabilities.draw * marketBlendWeight;
    away = away * (1 - marketBlendWeight) + marketOdds.impliedProbabilities.away * marketBlendWeight;
    const blendedSum = home + draw + away;
    home /= blendedSum;
    draw /= blendedSum;
    away /= blendedSum;
  }

  const probabilities = {
    home: roundTo(home * 100, 1),
    draw: roundTo(draw * 100, 1),
    away: roundTo(away * 100, 1),
  };

  // Step 7: esito consigliato = probabilità massima tra 1, X, 2.
  const outcomeEntries: Array<[MatchOutcome, number]> = [
    ['1', probabilities.home],
    ['X', probabilities.draw],
    ['2', probabilities.away],
  ];
  outcomeEntries.sort((a, b) => b[1] - a[1]);
  const suggestedOutcome = outcomeEntries[0][0];
  const topProbability = outcomeEntries[0][1];
  const secondProbability = outcomeEntries[1][1];

  // Step 8: suggerimento Over/Under 2.5 dai gol attesi totali.
  const expectedTotalGoals = roundTo(expectedGoalsHome + expectedGoalsAway, 2);
  const overUnder = {
    suggestion: (expectedTotalGoals >= 2.5 ? 'OVER_2_5' : 'UNDER_2_5') as Prediction['overUnder']['suggestion'],
    expectedTotalGoals,
  };

  // Step 9: confidenza = scarto tra la probabilità più alta e la seconda più alta,
  // scalato in 0-100 (uno scarto di 50 punti percentuali corrisponde a confidenza massima).
  // Se disponibile il mercato ed è concorde con il modello (stesso esito
  // suggerito), la confidenza riceve un piccolo bonus, perché l'accordo tra
  // due fonti indipendenti (modello statistico + consenso bookmaker) è un
  // segnale di maggiore affidabilità.
  let confidence = Math.min(100, ((topProbability - secondProbability) / 50) * 100);
  if (marketOdds) {
    const marketOutcomeEntries: Array<[MatchOutcome, number]> = [
      ['1', marketOdds.impliedProbabilities.home],
      ['X', marketOdds.impliedProbabilities.draw],
      ['2', marketOdds.impliedProbabilities.away],
    ];
    marketOutcomeEntries.sort((a, b) => b[1] - a[1]);
    const marketAgreesWithModel = marketOutcomeEntries[0][0] === suggestedOutcome;
    confidence = Math.min(100, confidence + (marketAgreesWithModel ? 8 : -8));
    confidence = Math.max(0, confidence);
  }
  confidence = roundTo(confidence, 1);

  // Step 10: quota stimata. Se disponibile la quota di mercato reale per
  // l'esito consigliato, viene usata direttamente quella (i bookmaker
  // riflettono il prezzo realmente offerto sul mercato, più affidabile di
  // una stima teorica); altrimenti si usa la quota "equa" calcolata dal
  // modello statistico (corretta dal margine bookmaker tipico).
  const modelOdds = Math.max(1.01, roundTo(100 / topProbability / BOOKMAKER_MARGIN, 2));
  let estimatedOdds = modelOdds;
  if (marketOdds) {
    const marketOddsForOutcome = { '1': marketOdds.averageOdds.home, X: marketOdds.averageOdds.draw, '2': marketOdds.averageOdds.away }[
      suggestedOutcome
    ];
    estimatedOdds = roundTo(marketOddsForOutcome, 2);
  }

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
      standings:
        homeStanding || awayStanding ? { home: homeStanding, away: awayStanding } : undefined,
      marketOdds,
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
      standingsFactor: roundTo(standingsFactor, 3),
      marketBlendWeight,
      modelProbabilitiesBeforeBlend,
    };
  }

  return prediction;
}

/**
 * Recupera dai provider (con cache) tutte le statistiche necessarie per una
 * partita — forma recente, scontri diretti, classifica e quote di mercato
 * reali (se configurate) — e calcola il pronostico completo.
 */
export async function getMatchPrediction(match: Match): Promise<Prediction> {
  const cacheKey = `prediction:${match.id}`;
  return getOrSetCache(cacheKey, env.cacheTtlPredictions, async () => {
    const league = findLeagueByCode(match.leagueCode);

    const [homeForm, awayForm, headToHead, standings, marketOdds] = await Promise.all([
      providerManager.getTeamForm(match.homeTeam.id, match.leagueCode),
      providerManager.getTeamForm(match.awayTeam.id, match.leagueCode),
      providerManager.getHeadToHead(match.homeTeam.id, match.awayTeam.id),
      league
        ? getOrSetCache(`standings:${league.code}`, env.cacheTtlStandings, () =>
            providerManager.getStandings(league)
          ).catch((err) => {
            logger.warn(`Impossibile recuperare la classifica per ${league.name}`, err);
            return [] as Standing[];
          })
        : Promise.resolve([] as Standing[]),
      league
        ? oddsProvider.getMatchOdds(league, match.homeTeam, match.awayTeam)
        : Promise.resolve(undefined),
    ]);

    const homeStanding = standings.find((s) => s.teamId === match.homeTeam.id);
    const awayStanding = standings.find((s) => s.teamId === match.awayTeam.id);

    return computePrediction({
      match,
      homeForm,
      awayForm,
      headToHead,
      homeStanding,
      awayStanding,
      leagueSize: standings.length || TYPICAL_LEAGUE_SIZE,
      marketOdds,
      includeDebug: !env.isProduction,
    });
  });
}
