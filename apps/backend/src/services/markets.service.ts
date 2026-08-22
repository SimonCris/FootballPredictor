/**
 * Motore di calcolo dei mercati "estesi" (oltre a 1X2/Over-Under/BTTS/doppia
 * chance già calcolati in prediction.service.ts).
 *
 * Tutti i mercati qui calcolati derivano dalla STESSA distribuzione di
 * Poisson bivariata (gol attesi casa/trasferta) già usata per l'1X2 e
 * l'Over/Under principali, cosicché ogni mercato sia coerente con le
 * statistiche raccolte (forma, scontri diretti, classifica, quote di
 * mercato) invece di essere una stima indipendente e scollegata.
 *
 * Mercati coperti (vedi `computeAllMarkets`):
 *  - Esito 1X2, doppia chance (riportati per uniformità, già calcolati altrove)
 *  - Esito primo tempo / secondo tempo (Poisson sui gol attesi di ciascun tempo,
 *    stimati come frazione dei gol attesi sull'intera partita)
 *  - Parziale/Finale (le 9 combinazioni PT/FT, joint probability assumendo
 *    indipendenza tra i gol segnati nel primo e nel secondo tempo)
 *  - Under/Over su più linee (0.5, 1.5, 2.5, 3.5)
 *  - Gol/No Gol (BTTS, riportato per uniformità)
 *  - Multigol (intervalli di gol totali)
 *  - Squadra segna (casa/trasferta, probabilità di segnare almeno un gol)
 *  - Somma gol esatta (0,1,2,3,4,5,6+)
 *  - Combo: 1X2+O/U, esito+GG, doppia chance+GG, multigol+esito — calcolate
 *    come probabilità congiunta ESATTA sulla griglia di Poisson (non come
 *    semplice prodotto delle probabilità marginali, per correttezza
 *    statistica: i due eventi non sono indipendenti).
 *
 * Infine `pickBestOverall` sceglie, tra tutte le candidate di tutti i
 * mercati, quella più probabile, sicura E "spendibile": la "sicurezza" è
 * misurata come margine (spread) tra la probabilità della scelta migliore
 * e quella della seconda opzione più probabile dello stesso mercato (stessa
 * logica già usata per `calculateConfidence` in prediction.service.ts), poi
 * si combina con la probabilità assoluta e con un fattore di "appetibilità
 * della quota" (vedi `oddsAttractiveness`) che penalizza gli esiti banali e
 * scontati (quota vicina a 1.00, es. "la squadra di casa segna"), privi di
 * reale valore per chi scommette, così da preferire un pronostico realistico
 * ma con un ritorno potenziale dignitoso (es. doppia chance, over/under,
 * combo 1X2+gol).
 */
import { MatchOutcome, PredictionMarkets, BestPick, MarketPick } from '../types/domain';
import { roundTo } from '../utils/normalize';

/** Margine bookmaker tipico, usato per calcolare quote "eque" stimate per i mercati senza quota reale. */
const BOOKMAKER_MARGIN = 1.07;
/** Numero massimo di gol per squadra considerato nelle griglie di Poisson sull'intera partita. */
const MAX_GOALS = 6;
/** Numero massimo di gol per squadra considerato nelle griglie di Poisson per singolo tempo (PT/ST). */
const MAX_GOALS_HALF = 4;
/**
 * Quota di gol attesi totali segnata mediamente nel primo tempo nei campionati
 * europei (dato osservazionale diffuso: il secondo tempo produce leggermente
 * più gol del primo, es. ~45%/55%).
 */
const FIRST_HALF_GOAL_SHARE = 0.45;
/** Linee Over/Under mostrate nel mercato "Under/Over multi-linea". */
const OU_LINES = [0.5, 1.5, 2.5, 3.5];
/** Intervalli standard del mercato Multigol. */
const MULTIGOAL_RANGES: Array<{ label: string; min: number; max: number }> = [
  { label: '0-1', min: 0, max: 1 },
  { label: '1-2', min: 1, max: 2 },
  { label: '1-3', min: 1, max: 3 },
  { label: '2-3', min: 2, max: 3 },
  { label: '2-4', min: 2, max: 4 },
  { label: '2-5', min: 2, max: 5 },
  { label: '3-6', min: 3, max: 6 },
];

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function poissonProbability(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/** Distribuzione di Poisson normalizzata (somma a 1) sui valori 0..maxGoals. */
function poissonDistribution(lambda: number, maxGoals: number): number[] {
  const probs: number[] = [];
  for (let k = 0; k <= maxGoals; k++) probs.push(poissonProbability(lambda, k));
  const total = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / total);
}

