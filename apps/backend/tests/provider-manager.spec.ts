/**
 * Test unitari per il meccanismo di fallback tra provider dati
 * (ProviderManager). Usa provider finti (mock) per verificare che, quando
 * il provider primario fallisce, venga usato automaticamente il fallback.
 */
import { ProviderManager } from '../src/services/provider-manager';
import { League, Match, MatchProvider, Standing, TeamForm } from '../src/types/domain';

function buildLeague(): League {
  return {
    code: 'SA',
    name: 'Serie A',
    country: 'Italia',
    isTop5: true,
    providerIds: { footballData: 'SA', theSportsDb: '4332' },
  };
}

function buildMockProvider(
  name: string,
  overrides: Partial<MatchProvider> = {}
): MatchProvider {
  return {
    name,
    getNextMatchday: jest.fn().mockResolvedValue([] as Match[]),
    getTeamForm: jest.fn().mockResolvedValue({
      teamId: 'x',
      lastResults: [],
      goalsScoredAvg: 0,
      goalsConcededAvg: 0,
    } as TeamForm),
    getHeadToHead: jest
      .fn()
      .mockResolvedValue({ totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0 }),
    getStandings: jest.fn().mockResolvedValue([] as Standing[]),
    ...overrides,
  };
}

describe('ProviderManager fallback', () => {
  it('usa il provider primario quando ha successo', async () => {
    const primary = buildMockProvider('primary');
    const fallback = buildMockProvider('fallback');
    const manager = new ProviderManager([primary, fallback]);

    await manager.getNextMatchday(buildLeague());

    expect(primary.getNextMatchday).toHaveBeenCalledTimes(1);
    expect(fallback.getNextMatchday).not.toHaveBeenCalled();
  });

  it('passa al provider di fallback quando il primario fallisce', async () => {
    const primary = buildMockProvider('primary', {
      getNextMatchday: jest.fn().mockRejectedValue(new Error('rate limit exceeded')),
    });
    const fallback = buildMockProvider('fallback');
    const manager = new ProviderManager([primary, fallback]);

    const result = await manager.getNextMatchday(buildLeague());

    expect(primary.getNextMatchday).toHaveBeenCalledTimes(1);
    expect(fallback.getNextMatchday).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it('lancia un errore aggregato quando tutti i provider falliscono', async () => {
    const primary = buildMockProvider('primary', {
      getNextMatchday: jest.fn().mockRejectedValue(new Error('primary down')),
    });
    const fallback = buildMockProvider('fallback', {
      getNextMatchday: jest.fn().mockRejectedValue(new Error('fallback down')),
    });
    const manager = new ProviderManager([primary, fallback]);

    await expect(manager.getNextMatchday(buildLeague())).rejects.toThrow(
      /Tutti i provider dati hanno fallito/
    );
  });

  it('applica lo stesso meccanismo di fallback a getTeamForm e getHeadToHead', async () => {
    const primary = buildMockProvider('primary', {
      getTeamForm: jest.fn().mockRejectedValue(new Error('timeout')),
      getHeadToHead: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    const fallback = buildMockProvider('fallback');
    const manager = new ProviderManager([primary, fallback]);

    await manager.getTeamForm('team-1', 'SA');
    await manager.getHeadToHead('team-1', 'team-2');

    expect(fallback.getTeamForm).toHaveBeenCalledTimes(1);
    expect(fallback.getHeadToHead).toHaveBeenCalledTimes(1);
  });

  it('applica lo stesso meccanismo di fallback a getStandings', async () => {
    const primary = buildMockProvider('primary', {
      getStandings: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    const fallback = buildMockProvider('fallback');
    const manager = new ProviderManager([primary, fallback]);

    await manager.getStandings(buildLeague());

    expect(fallback.getStandings).toHaveBeenCalledTimes(1);
  });
});
