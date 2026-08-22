/**
 * Motore di calcolo dei pronostici statistici — "ensemble avanzato".
 *
 * Approccio: modello di Poisson bivariato per stimare i gol attesi di
 * ciascuna squadra, combinato con aggiustamenti basati su forma recente,
 * scontri diretti e posizione in classifica, e infine "corretto" miscelando
 * le probabilità del modello con quelle implicite nelle quote reali dei
 * bookmaker (The Odds API, piano free). Il peso dato al mercato non è più
 * fisso: aumenta dinamicamente quando i bookmaker sono nettamente concordi
 * (es. 1.20 vs 5.60 → il mercato viene considerato molto più affidabile del
 * modello statistico da solo). Vedi `calculateMarketTrustWeight`.
 *
 * NOTA SULLA "AI": questo motore NON usa una rete neurale addestrata. Una
 * rete neurale richiederebbe uno storico di risultati reali con cui
 * addestrarsi, che questo progetto non persiste (nessun database dei
 * risultati passati). Costruire un modello "AI" senza dati di addestramento
 * reali produrrebbe pesi casuali travestiti da intelligenza artificiale:
 * scelta deliberata di NON farlo. Al suo posto, questo è un ensemble
 * deterministico e interamente spiegabile (ogni numero è tracciabile nei
 * `debugMetrics`), che integra più mercati bookmaker reali (1X2, Over/Under,
 * handicap asiatico) e deriva matematicamente i mercati non disponibili
 * gratuitamente (BTTS, doppia chance).
 *
 * Il modulo espone una funzione pura `computePrediction` (facilmente
 * testabile in isolamento, vedi tests/prediction.service.spec.ts) e una
 * funzione `getMatchPrediction` che recupera i dati necessari dai provider
 * e li passa al calcolo. Le funzioni `calculateMarketTrustWeight`,
 * `calculateConfidence` e `calculateFairOdds` sono estratte come helper
 * indipendenti e testabili singolarmente.
 *
 * Step dell'algoritmo (vedi commenti inline):
 *  1. Forza attacco/difesa di ciascuna squadra, normalizzata sulla media gol di lega.
 *  2. Punteggio "forma recente" pesato (le partite più recenti contano di più).
 *  3. Gol attesi (expected goals) per squadra, con fattore vantaggio-casa.
 *  4. Probabilità 1X2 tramite distribuzione di Poisson bivariata.
 *  5. Aggiustamento delle probabilità con forma recente, scontri diretti e
 *     differenza di posizione in classifica.
 *  6. Calcolo del "peso di fiducia" nel mercato (calculateMarketTrustWeight):
 *     più bookmaker aggregati e più il mercato è sbilanciato verso un esito,
 *     più il blend successivo pesa le quote reali rispetto al modello.
 *  7. Blend con le probabilità implicite nelle quote di mercato reali (1X2).
 *  8. Over/Under: probabilità dal modello di Poisson, "corretta" con il
 *     mercato "totals" reale se disponibile (stesso principio del blend 1X2).
 *  9. BTTS (Both Teams To Score): derivato matematicamente dal modello di
 *     Poisson (nessun mercato "btts" fetchabile gratuitamente).
 *  10. Doppia chance (1X, X2, 12): derivata sommando le probabilità 1X2 finali.
 *  11. Punteggio di confidenza (calculateConfidence): scarto tra le
 *      probabilità + bonus/malus in base all'accordo con il mercato, scalato
 *      dal peso di fiducia nel mercato stesso.
 *  12. Quota stimata (calculateFairOdds): la quota reale di mercato per
 *      l'esito consigliato se disponibile, altrimenti la quota "equa" del
 *      modello statistico corretta dal margine bookmaker tipico.
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
import { computeAllMarkets } from './markets.service';
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
/**
 * Peso BASE dato alle quote di mercato reali nel blend con il modello
 * statistico (usato quando il mercato è vicino all'equilibrio, es. 33/33/33).
 * Alzato rispetto alla versione precedente (era 0.4 fisso) perché i
 * bookmaker aggregano informazioni (infortuni, formazioni, meteo) che il
 * modello statistico non può conoscere: il mercato merita più fiducia di base.
 */
const MARKET_BLEND_WEIGHT_BASE = 0.5;
/**
 * Peso MASSIMO dato al mercato quando è fortemente sbilanciato verso un
 * singolo esito (es. 1.20 vs 5.60) e aggregato da molti bookmaker: in
 * questo scenario il mercato deve dominare il pronostico finale.
 */