function outcomeOf(homeGoals: number, awayGoals: number): MatchOutcome {
  if (homeGoals > awayGoals) return '1';
  if (homeGoals === awayGoals) return 'X';
  return '2';
}

const OUTCOME_LABELS: Record<MatchOutcome, string> = {
  '1': '1 (Vittoria Casa)',
  X: 'X (Pareggio)',
  '2': '2 (Vittoria Trasferta)',
};

/** Cella della griglia congiunta di Poisson (gol casa/trasferta, con probabilità normalizzata). */
interface GridCell {
  home: number;
  away: number;
  prob: number;
}

/** Costruisce la griglia congiunta di Poisson (gol casa x gol trasferta) sull'intera partita, normalizzata a 1. */
function buildScoreGrid(expectedGoalsHome: number, expectedGoalsAway: number): GridCell[] {
  const cells: GridCell[] = [];
  let total = 0;
  for (let home = 0; home <= MAX_GOALS; home++) {
    for (let away = 0; away <= MAX_GOALS; away++) {
      const prob = poissonProbability(expectedGoalsHome, home) * poissonProbability(expectedGoalsAway, away);
      cells.push({ home, away, prob });
      total += prob;
    }
  }
  return cells.map((cell) => ({ ...cell, prob: cell.prob / total }));
}

/** Calcola le probabilità 1X2 (percentuale 0-100) a partire dalla griglia di Poisson di un singolo periodo. */
function periodOutcomeProbabilities(expectedGoalsHome: number, expectedGoalsAway: number) {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h <= MAX_GOALS_HALF; h++) {
    for (let a = 0; a <= MAX_GOALS_HALF; a++) {
      const prob = poissonProbability(expectedGoalsHome, h) * poissonProbability(expectedGoalsAway, a);
      const outcome = outcomeOf(h, a);
      if (outcome === '1') home += prob;
      else if (outcome === 'X') draw += prob;
      else away += prob;
    }
  }
  const total = home + draw + away;
  return { home: (home / total) * 100, draw: (draw / total) * 100, away: (away / total) * 100 };
}

/** Costruisce un `MarketPick` scegliendo l'esito con probabilità massima tra un set di { outcome, label, probability }. */
function bestOf(candidates: MarketPick[]): MarketPick {
  return [...candidates].sort((a, b) => b.probability - a.probability)[0];
}

/** Mercato Esito 1X2/PT/ST a partire da probabilità già calcolate (percentuale 0-100). */
function build1x2Market(probabilities: { home: number; draw: number; away: number }) {
  const candidates: MarketPick[] = [
    { outcome: '1', label: OUTCOME_LABELS['1'], probability: roundTo(probabilities.home, 1) },
    { outcome: 'X', label: OUTCOME_LABELS['X'], probability: roundTo(probabilities.draw, 1) },
    { outcome: '2', label: OUTCOME_LABELS['2'], probability: roundTo(probabilities.away, 1) },
  ];
  return { probabilities, pick: bestOf(candidates) };
}

/**
 * Calcola lo "spread di confidenza" 0-100 tra la probabilità della scelta
 * migliore e quella della seconda: uno scarto di 50 punti percentuali
 * corrisponde a confidenza massima (stessa scala di `calculateConfidence`
 * in prediction.service.ts, per coerenza tra mercati).
 */
function spreadConfidence(sortedProbabilities: number[]): number {
  if (sortedProbabilities.length < 2) return 100;
  const [top, second] = sortedProbabilities;
  return roundTo(Math.max(0, Math.min(100, ((top - second) / 50) * 100)), 1);
}

/** Quota "equa" stimata (nessuna quota reale di mercato disponibile per questi mercati secondari). */
function fairOdds(probabilityPercent: number): number {
  return Math.max(1.01, roundTo(100 / probabilityPercent / BOOKMAKER_MARGIN, 2));
}

