/**
 * ProviderManager: coordina i provider dati esterni implementando un
 * meccanismo di fallback. Prova il provider primario (football-data.org);
 * se fallisce (errore di rete, rate limit, chiave mancante, timeout dopo i
 * retry) passa automaticamente al provider di fallback (TheSportsDB).
 *
 * Per aggiungere un nuovo provider: implementare l'interfaccia MatchProvider
 * (src/types/domain.ts) e aggiungerlo all'array `providers` nell'ordine di
 * priorità desiderato.
 */
import { League, Match, MatchProvider, Standing, TeamForm } from '../types/domain';
import { FootballDataProvider } from '../providers/football-data.provider';
import { TheSportsDbProvider } from '../providers/thesportsdb.provider';
import { logger } from '../utils/logger';

export class ProviderManager {
  private providers: MatchProvider[];

  constructor(providers: MatchProvider[] = [new FootballDataProvider(), new TheSportsDbProvider()]) {
    this.providers = providers;
  }

  /** Esegue `operation` su ciascun provider in ordine finché uno non ha successo. */
  private async withFallback<T>(
    operation: (provider: MatchProvider) => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await operation(provider);
      } catch (err) {
        lastError = err;
        logger.warn(
          `Provider "${provider.name}" fallito per operazione "${operationName}", provo il successivo`,
          err instanceof Error ? err.message : err
        );
      }
    }
    throw new Error(
      `Tutti i provider dati hanno fallito per l'operazione "${operationName}": ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  async getNextMatchday(league: League): Promise<Match[]> {
    return this.withFallback((p) => p.getNextMatchday(league), 'getNextMatchday');
  }

  async getTeamForm(teamId: string, leagueCode: string): Promise<TeamForm> {
    return this.withFallback((p) => p.getTeamForm(teamId, leagueCode), 'getTeamForm');
  }

  async getHeadToHead(
    homeTeamId: string,
    awayTeamId: string
  ): Promise<{ totalMatches: number; homeWins: number; draws: number; awayWins: number }> {
    return this.withFallback(
      (p) => p.getHeadToHead(homeTeamId, awayTeamId),
      'getHeadToHead'
    );
  }

  async getStandings(league: League): Promise<Standing[]> {
    return this.withFallback((p) => p.getStandings(league), 'getStandings');
  }
}

export const providerManager = new ProviderManager();
