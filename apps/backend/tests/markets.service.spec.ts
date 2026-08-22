/**
 * Test unitari per il motore dei mercati estesi (markets.service.ts):
 * verifica che ogni mercato calcolato sia statisticamente coerente
 * (probabilità che sommano al 100%, best pick coerente, ecc.).
 */
import { computeAllMarkets } from '../src/services/markets.service';

function buildInput(overrides: Partial<Parameters<typeof computeAllMarkets>[0]> = {}) {
  return {
    expectedGoalsHome: 1.6,
    expectedGoalsAway: 1.1,
    finalProbabilities: { home: 45, draw: 27, away: 28 },
    finalDoubleChance: { oneOrDraw: 72, drawOrTwo: 55, oneOrTwo: 73 },
    finalBtts: { yes: 55, no: 45 },
    mainEstimatedOdds: 2.1,
    mainConfidence: 40,
    ...overrides,
  };
}

describe('computeAllMarkets', () => {
  it('calcola tutti i mercati richiesti', () => {
    const { markets } = computeAllMarkets(buildInput());
    expect(markets.matchResult1x2).toBeDefined();
    expect(markets.doubleChance).toBeDefined();
    expect(markets.halfTimeResult).toBeDefined();
    expect(markets.secondHalfResult).toBeDefined();
    expect(markets.halfTimeFullTime.entries).toHaveLength(9);
    expect(markets.overUnder.lines).toHaveLength(4);
    expect(markets.bothTeamsToScore).toBeDefined();
    expect(markets.multigoal.ranges.length).toBeGreaterThan(0);
    expect(markets.teamToScore.home).toBeDefined();
    expect(markets.teamToScore.away).toBeDefined();
    expect(markets.exactTotalGoals.entries).toHaveLength(7);
    expect(markets.combos.resultAndOverUnder).toBeDefined();
    expect(markets.combos.resultAndBtts).toBeDefined();
    expect(markets.combos.doubleChanceAndBtts).toBeDefined();
    expect(markets.combos.multigoalAndResult).toBeDefined();
  });

  it('le probabilità primo tempo/secondo tempo sommano circa a 100', () => {
    const { markets } = computeAllMarkets(buildInput());
    const ht = markets.halfTimeResult.probabilities;
    const st = markets.secondHalfResult.probabilities;
    expect(ht.home + ht.draw + ht.away).toBeCloseTo(100, 0);
    expect(st.home + st.draw + st.away).toBeCloseTo(100, 0);
  });

  it('le 9 combinazioni parziale/finale sommano circa a 100', () => {
    const { markets } = computeAllMarkets(buildInput());
    const total = markets.halfTimeFullTime.entries.reduce((sum, e) => sum + e.probability, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it('la somma gol esatta (0..6+) somma circa a 100', () => {
    const { markets } = computeAllMarkets(buildInput());
    const total = markets.exactTotalGoals.entries.reduce((sum, e) => sum + e.probability, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it('over/under a linea più bassa ha probabilità Over maggiore di una linea più alta', () => {
    const { markets } = computeAllMarkets(buildInput());
    const line05 = markets.overUnder.lines.find((l) => l.line === 0.5)!;
    const line35 = markets.overUnder.lines.find((l) => l.line === 3.5)!;
    expect(line05.over).toBeGreaterThan(line35.over);
  });

  it('sceglie un bestPick con probabilità e confidenza tra 0 e 100', () => {
    const { bestPick } = computeAllMarkets(buildInput());
    expect(bestPick.probability).toBeGreaterThan(0);
    expect(bestPick.probability).toBeLessThanOrEqual(100);
    expect(bestPick.confidence).toBeGreaterThanOrEqual(0);
    expect(bestPick.confidence).toBeLessThanOrEqual(100);
    expect(bestPick.estimatedOdds).toBeGreaterThan(1);
  });

  it('con un attacco casalingo nettamente più forte, "squadra segna (casa)" ha probabilità alta', () => {
    const { markets } = computeAllMarkets(
      buildInput({ expectedGoalsHome: 3.0, expectedGoalsAway: 0.2 })
    );
    expect(markets.teamToScore.home.probability).toBeGreaterThan(90);
  });
});