/** Quota a partire dalla quale un pronostico è considerato pienamente "spendibile" (rendimento dignitoso). */
const MIN_ATTRACTIVE_ODDS = 1.8;
/** Esponente della curva di appetibilità: valori > 1 penalizzano più severamente le quote vicine a 1.00. */
const ODDS_ATTRACTIVENESS_EXPONENT = 2;

/**
 * Calcola un fattore 0-1 che rappresenta quanto una quota è "spendibile" per
 * chi scommette: 0 per quote vicine a 1.00 (esito banale, nessun ritorno
 * reale), 1 per quote >= MIN_ATTRACTIVE_ODDS. La curva quadratica penalizza
 * più severamente le quote molto basse rispetto a una semplice interpolazione
 * lineare, così da scoraggiare esiti scontati come "la squadra di casa segna".
 */
function oddsAttractiveness(odds: number): number {
  if (odds <= 1) return 0;
  if (odds >= MIN_ATTRACTIVE_ODDS) return 1;
  const progress = (odds - 1) / (MIN_ATTRACTIVE_ODDS - 1);
  return Math.pow(progress, ODDS_ATTRACTIVENESS_EXPONENT);
}

/**
 * Quando i dati di forma recente non sono disponibili per una o entrambe le
 * squadre (`dataQuality.insufficientData`), i mercati derivati dal solo
 * split PT/ST (Esito primo tempo, Esito secondo tempo) si basano su una
 * stima ancora più grezza (frazione fissa dei gol attesi sull'intera
 * partita) e vanno quindi penalizzati con una confidenza ridotta, per non
 * farli apparire più affidabili di quanto siano realmente.
 */
const INSUFFICIENT_DATA_CONFIDENCE_FACTOR = 0.6;

export interface AllMarketsInput {
  /** Gol attesi (Poisson) per l'intera partita, già calcolati dal motore principale. */
  expectedGoalsHome: number;
  expectedGoalsAway: number;
  /** Probabilità 1X2 finali (già "blendate" con eventuali quote di mercato reali), percentuale 0-100. */
  finalProbabilities: { home: number; draw: number; away: number };
  /** Doppia chance finale, percentuale 0-100 (già derivata altrove). */
  finalDoubleChance: { oneOrDraw: number; drawOrTwo: number; oneOrTwo: number };
  /** BTTS finale, percentuale 0-100 (già derivato altrove). */
  finalBtts: { yes: number; no: number };
  /** Quota stimata per l'esito 1X2 principale (quota reale di mercato se disponibile, altrimenti quota modello). */
  mainEstimatedOdds: number;
  /** Confidenza già calcolata per l'esito 1X2 principale (0-100). */
  mainConfidence: number;
  /**
   * True quando la forma recente non è disponibile per una o entrambe le
   * squadre (vedi `dataQuality.insufficientData` in prediction.service.ts):
   * in questo caso la confidenza dei mercati Esito primo/secondo tempo viene
   * ridotta (vedi `INSUFFICIENT_DATA_CONFIDENCE_FACTOR`), dato che si basano
   * su una stima ancora più grezza dei gol attesi.
   */
  insufficientData?: boolean;
}

/**
 * Calcola tutti i mercati aggiuntivi e sceglie il pronostico complessivo più
 * probabile e sicuro tra tutti quelli disponibili (incluso l'1X2 principale).
 */
