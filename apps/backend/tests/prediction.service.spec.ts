/**
 * Test unitari per il motore di calcolo dei pronostici (prediction.service.ts).
 * Verifica proprietà statistiche fondamentali del calcolo, indipendentemente
 * dai provider dati esterni (funzione pura computePrediction).
 */
import { computeFormScore, computePrediction, calculateMarketTrustWeight } from '../src/services/prediction.service';
import { Match, MarketOdds, Standing, TeamForm } from '../src/types/domain';

function buildMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'test:1',
    leagueCode: 'SA',
    utcDate: new Date().toISOString(),
    status: 'SCHEDULED',
    homeTeam: { id: 'home-1', name: 'Home FC' },
    awayTeam: { id: 'away-1', name: 'Away FC' },
    source: 'test',
    ...overrides,
  };
}

function buildForm(overrides: Partial<TeamForm> = {}): TeamForm {
  return {
    teamId: 'team-1',
    lastResults: ['W', 'W', 'D', 'W', 'L'],
    goalsScoredAvg: 1.5,
    goalsConcededAvg: 1.0,
    ...overrides,
  };
}

function buildStanding(overrides: Partial<Standing> = {}): Standing {
  return {
    teamId: 'team-1',
    position: 10,
    played: 10,
    won: 4,
    draw: 3,
    lost: 3,
    goalsFor: 12,
    goalsAgainst: 12,
    goalDifference: 0,
    points: 15,
    ...overrides,
  };
}

function buildMarketOdds(overrides: Partial<MarketOdds> = {}): MarketOdds {
  return {
    source: 'the-odds-api',
    bookmakersCount: 6,
    averageOdds: { home: 2.0, draw: 3.4, away: 3.8 },
    impliedProbabilities: { home: 0.45, draw: 0.27, away: 0.28 },
    ...overrides,
  };
}

describe('computeFormScore', () => {
  it('restituisce 1 per 5 vittorie consecutive', () => {
    expect(computeFormScore(['W', 'W', 'W', 'W', 'W'])).toBeCloseTo(1, 5);
  });

  it('restituisce 0 per 5 sconfitte consecutive', () => {
    expect(computeFormScore(['L', 'L', 'L', 'L', 'L'])).toBeCloseTo(0, 5);
  });

  it('restituisce 0.5 per forma neutra quando non ci sono dati', () => {
    expect(computeFormScore([])).toBe(0.5);
  });

  it('pesa maggiormente i risultati più recenti', () => {
    // Vittoria recente + 4 sconfitte deve dare uno score maggiore di
    // sconfitta recente + 4 vittorie, a parità di risultati totali.
    const recentWin = computeFormScore(['W', 'L', 'L', 'L', 'L']);
    const recentLoss = computeFormScore(['L', 'W', 'W', 'W', 'W']);
    expect(recentWin).toBeLessThan(recentLoss);
  });
});