const MARKET_BLEND_WEIGHT_MAX = 0.85;
/** Numero di bookmaker aggregati oltre il quale consideriamo il consenso di mercato "pienamente affidabile". */
const BOOKMAKER_COUNT_FOR_FULL_TRUST = 15;
/** Numero tipico di squadre in un campionato europeo, usato per normalizzare il fattore classifica. */
const TYPICAL_LEAGUE_SIZE = 20;
/** Linea Over/Under standard usata dal motore (il mercato "totals" più vicino a questo valore viene usato per il blend). */
const OU_LINE = 2.5;

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

/**
 * Calcola la probabilità Over/Under sulla linea data (default 2.5) a partire
 * dalla stessa griglia di Poisson bivariata usata per l'1X2: si somma la
 * probabilità congiunta di tutte le combinazioni di gol il cui totale supera
 * la linea. Più preciso della semplice euristica "gol attesi >= linea",
 * perché tiene conto della forma della distribuzione (non solo della media).
 */
function computeOverUnderProbabilities(
  expectedGoalsHome: number,
  expectedGoalsAway: number,
  line: number = OU_LINE
): { over: number; under: number } {
  let overProb = 0;
  let totalProb = 0;

  for (let homeGoals = 0; homeGoals <= MAX_GOALS; homeGoals++) {
    for (let awayGoals = 0; awayGoals <= MAX_GOALS; awayGoals++) {
      const jointProb =
        poissonProbability(expectedGoalsHome, homeGoals) * poissonProbability(expectedGoalsAway, awayGoals);
      totalProb += jointProb;
      if (homeGoals + awayGoals > line) overProb += jointProb;
    }
  }

  // Normalizza per compensare la probabilità residua troncata oltre MAX_GOALS.
  return { over: overProb / totalProb, under: 1 - overProb / totalProb };
}

/**
 * Calcola la probabilità di "Both Teams To Score" (BTTS) a partire dai gol
 * attesi, assumendo indipendenza tra i gol delle due squadre (stessa
 * semplificazione del modello 1X2). Nessun mercato "btts" è fetchabile
 * gratuitamente da The Odds API (rifiutato come mercato non valido), quindi
 * questa probabilità è interamente derivata dal modello statistico:
 *   P(BTTS=No)  = P(casa=0) + P(trasferta=0) - P(casa=0)*P(trasferta=0)
 *   P(BTTS=Sì)  = 1 - P(BTTS=No)
 * (probabilità dell'unione "nessuna delle due squadre segna" complementata).
 */
function computeBttsProbability(expectedGoalsHome: number, expectedGoalsAway: number): number {
  const probHomeNoGoals = Math.exp(-expectedGoalsHome);
  const probAwayNoGoals = Math.exp(-expectedGoalsAway);
  const probBttsNo = probHomeNoGoals + probAwayNoGoals - probHomeNoGoals * probAwayNoGoals;
  return 1 - probBttsNo;
}

/**
 * Calcola quanto il mercato bookmaker debba "pesare" nel blend con il
 * modello statistico, in [MARKET_BLEND_WEIGHT_BASE, MARKET_BLEND_WEIGHT_MAX].
 * Due fattori aumentano la fiducia nel mercato:
 *  - "skew": quanto il mercato è sbilanciato verso un singolo esito. Un
 *    mercato vicino all'equilibrio (33/33/33) è meno informativo di uno
 *    fortemente sbilanciato (es. 1.20 vs 5.60, skew vicino a 1): un
 *    grande favorito quotato è un segnale forte e va rispettato.
 *  - numero di bookmaker aggregati: più fonti indipendenti concordano, più
 *    il consenso è affidabile (meno rumore di un singolo bookmaker anomalo).
 * Questo implementa esplicitamente il requisito "le quote dei bookmaker
 * devono influenzare il modello in modo più forte, specialmente quando il
 * mercato è nettamente sbilanciato".
 */
export function calculateMarketTrustWeight(marketOdds?: MarketOdds): number {
  if (!marketOdds) return 0;

  const { home, draw, away } = marketOdds.impliedProbabilities;
  const maxImpliedProbability = Math.max(home, draw, away);
  // In un mercato 1X2 perfettamente equilibrato ogni esito avrebbe probabilità 1/3.
  // Normalizziamo lo scarto dal punto di equilibrio in [0, 1].
  const skew = Math.max(0, (maxImpliedProbability - 1 / 3) / (1 - 1 / 3));

  const bookmakerConfidence = Math.min(1, marketOdds.bookmakersCount / BOOKMAKER_COUNT_FOR_FULL_TRUST);

  const extraTrust = (MARKET_BLEND_WEIGHT_MAX - MARKET_BLEND_WEIGHT_BASE) * skew * bookmakerConfidence;
  return Math.min(MARKET_BLEND_WEIGHT_MAX, MARKET_BLEND_WEIGHT_BASE + extraTrust);
}