export function computeAllMarkets({
  expectedGoalsHome,
  expectedGoalsAway,
  finalProbabilities,
  finalDoubleChance,
  finalBtts,
  mainEstimatedOdds,
  mainConfidence,
  insufficientData = false,
}: AllMarketsInput): { markets: PredictionMarkets; bestPick: BestPick } {
  // --- Esito 1X2 (riportato per uniformità, già calcolato dal motore principale) ---
  const matchResult1x2 = build1x2Market(finalProbabilities);

  // --- Doppia chance (riportata per uniformità) ---
  const doubleChanceCandidates: MarketPick[] = [
    { outcome: '1X', label: 'Doppia chance 1X', probability: finalDoubleChance.oneOrDraw },
    { outcome: 'X2', label: 'Doppia chance X2', probability: finalDoubleChance.drawOrTwo },
    { outcome: '12', label: 'Doppia chance 12', probability: finalDoubleChance.oneOrTwo },
  ];
  const doubleChance = { ...finalDoubleChance, pick: bestOf(doubleChanceCandidates) };

  // --- Esito primo tempo / secondo tempo ---
  // I gol attesi dell'intera partita vengono ripartiti tra i due tempi in
  // base alla quota statistica osservata (45% PT / 55% ST). Non abbiamo un
  // mercato bookmaker gratuito per PT/ST, quindi questi mercati sono
  // interamente derivati dal modello di Poisson.
  const expectedGoalsHalfTimeHome = expectedGoalsHome * FIRST_HALF_GOAL_SHARE;
  const expectedGoalsHalfTimeAway = expectedGoalsAway * FIRST_HALF_GOAL_SHARE;
  const expectedGoalsSecondHalfHome = expectedGoalsHome * (1 - FIRST_HALF_GOAL_SHARE);
  const expectedGoalsSecondHalfAway = expectedGoalsAway * (1 - FIRST_HALF_GOAL_SHARE);

  const halfTimeProbabilities = periodOutcomeProbabilities(expectedGoalsHalfTimeHome, expectedGoalsHalfTimeAway);
  const secondHalfProbabilities = periodOutcomeProbabilities(
    expectedGoalsSecondHalfHome,
    expectedGoalsSecondHalfAway
  );
  const halfTimeResult = build1x2Market(halfTimeProbabilities);
  const secondHalfResult = build1x2Market(secondHalfProbabilities);

  // --- Parziale/Finale (9 combinazioni PT/FT) ---
  // Calcolato come probabilità congiunta esatta assumendo indipendenza tra i
  // gol segnati nel primo e nel secondo tempo (stessa assunzione di
  // indipendenza già usata per i gol casa/trasferta nel modello 1X2).
  const halfTimeFullTime = computeHalfTimeFullTime(
    expectedGoalsHalfTimeHome,
    expectedGoalsHalfTimeAway,
    expectedGoalsSecondHalfHome,
    expectedGoalsSecondHalfAway
  );

  // --- Griglia di Poisson sull'intera partita, riusata per Over/Under multi-linea,
  // multigol, somma gol esatta e tutti i mercati combo (calcolo esatto, non approssimato). ---
  const grid = buildScoreGrid(expectedGoalsHome, expectedGoalsAway);

  // --- Under/Over su più linee ---
  const overUnderLines = OU_LINES.map((line) => {
    const over = grid.filter((cell) => cell.home + cell.away > line).reduce((sum, c) => sum + c.prob, 0);
    return { line, over: roundTo(over * 100, 1), under: roundTo((1 - over) * 100, 1) };
  });
  const overUnderCandidates: MarketPick[] = overUnderLines.flatMap((entry) => [
    { outcome: `OVER_${entry.line}`, label: `Over ${entry.line}`, probability: entry.over },
    { outcome: `UNDER_${entry.line}`, label: `Under ${entry.line}`, probability: entry.under },
  ]);
  const overUnder = { lines: overUnderLines, pick: bestOf(overUnderCandidates) };

  // --- Gol/No Gol (BTTS, riportato per uniformità) ---
  const bttsCandidates: MarketPick[] = [
    { outcome: 'GG', label: 'Gol (entrambe segnano)', probability: finalBtts.yes },
    { outcome: 'NG', label: 'No Gol', probability: finalBtts.no },
  ];
  const bothTeamsToScore = { ...finalBtts, pick: bestOf(bttsCandidates) };

  // --- Multigol ---
  const multigoalRanges = MULTIGOAL_RANGES.map((range) => {
    const probability = grid
      .filter((cell) => cell.home + cell.away >= range.min && cell.home + cell.away <= range.max)
      .reduce((sum, c) => sum + c.prob, 0);
    return { ...range, probability: roundTo(probability * 100, 1) };
  });
  const multigoalPick = [...multigoalRanges].sort((a, b) => b.probability - a.probability)[0];
  const multigoal = { ranges: multigoalRanges, pick: multigoalPick };

  // --- Squadra segna ---
  const homeScoresYes = roundTo((1 - Math.exp(-expectedGoalsHome)) * 100, 1);
  const awayScoresYes = roundTo((1 - Math.exp(-expectedGoalsAway)) * 100, 1);
  const teamToScore = {
    home: { outcome: 'HOME_SCORES', label: 'La squadra di casa segna', probability: homeScoresYes },
    away: { outcome: 'AWAY_SCORES', label: 'La squadra in trasferta segna', probability: awayScoresYes },
  };

  // --- Somma gol esatta ---
  const totalGoalsDistribution: number[] = new Array(2 * MAX_GOALS + 1).fill(0);
  grid.forEach((cell) => {
    totalGoalsDistribution[cell.home + cell.away] += cell.prob;
  });
  const exactGoalsEntries = [0, 1, 2, 3, 4, 5].map((goals) => ({
    goals,
    label: String(goals),
    probability: roundTo(totalGoalsDistribution[goals] * 100, 1),
  }));
  const sixOrMoreProbability = totalGoalsDistribution.slice(6).reduce((a, b) => a + b, 0);
  exactGoalsEntries.push({ goals: 6, label: '6+', probability: roundTo(sixOrMoreProbability * 100, 1) });
  const exactGoalsPick = [...exactGoalsEntries].sort((a, b) => b.probability - a.probability)[0];
  const exactTotalGoals = { entries: exactGoalsEntries, pick: exactGoalsPick };

  // --- Combo: 1X2 + Under/Over 2.5 ---
  const resultAndOverUnderCombos = (['1', 'X', '2'] as MatchOutcome[]).flatMap((outcome) =>
    ['over', 'under'].map((direction) => {
      const probability = grid
        .filter((cell) => {
          const matchesOutcome = outcomeOf(cell.home, cell.away) === outcome;
          const isOver = cell.home + cell.away > 2.5;
          return matchesOutcome && (direction === 'over' ? isOver : !isOver);
        })
        .reduce((sum, c) => sum + c.prob, 0);
      return {
        label: `${outcome} + ${direction === 'over' ? 'Over' : 'Under'} 2.5`,
        probability: roundTo(probability * 100, 1),
      };
    })
  );
  const resultAndOverUnder = [...resultAndOverUnderCombos].sort((a, b) => b.probability - a.probability)[0];

  // --- Combo: Esito + Gol/NoGol ---
  const resultAndBttsCombos = (['1', 'X', '2'] as MatchOutcome[]).flatMap((outcome) =>
    ['GG', 'NG'].map((gg) => {
      const probability = grid
        .filter((cell) => {
          const matchesOutcome = outcomeOf(cell.home, cell.away) === outcome;
          const bttsYes = cell.home > 0 && cell.away > 0;
          return matchesOutcome && (gg === 'GG' ? bttsYes : !bttsYes);
        })
        .reduce((sum, c) => sum + c.prob, 0);
      return { label: `${outcome} + ${gg}`, probability: roundTo(probability * 100, 1) };
    })
  );
  const resultAndBtts = [...resultAndBttsCombos].sort((a, b) => b.probability - a.probability)[0];

  // --- Combo: Doppia chance + Gol/NoGol ---
  const doubleChanceMatchers: Record<string, (cell: GridCell) => boolean> = {
    '1X': (cell) => cell.home >= cell.away,
    X2: (cell) => cell.home <= cell.away,
    '12': (cell) => cell.home !== cell.away,
  };
  const doubleChanceAndBttsCombos = Object.keys(doubleChanceMatchers).flatMap((dc) =>
    ['GG', 'NG'].map((gg) => {
      const probability = grid
        .filter((cell) => {
          const matchesDc = doubleChanceMatchers[dc](cell);
          const bttsYes = cell.home > 0 && cell.away > 0;
          return matchesDc && (gg === 'GG' ? bttsYes : !bttsYes);
        })
        .reduce((sum, c) => sum + c.prob, 0);
      return { label: `${dc} + ${gg}`, probability: roundTo(probability * 100, 1) };
    })
  );
  const doubleChanceAndBtts = [...doubleChanceAndBttsCombos].sort((a, b) => b.probability - a.probability)[0];

  // --- Combo: Multigol + esito ---
  // Usa l'intervallo multigol più probabile (calcolato sopra) combinato con
  // ciascun esito 1X2, per evidenziare la combinazione più probabile.
  const multigoalAndResultCombos = (['1', 'X', '2'] as MatchOutcome[]).map((outcome) => {
    const probability = grid
      .filter((cell) => {
        const total = cell.home + cell.away;
        return (
          outcomeOf(cell.home, cell.away) === outcome && total >= multigoalPick.min && total <= multigoalPick.max
        );
      })
      .reduce((sum, c) => sum + c.prob, 0);
    return { label: `${outcome} + Multigol ${multigoalPick.label}`, probability: roundTo(probability * 100, 1) };
  });
  const multigoalAndResult = [...multigoalAndResultCombos].sort((a, b) => b.probability - a.probability)[0];

  const markets: PredictionMarkets = {
    matchResult1x2,
    doubleChance,
    halfTimeResult,
    secondHalfResult,
    halfTimeFullTime,
    overUnder,
    bothTeamsToScore,
    multigoal,
    teamToScore,
    exactTotalGoals,
    combos: {
      resultAndOverUnder,
      resultAndBtts,
      doubleChanceAndBtts,
      multigoalAndResult,
    },
  };

  const bestPick = pickBestOverall(markets, mainEstimatedOdds, mainConfidence, insufficientData);

  return { markets, bestPick };
}