describe('computePrediction', () => {
  const emptyH2H = { totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0 };

  it('le probabilità 1X2 sommano circa a 100', () => {
    const prediction = computePrediction({
      match: buildMatch(),
      homeForm: buildForm(),
      awayForm: buildForm({ teamId: 'team-2' }),
      headToHead: emptyH2H,
    });
    const total =
      prediction.probabilities.home + prediction.probabilities.draw + prediction.probabilities.away;
    expect(total).toBeCloseTo(100, 0);
  });

  it('favorisce la squadra di casa quando ha attacco nettamente superiore', () => {
    const prediction = computePrediction({
      match: buildMatch(),
      homeForm: buildForm({ goalsScoredAvg: 3.0, goalsConcededAvg: 0.3 }),
      awayForm: buildForm({ teamId: 'team-2', goalsScoredAvg: 0.3, goalsConcededAvg: 3.0 }),
      headToHead: emptyH2H,
    });
    expect(prediction.suggestedOutcome).toBe('1');
    expect(prediction.probabilities.home).toBeGreaterThan(prediction.probabilities.away);
  });

  it('favorisce la squadra ospite quando ha attacco nettamente superiore', () => {
    const prediction = computePrediction({
      match: buildMatch(),
      homeForm: buildForm({ goalsScoredAvg: 0.2, goalsConcededAvg: 3.0 }),
      awayForm: buildForm({ teamId: 'team-2', goalsScoredAvg: 3.0, goalsConcededAvg: 0.2 }),
      headToHead: emptyH2H,
    });
    expect(prediction.suggestedOutcome).toBe('2');
  });

  it('suggerisce OVER_2_5 quando i gol attesi totali superano 2.5', () => {
    const prediction = computePrediction({
      match: buildMatch(),
      homeForm: buildForm({ goalsScoredAvg: 2.5, goalsConcededAvg: 1.5 }),
      awayForm: buildForm({ teamId: 'team-2', goalsScoredAvg: 2.0, goalsConcededAvg: 1.5 }),
      headToHead: emptyH2H,
    });
    expect(prediction.overUnder.expectedTotalGoals).toBeGreaterThan(2.5);
    expect(prediction.overUnder.suggestion).toBe('OVER_2_5');
  });

  it('suggerisce UNDER_2_5 quando i gol attesi totali sono bassi', () => {
    const prediction = computePrediction({
      match: buildMatch(),
      homeForm: buildForm({ goalsScoredAvg: 0.5, goalsConcededAvg: 0.4 }),
      awayForm: buildForm({ teamId: 'team-2', goalsScoredAvg: 0.4, goalsConcededAvg: 0.5 }),
      headToHead: emptyH2H,
    });
    expect(prediction.overUnder.expectedTotalGoals).toBeLessThan(2.5);
    expect(prediction.overUnder.suggestion).toBe('UNDER_2_5');
  });

  it('la confidenza è compresa tra 0 e 100', () => {
    const prediction = computePrediction({
      match: buildMatch(),
      homeForm: buildForm(),
      awayForm: buildForm({ teamId: 'team-2' }),
      headToHead: emptyH2H,
    });
    expect(prediction.confidence).toBeGreaterThanOrEqual(0);
    expect(prediction.confidence).toBeLessThanOrEqual(100);
  });

  it('la quota stimata è sempre maggiore di 1 (nessun arbitraggio)', () => {
    const prediction = computePrediction({
      match: buildMatch(),
      homeForm: buildForm({ goalsScoredAvg: 3.0, goalsConcededAvg: 0.2 }),
      awayForm: buildForm({ teamId: 'team-2', goalsScoredAvg: 0.2, goalsConcededAvg: 3.0 }),
      headToHead: emptyH2H,
    });
    expect(prediction.estimatedOdds).toBeGreaterThan(1);
  });

  it('uno storico H2H favorevole alla squadra di casa aumenta la probabilità home', () => {
    const baseInput = {
      match: buildMatch(),
      homeForm: buildForm(),
      awayForm: buildForm({ teamId: 'team-2' }),
    };
    const withoutH2H = computePrediction({ ...baseInput, headToHead: emptyH2H });
    const withFavorableH2H = computePrediction({
      ...baseInput,
      headToHead: { totalMatches: 10, homeWins: 8, draws: 1, awayWins: 1 },
    });
    expect(withFavorableH2H.probabilities.home).toBeGreaterThan(withoutH2H.probabilities.home);
  });

  it('include le metriche di debug solo se richiesto', () => {
    const withoutDebug = computePrediction({
      match: buildMatch(),
      homeForm: buildForm(),
      awayForm: buildForm({ teamId: 'team-2' }),
      headToHead: emptyH2H,
    });
    expect(withoutDebug.debugMetrics).toBeUndefined();

    const withDebug = computePrediction({
      match: buildMatch(),
      homeForm: buildForm(),
      awayForm: buildForm({ teamId: 'team-2' }),
      headToHead: emptyH2H,
      includeDebug: true,
    });
    expect(withDebug.debugMetrics).toBeDefined();
    expect(withDebug.debugMetrics?.expectedGoalsHome).toBeGreaterThan(0);
  });

  it('una posizione in classifica molto migliore aumenta la probabilità home', () => {
    const baseInput = {
      match: buildMatch(),
      homeForm: buildForm(),
      awayForm: buildForm({ teamId: 'team-2' }),
      headToHead: emptyH2H,
    };
    const withoutStandings = computePrediction(baseInput);
    const withFavorableStandings = computePrediction({
      ...baseInput,
      homeStanding: buildStanding({ teamId: 'home-1', position: 1 }),
      awayStanding: buildStanding({ teamId: 'away-1', position: 18 }),
      leagueSize: 20,
    });
    expect(withFavorableStandings.probabilities.home).toBeGreaterThan(
      withoutStandings.probabilities.home
    );
  });

  it('effettua il blend con le probabilità di mercato quando disponibili', () => {
    const baseInput = {
      match: buildMatch(),
      homeForm: buildForm(),
      awayForm: buildForm({ teamId: 'team-2' }),
      headToHead: emptyH2H,
      includeDebug: true,
    };
    const withoutMarket = computePrediction(baseInput);
    // Mercato fortemente sbilanciato verso il pareggio: la probabilità di
    // pareggio del pronostico finale deve aumentare rispetto al solo modello.
    const withMarket = computePrediction({
      ...baseInput,
      marketOdds: buildMarketOdds({
        impliedProbabilities: { home: 0.2, draw: 0.6, away: 0.2 },
      }),
    });
    expect(withMarket.probabilities.draw).toBeGreaterThan(withoutMarket.probabilities.draw);
    expect(withMarket.debugMetrics?.marketBlendWeight).toBeGreaterThan(0);
    expect(withMarket.stats.marketOdds).toBeDefined();
  });

  it('senza quote di mercato il peso del blend è zero e le quote non sono presenti nelle stats', () => {
    const prediction = computePrediction({
      match: buildMatch(),
      homeForm: buildForm(),
      awayForm: buildForm({ teamId: 'team-2' }),
      headToHead: emptyH2H,
      includeDebug: true,
    });
    expect(prediction.debugMetrics?.marketBlendWeight).toBe(0);
    expect(prediction.stats.marketOdds).toBeUndefined();
  });

  it('quando le quote di mercato sono disponibili, la quota stimata coincide con la quota reale del mercato per l\'esito consigliato', () => {
    const prediction = computePrediction({
      match: buildMatch(),
      homeForm: buildForm(),
      awayForm: buildForm({ teamId: 'team-2' }),
      headToHead: emptyH2H,
      marketOdds: buildMarketOdds({
        averageOdds: { home: 1.5, draw: 4.2, away: 6.1 },
      }),
    });
    const expectedOddsByOutcome = { '1': 1.5, X: 4.2, '2': 6.1 };
    expect(prediction.estimatedOdds).toBe(expectedOddsByOutcome[prediction.suggestedOutcome]);
  });

  it('un mercato fortemente sbilanciato (es. 1.20 vs 5.60) pesa più di un mercato vicino all\'equilibrio', () => {
    const balanced = buildMarketOdds({
      bookmakersCount: 15,
      impliedProbabilities: { home: 0.34, draw: 0.33, away: 0.33 },
    });
    const lopsided = buildMarketOdds({
      bookmakersCount: 15,
      // Quote circa 1.20 (favorita netta) vs 5.60 (grande sfavorita).
      impliedProbabilities: { home: 0.8, draw: 0.11, away: 0.09 },
    });
    expect(calculateMarketTrustWeight(lopsided)).toBeGreaterThan(calculateMarketTrustWeight(balanced));
  });

  it('più bookmaker aggregati aumentano il peso di fiducia nel mercato, a parità di sbilanciamento', () => {
    const fewBookmakers = buildMarketOdds({
      bookmakersCount: 2,
      impliedProbabilities: { home: 0.75, draw: 0.15, away: 0.1 },
    });
    const manyBookmakers = buildMarketOdds({
      bookmakersCount: 20,
      impliedProbabilities: { home: 0.75, draw: 0.15, away: 0.1 },
    });
    expect(calculateMarketTrustWeight(manyBookmakers)).toBeGreaterThan(
      calculateMarketTrustWeight(fewBookmakers)
    );
  });

  it('senza quote di mercato il peso di fiducia è zero', () => {
    expect(calculateMarketTrustWeight(undefined)).toBe(0);
  });

  it('un mercato molto sbilanciato influenza il pronostico finale più fortemente di uno equilibrato', () => {
    const baseInput = {
      match: buildMatch(),
      homeForm: buildForm(),
      awayForm: buildForm({ teamId: 'team-2' }),
      headToHead: emptyH2H,
    };
    const withBalancedMarket = computePrediction({
      ...baseInput,
      marketOdds: buildMarketOdds({
        bookmakersCount: 15,
        impliedProbabilities: { home: 0.4, draw: 0.3, away: 0.3 },
      }),
    });
    const withLopsidedMarket = computePrediction({
      ...baseInput,
      marketOdds: buildMarketOdds({
        bookmakersCount: 15,
        impliedProbabilities: { home: 0.85, draw: 0.1, away: 0.05 },
      }),
    });
    // Il mercato fortemente sbilanciato verso la vittoria casalinga deve
    // spingere la probabilità home finale più in alto di un mercato equilibrato.
    expect(withLopsidedMarket.probabilities.home).toBeGreaterThan(withBalancedMarket.probabilities.home);
  });

  it('calcola la probabilità BTTS (Both Teams To Score) dal modello di Poisson', () => {
    const prediction = computePrediction({
      match: buildMatch(),
      homeForm: buildForm({ goalsScoredAvg: 2.0, goalsConcededAvg: 1.5 }),
      awayForm: buildForm({ teamId: 'team-2', goalsScoredAvg: 1.8, goalsConcededAvg: 1.3 }),
      headToHead: emptyH2H,
    });
    expect(prediction.bothTeamsToScore.probabilityYes).toBeGreaterThan(0);
    expect(prediction.bothTeamsToScore.probabilityYes).toBeLessThanOrEqual(100);
    expect(prediction.bothTeamsToScore.probabilityYes + prediction.bothTeamsToScore.probabilityNo).toBeCloseTo(
      100,
      0
    );
    expect(['YES', 'NO']).toContain(prediction.bothTeamsToScore.suggestion);
  });

  it('la probabilità BTTS è più alta quando entrambi gli attacchi sono forti e le difese deboli', () => {
    const strongAttacks = computePrediction({
      match: buildMatch(),
      homeForm: buildForm({ goalsScoredAvg: 2.5, goalsConcededAvg: 2.0 }),
      awayForm: buildForm({ teamId: 'team-2', goalsScoredAvg: 2.3, goalsConcededAvg: 2.0 }),
      headToHead: emptyH2H,
    });
    const weakAttacks = computePrediction({
      match: buildMatch(),
      homeForm: buildForm({ goalsScoredAvg: 0.3, goalsConcededAvg: 0.3 }),
      awayForm: buildForm({ teamId: 'team-2', goalsScoredAvg: 0.3, goalsConcededAvg: 0.3 }),
      headToHead: emptyH2H,
    });
    expect(strongAttacks.bothTeamsToScore.probabilityYes).toBeGreaterThan(
      weakAttacks.bothTeamsToScore.probabilityYes
    );
  });

  it('la doppia chance è derivata correttamente sommando le probabilità 1X2 finali', () => {
    const prediction = computePrediction({
      match: buildMatch(),
      homeForm: buildForm(),
      awayForm: buildForm({ teamId: 'team-2' }),
      headToHead: emptyH2H,
    });
    const { home, draw, away } = prediction.probabilities;
    expect(prediction.doubleChance.oneOrDraw).toBeCloseTo(home + draw, 1);
    expect(prediction.doubleChance.drawOrTwo).toBeCloseTo(draw + away, 1);
    expect(prediction.doubleChance.oneOrTwo).toBeCloseTo(home + away, 1);
  });

  it('include il mercato totals (Over/Under) nel blend quando disponibile', () => {
    const baseInput = {
      match: buildMatch(),
      homeForm: buildForm({ goalsScoredAvg: 1.0, goalsConcededAvg: 1.0 }),
      awayForm: buildForm({ teamId: 'team-2', goalsScoredAvg: 1.0, goalsConcededAvg: 1.0 }),
      headToHead: emptyH2H,
    };
    const withoutTotals = computePrediction(baseInput);
    // Mercato "totals" fortemente sbilanciato verso Over: la probabilità
    // Over finale deve aumentare rispetto al solo modello statistico.
    const withTotals = computePrediction({
      ...baseInput,
      marketOdds: buildMarketOdds({
        totals: {
          line: 2.5,
          bookmakersCount: 15,
          averageOdds: { over: 1.3, under: 3.4 },
          impliedProbabilities: { over: 0.85, under: 0.15 },
        },
      }),
    });
    expect(withTotals.overUnder.probabilityOver).toBeGreaterThan(withoutTotals.overUnder.probabilityOver);
  });
});