/**
 * Variante di `calculateMarketTrustWeight` per mercati binari (Over/Under),
 * dove il punto di equilibrio è 0.5 invece di 1/3 (come nel mercato
 * ternario 1X2).
 */
function calculateBinaryMarketTrustWeight(bookmakersCount: number, impliedProbabilityA: number): number {
  const skew = Math.abs(impliedProbabilityA - 0.5) / 0.5;
  const bookmakerConfidence = Math.min(1, bookmakersCount / BOOKMAKER_COUNT_FOR_FULL_TRUST);
  const extraTrust = (MARKET_BLEND_WEIGHT_MAX - MARKET_BLEND_WEIGHT_BASE) * skew * bookmakerConfidence;
  return Math.min(MARKET_BLEND_WEIGHT_MAX, MARKET_BLEND_WEIGHT_BASE + extraTrust);
}

/**
 * Calcola il punteggio di confidenza 0-100: parte dallo scarto tra la
 * probabilità dell'esito consigliato e la seconda più probabile (uno scarto
 * di 50 punti percentuali corrisponde a confidenza massima), poi applica un
 * bonus/malus se il mercato è disponibile e (dis)concorda con il modello.
 * Il bonus/malus scala con `marketTrustWeight`: un mercato molto sbilanciato
 * e aggregato da molti bookmaker che concorda (o meno) con il modello pesa
 * molto di più di un mercato vicino all'equilibrio.
 */
export function calculateConfidence(
  topProbability: number,
  secondProbability: number,
  marketOdds: MarketOdds | undefined,
  suggestedOutcome: MatchOutcome,
  marketTrustWeight: number
): number {
  let confidence = Math.min(100, ((topProbability - secondProbability) / 50) * 100);
  if (marketOdds) {
    const marketOutcomeEntries: Array<[MatchOutcome, number]> = [
      ['1', marketOdds.impliedProbabilities.home],
      ['X', marketOdds.impliedProbabilities.draw],
      ['2', marketOdds.impliedProbabilities.away],
    ];
    marketOutcomeEntries.sort((a, b) => b[1] - a[1]);
    const marketAgreesWithModel = marketOutcomeEntries[0][0] === suggestedOutcome;
    // Il bonus/malus varia tra 8 e 20 punti in base a quanto il mercato è
    // affidabile (marketTrustWeight in [MARKET_BLEND_WEIGHT_BASE, MARKET_BLEND_WEIGHT_MAX]).
    const agreementMagnitude = 8 + 12 * marketTrustWeight;
    confidence += marketAgreesWithModel ? agreementMagnitude : -agreementMagnitude;
    confidence = Math.max(0, Math.min(100, confidence));
  }
  return roundTo(confidence, 1);
}

/**
 * Calcola la quota stimata (decimal odds) per l'esito consigliato: se
 * disponibile la quota di mercato reale, viene usata direttamente (i
 * bookmaker riflettono il prezzo realmente offerto, più affidabile di una
 * stima teorica); altrimenti si usa la quota "equa" calcolata dal modello
 * statistico, corretta dal margine bookmaker tipico.
 */