/**
 * Calcola il mercato Parziale/Finale: le 9 combinazioni possibili tra esito
 * al primo tempo ed esito al finale, come probabilità congiunta esatta
 * (assumendo indipendenza tra i gol del primo e del secondo tempo).
 */
function computeHalfTimeFullTime(
  expectedGoalsHalfTimeHome: number,
  expectedGoalsHalfTimeAway: number,
  expectedGoalsSecondHalfHome: number,
  expectedGoalsSecondHalfAway: number
) {
  const halfTimeHomeDist = poissonDistribution(expectedGoalsHalfTimeHome, MAX_GOALS_HALF);
  const halfTimeAwayDist = poissonDistribution(expectedGoalsHalfTimeAway, MAX_GOALS_HALF);
  const secondHalfHomeDist = poissonDistribution(expectedGoalsSecondHalfHome, MAX_GOALS_HALF);
  const secondHalfAwayDist = poissonDistribution(expectedGoalsSecondHalfAway, MAX_GOALS_HALF);

  const buckets: Record<string, number> = {};
  for (let ih = 0; ih <= MAX_GOALS_HALF; ih++) {
    for (let ia = 0; ia <= MAX_GOALS_HALF; ia++) {
      const halfTimeProb = halfTimeHomeDist[ih] * halfTimeAwayDist[ia];
      if (halfTimeProb < 1e-9) continue; // ottimizzazione: salta combinazioni trascurabili
      const halfResult = outcomeOf(ih, ia);
      for (let sh = 0; sh <= MAX_GOALS_HALF; sh++) {
        for (let sa = 0; sa <= MAX_GOALS_HALF; sa++) {
          const jointProb = halfTimeProb * secondHalfHomeDist[sh] * secondHalfAwayDist[sa];
          const fullResult = outcomeOf(ih + sh, ia + sa);
          const key = `${halfResult}/${fullResult}`;
          buckets[key] = (buckets[key] ?? 0) + jointProb;
        }
      }
    }
  }

  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  const entries = Object.entries(buckets)
    .map(([key, prob]) => {
      const [half, full] = key.split('/') as [MatchOutcome, MatchOutcome];
      return { half, full, label: `${half}/${full}`, probability: roundTo((prob / total) * 100, 1) };
    })
    .sort((a, b) => b.probability - a.probability);

  return { entries, pick: entries[0] };
}

/**
 * Sceglie, tra tutte le candidate di tutti i mercati calcolati, il
 * pronostico complessivamente più probabile, sicuro e "spendibile" (quota
 * dignitosa): per ogni mercato si calcola uno "score" = probabilità
 * assoluta × confidenza (spread rispetto alla seconda opzione più probabile
 * dello stesso mercato, in [0,1]) × appetibilità della quota (0 per quote
 * vicine a 1.00, 1 per quote >= MIN_ATTRACTIVE_ODDS), così da non premiare
 * né mercati con probabilità bassa solo perché nettamente la più alta tra
 * opzioni comunque improbabili (es. 9 vie di Parziale/Finale), né esiti
 * banali e scontati che pur sicurissimi non offrono alcun ritorno reale
 * (es. "squadra segna" a quota 1.01).
 */
function pickBestOverall(
  markets: PredictionMarkets,
  mainEstimatedOdds: number,
  mainConfidence: number,
  insufficientData: boolean
): BestPick {
  interface Candidate {
    marketKey: string;
    marketLabel: string;
    outcomeLabel: string;
    probability: number;
    confidence: number;
    /** Quota stimata (o reale, per l'1X2) associata a questo pronostico. */
    odds: number;
  }

  const candidates: Candidate[] = [];

  candidates.push({
    marketKey: 'matchResult1x2',
    marketLabel: 'Esito 1X2',
    outcomeLabel: markets.matchResult1x2.pick.label,
    probability: markets.matchResult1x2.pick.probability,
    confidence: mainConfidence,
    odds: mainEstimatedOdds,
  });

  candidates.push({
    marketKey: 'doubleChance',
    marketLabel: 'Doppia chance',
    outcomeLabel: markets.doubleChance.pick.label,
    probability: markets.doubleChance.pick.probability,
    // Le tre opzioni di doppia chance (1X/X2/12) non sono alternative
    // mutuamente esclusive: si sovrappongono sempre a coppie (es. 1X e 12
    // condividono l'esito "1"), quindi confrontare la scelta migliore con
    // la seconda migliore tra le tre sottostimerebbe sistematicamente la
    // confidenza (le due opzioni che includono l'esito più probabile sono
    // quasi sempre entrambe alte). Usiamo invece il complementare (100 -
    // probabilità), stessa logica già usata per i mercati binari (Gol/No
    // Gol, Squadra segna), per un confronto coerente tra tutti i mercati.
    confidence: spreadConfidence([markets.doubleChance.pick.probability, 100 - markets.doubleChance.pick.probability]),
    odds: fairOdds(markets.doubleChance.pick.probability),
  });

  // Esito primo/secondo tempo: quando la forma recente non è disponibile
  // (`insufficientData`), questi due mercati si basano su una stima ancora
  // più grezza dei gol attesi (frazione fissa dell'intera partita), quindi
  // la loro confidenza viene ridotta per non farli apparire più affidabili
  // di quanto siano realmente.
  const halfConfidenceFactor = insufficientData ? INSUFFICIENT_DATA_CONFIDENCE_FACTOR : 1;

  candidates.push({
    marketKey: 'halfTimeResult',
    marketLabel: 'Esito primo tempo',
    outcomeLabel: markets.halfTimeResult.pick.label,
    probability: markets.halfTimeResult.pick.probability,
    confidence:
      spreadConfidence(Object.values(markets.halfTimeResult.probabilities).sort((a, b) => b - a)) *
      halfConfidenceFactor,
    odds: fairOdds(markets.halfTimeResult.pick.probability),
  });

  candidates.push({
    marketKey: 'secondHalfResult',
    marketLabel: 'Esito secondo tempo',
    outcomeLabel: markets.secondHalfResult.pick.label,
    probability: markets.secondHalfResult.pick.probability,
    confidence:
      spreadConfidence(Object.values(markets.secondHalfResult.probabilities).sort((a, b) => b - a)) *
      halfConfidenceFactor,
    odds: fairOdds(markets.secondHalfResult.pick.probability),
  });

  const htftSorted = markets.halfTimeFullTime.entries.map((e) => e.probability);
  candidates.push({
    marketKey: 'halfTimeFullTime',
    marketLabel: 'Parziale/Finale',
    outcomeLabel: markets.halfTimeFullTime.pick.label,
    probability: markets.halfTimeFullTime.pick.probability,
    confidence: spreadConfidence(htftSorted),
    odds: fairOdds(markets.halfTimeFullTime.pick.probability),
  });

  const bestOuLine = markets.overUnder.lines
    .flatMap((l) => [l.over, l.under])
    .sort((a, b) => b - a);
  candidates.push({
    marketKey: 'overUnder',
    marketLabel: 'Under/Over',
    outcomeLabel: markets.overUnder.pick.label,
    probability: markets.overUnder.pick.probability,
    confidence: spreadConfidence(bestOuLine),
    odds: fairOdds(markets.overUnder.pick.probability),
  });

  candidates.push({
    marketKey: 'bothTeamsToScore',
    marketLabel: 'Gol/No Gol',
    outcomeLabel: markets.bothTeamsToScore.pick.label,
    probability: markets.bothTeamsToScore.pick.probability,
    confidence: spreadConfidence([markets.bothTeamsToScore.yes, markets.bothTeamsToScore.no].sort((a, b) => b - a)),
    odds: fairOdds(markets.bothTeamsToScore.pick.probability),
  });

  const multigoalSorted = markets.multigoal.ranges.map((r) => r.probability).sort((a, b) => b - a);
  candidates.push({
    marketKey: 'multigoal',
    marketLabel: 'Multigol',
    outcomeLabel: `Multigol ${markets.multigoal.pick.label}`,
    probability: markets.multigoal.pick.probability,
    confidence: spreadConfidence(multigoalSorted),
    odds: fairOdds(markets.multigoal.pick.probability),
  });

  candidates.push({
    marketKey: 'teamToScore.home',
    marketLabel: 'Squadra segna (casa)',
    outcomeLabel: markets.teamToScore.home.label,
    probability: markets.teamToScore.home.probability,
    confidence: spreadConfidence([markets.teamToScore.home.probability, 100 - markets.teamToScore.home.probability]),
    odds: fairOdds(markets.teamToScore.home.probability),
  });
  candidates.push({
    marketKey: 'teamToScore.away',
    marketLabel: 'Squadra segna (trasferta)',
    outcomeLabel: markets.teamToScore.away.label,
    probability: markets.teamToScore.away.probability,
    confidence: spreadConfidence([markets.teamToScore.away.probability, 100 - markets.teamToScore.away.probability]),
    odds: fairOdds(markets.teamToScore.away.probability),
  });

  const exactGoalsSorted = markets.exactTotalGoals.entries.map((e) => e.probability).sort((a, b) => b - a);
  candidates.push({
    marketKey: 'exactTotalGoals',
    marketLabel: 'Somma gol esatta',
    outcomeLabel: `${markets.exactTotalGoals.pick.label} gol totali`,
    probability: markets.exactTotalGoals.pick.probability,
    confidence: spreadConfidence(exactGoalsSorted),
    odds: fairOdds(markets.exactTotalGoals.pick.probability),
  });

  const comboEntries = Object.values(markets.combos);
  comboEntries.forEach((combo, index) => {
    const comboLabels = ['1X2 + Under/Over', 'Esito + Gol/NoGol', 'Doppia chance + Gol/NoGol', 'Multigol + esito'];
    candidates.push({
      marketKey: `combos.${Object.keys(markets.combos)[index]}`,
      marketLabel: comboLabels[index],
      outcomeLabel: combo.label,
      probability: combo.probability,
      // Stima di confidenza più prudente per i mercati combo (dipendono dal
      // verificarsi congiunto di due eventi correlati): usiamo la
      // probabilità stessa maggiorata di un piccolo margine, capped a 100.
      confidence: Math.min(100, combo.probability * 1.2),
      odds: fairOdds(combo.probability),
    });
  });

  // Score complessivo = probabilità × confidenza × appetibilità della quota
  // (vedi oddsAttractiveness): premia pronostici realistici con un ritorno
  // dignitoso, penalizzando sia esiti banali a quota troppo bassa sia
  // opzioni improbabili scelte solo perché nettamente la più alta tra
  // alternative comunque incerte.
  const scored = candidates.map((c) => ({
    ...c,
    score: (c.probability / 100) * (c.confidence / 100) * oddsAttractiveness(c.odds),
  }));
  const best = [...scored].sort((a, b) => b.score - a.score)[0];

  return {
    marketKey: best.marketKey,
    marketLabel: best.marketLabel,
    outcomeLabel: best.outcomeLabel,
    probability: best.probability,
    confidence: best.confidence,
    estimatedOdds: best.odds,
  };
}