export function calculateFairOdds(
  topProbability: number,
  marketOdds: MarketOdds | undefined,
  suggestedOutcome: MatchOutcome
): number {
  const modelOdds = Math.max(1.01, roundTo(100 / topProbability / BOOKMAKER_MARGIN, 2));
  if (!marketOdds) return modelOdds;
  const marketOddsForOutcome = {
    '1': marketOdds.averageOdds.home,
    X: marketOdds.averageOdds.draw,
    '2': marketOdds.averageOdds.away,
  }[suggestedOutcome];
  return roundTo(marketOddsForOutcome, 2);
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
  // NB: quando goalsScoredAvg/goalsConcededAvg sono 0 (nessuna partita
  // recente disponibile dal provider, es. rate-limit o squadra senza
  // storico), il fallback "|| 1" azzera l'informazione e riporta la
  // squadra a una forza neutra (uguale alla media di lega). Questo è
  // rilevato più sotto e segnalato tramite `dataQuality.insufficientData`
  // invece di essere nascosto, perché produce mercati derivati (PT/ST,
  // Parziale/Finale) identici tra partite diverse quando scatta per più
  // incontri.
  const homeAttackStrength = homeForm.goalsScoredAvg / LEAGUE_AVG_GOALS_PER_TEAM || 1;
  const homeDefenseStrength = homeForm.goalsConcededAvg / LEAGUE_AVG_GOALS_PER_TEAM || 1;
  const awayAttackStrength = awayForm.goalsScoredAvg / LEAGUE_AVG_GOALS_PER_TEAM || 1;
  const awayDefenseStrength = awayForm.goalsConcededAvg / LEAGUE_AVG_GOALS_PER_TEAM || 1;

  // Rilevamento "dati insufficienti": nessun risultato recente e/o media gol
  // nulla per una delle due squadre (il che fa scattare il fallback neutro
  // sopra). Segnaliamo il motivo specifico per trasparenza in UI.
  const insufficientDataReasons: string[] = [];
  if (homeForm.lastResults.length === 0) {
    insufficientDataReasons.push('Forma recente della squadra di casa non disponibile');
  }
  if (awayForm.lastResults.length === 0) {
    insufficientDataReasons.push('Forma recente della squadra in trasferta non disponibile');
  }
  if (!homeForm.goalsScoredAvg && !homeForm.goalsConcededAvg && homeForm.lastResults.length > 0) {
    insufficientDataReasons.push('Statistiche gol della squadra di casa non disponibili');
  }
  if (!awayForm.goalsScoredAvg && !awayForm.goalsConcededAvg && awayForm.lastResults.length > 0) {
    insufficientDataReasons.push('Statistiche gol della squadra in trasferta non disponibili');
  }
  const dataQuality = {
    insufficientData: insufficientDataReasons.length > 0,
    reasons: insufficientDataReasons,
  };

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

  // Step 6: calcola quanto fidarsi del mercato 1X2 in base a quanto è
  // sbilanciato verso un singolo esito e a quanti bookmaker lo confermano
  // (vedi calculateMarketTrustWeight). Con quote es. 1.20 vs 5.60 il peso
  // sale vicino al massimo: il mercato domina il blend successivo.
  const marketBlendWeight = calculateMarketTrustWeight(marketOdds);
  // Skew del MERCATO (non del modello): quanto le quote reali dei bookmaker
  // sono sbilanciate verso un singolo esito, usato solo a fini di debug per
  // spiegare perché marketBlendWeight ha un certo valore.
  const marketSkew = marketOdds
    ? Math.max(
        0,
        (Math.max(
          marketOdds.impliedProbabilities.home,
          marketOdds.impliedProbabilities.draw,
          marketOdds.impliedProbabilities.away
        ) -
          1 / 3) /
          (1 - 1 / 3)
      )
    : 0;

  // Step 7: blend con le probabilità di mercato reali (se disponibili da The
  // Odds API), con il peso dinamico calcolato allo step 6. Se il mercato non
  // è disponibile, il peso è 0 e il risultato resta invariato.
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

  // Esito consigliato = probabilità massima tra 1, X, 2.
  const outcomeEntries: Array<[MatchOutcome, number]> = [
    ['1', probabilities.home],
    ['X', probabilities.draw],
    ['2', probabilities.away],
  ];
  outcomeEntries.sort((a, b) => b[1] - a[1]);
  const suggestedOutcome = outcomeEntries[0][0];
  const topProbability = outcomeEntries[0][1];
  const secondProbability = outcomeEntries[1][1];

  // Step 8: Over/Under sulla linea OU_LINE (default 2.5). Probabilità dal
  // modello di Poisson, poi "corretta" con il mercato "totals" reale se
  // disponibile (stesso principio di blend dinamico dello step 6-7, ma
  // applicato al mercato binario Over/Under invece che al ternario 1X2).
  const expectedTotalGoals = roundTo(expectedGoalsHome + expectedGoalsAway, 2);
  const modelOverUnderProbability = computeOverUnderProbabilities(expectedGoalsHome, expectedGoalsAway, OU_LINE);
  let overProbability = modelOverUnderProbability.over;
  if (marketOdds?.totals && Math.abs(marketOdds.totals.line - OU_LINE) <= 0.5) {
    const totalsBlendWeight = calculateBinaryMarketTrustWeight(
      marketOdds.totals.bookmakersCount,
      marketOdds.totals.impliedProbabilities.over
    );
    overProbability =
      overProbability * (1 - totalsBlendWeight) +
      marketOdds.totals.impliedProbabilities.over * totalsBlendWeight;
  }
  const underProbability = 1 - overProbability;
  const overUnder = {
    suggestion: (overProbability >= 0.5 ? 'OVER_2_5' : 'UNDER_2_5') as Prediction['overUnder']['suggestion'],
    expectedTotalGoals,
    probabilityOver: roundTo(overProbability * 100, 1),
    probabilityUnder: roundTo(underProbability * 100, 1),
  };

  // Step 9: BTTS (Both Teams To Score), derivato matematicamente dal modello
  // di Poisson (nessun mercato "btts" fetchabile gratuitamente, vedi
  // odds.provider.ts). Nessun blend di mercato possibile per questo esito.
  const bttsYesProbability = computeBttsProbability(expectedGoalsHome, expectedGoalsAway);
  const bothTeamsToScore = {
    suggestion: (bttsYesProbability >= 0.5 ? 'YES' : 'NO') as Prediction['bothTeamsToScore']['suggestion'],
    probabilityYes: roundTo(bttsYesProbability * 100, 1),
    probabilityNo: roundTo((1 - bttsYesProbability) * 100, 1),
  };

  // Step 10: doppia chance (1X, X2, 12), derivata sommando le probabilità
  // 1X2 finali corrispondenti (derivazione aritmetica esatta, nessun
  // mercato dedicato disponibile gratuitamente).
  const doubleChance = {
    oneOrDraw: roundTo(probabilities.home + probabilities.draw, 1),
    drawOrTwo: roundTo(probabilities.draw + probabilities.away, 1),
    oneOrTwo: roundTo(probabilities.home + probabilities.away, 1),
  };

  // Step 11: confidenza. Vedi calculateConfidence: scarto tra probabilità +
  // bonus/malus di accordo col mercato, scalato dal peso di fiducia nel
  // mercato stesso (marketBlendWeight), così che un mercato molto
  // sbilanciato e concorde pesi molto di più di uno vicino all'equilibrio.
  const confidence = calculateConfidence(
    topProbability,
    secondProbability,
    marketOdds,
    suggestedOutcome,
    marketBlendWeight
  );

  // Step 12: quota stimata. Vedi calculateFairOdds: la quota reale di
  // mercato per l'esito consigliato se disponibile, altrimenti la quota
  // "equa" del modello statistico corretta dal margine bookmaker tipico.
  const estimatedOdds = calculateFairOdds(topProbability, marketOdds, suggestedOutcome);

  // Step 13: calcola tutti i mercati aggiuntivi (1T/2T, parziale/finale,
  // Under/Over multi-linea, multigol, somma gol esatta, combo) a partire
  // dagli stessi gol attesi e dalle stesse probabilità finali già calcolate
  // sopra, ed evidenzia il pronostico complessivamente più probabile e
  // sicuro tra tutti i mercati (vedi markets.service.ts).
  const { markets, bestPick } = computeAllMarkets({
    expectedGoalsHome,
    expectedGoalsAway,
    finalProbabilities: probabilities,
    finalDoubleChance: {
      oneOrDraw: doubleChance.oneOrDraw,
      drawOrTwo: doubleChance.drawOrTwo,
      oneOrTwo: doubleChance.oneOrTwo,
    },
    finalBtts: { yes: bothTeamsToScore.probabilityYes, no: bothTeamsToScore.probabilityNo },
    mainEstimatedOdds: estimatedOdds,
    mainConfidence: confidence,
    insufficientData: dataQuality.insufficientData,
  });

  const prediction: Prediction = {
    matchId: match.id,
    probabilities,
    suggestedOutcome,
    overUnder,
    doubleChance,
    bothTeamsToScore,
    confidence,
    estimatedOdds,
    markets,
    bestPick,
    dataQuality,
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
      marketBlendWeight: roundTo(marketBlendWeight, 3),
      marketSkew: roundTo(marketSkew, 3),
      modelProbabilitiesBeforeBlend,
      overUnderModelProbability: {
        over: roundTo(modelOverUnderProbability.over * 100, 1),
        under: roundTo(modelOverUnderProbability.under * 100, 1),
      },
    };
  }

  return prediction;
}

/** Alias esplicito richiesto per chiarezza del nome della funzione principale del motore. */
export const calculatePrediction = computePrediction;

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
