/**
 * Provider primario: football-data.org (https://www.football-data.org/documentation/quickstart)
 * Piano gratuito: richiede una API key (header X-Auth-Token), rate limit ~10 req/min,
 * copre le competizioni dei top campionati europei.
 *
 * CHANGE_ME: impostare FOOTBALL_DATA_API_KEY in apps/backend/.env con la propria chiave
 * gratuita ottenuta registrandosi su https://www.football-data.org/client/register
 */
import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import { League, Match, MatchProvider, Standing, TeamForm } from '../types/domain';
import { buildCompositeId, average, toIsoUtc } from '../utils/normalize';
import { withRetry } from '../utils/http-retry';
import { logger } from '../utils/logger';
import { RequestQueue } from '../utils/request-queue';

const PROVIDER_NAME = 'football-data';

// football-data.org (piano free) consente ~10 richieste/minuto: serializziamo
// le chiamate con un ritardo minimo di 6.5s per restare sotto quella soglia
// anche quando più campionati/partite vengono richiesti in rapida successione.
const requestQueue = new RequestQueue(1, 6500);

interface FdTeam {
  id: number;
  name: string;
  shortName?: string;
  crest?: string;
}

interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday?: number;
  venue?: string;
  homeTeam: FdTeam;
  awayTeam: FdTeam;
}

/**
 * Determina il numero della prossima giornata (matchday) a partire da un
 * elenco di partite SCHEDULED, usando il matchday della partita
 * cronologicamente più vicina (non il numero di giornata più basso).
 *
 * Accetta un tipo minimo (solo `matchday`/`utcDate`) invece di `FdMatch[]`
 * per restare facilmente testabile senza dover costruire oggetti partita
 * completi (vedi tests/football-data.provider.spec.ts). Vedi il commento in
 * getNextMatchday per il razionale completo.
 */
export function findNextMatchdayNumber(
  matches: Array<{ matchday?: number; utcDate: string }>
): number | undefined {
  const earliestMatch = matches
    .filter((m) => typeof m.matchday === 'number')
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime())[0];
  return earliestMatch?.matchday;
}

function mapStatus(fdStatus: string): Match['status'] {
  switch (fdStatus) {
    case 'SCHEDULED':
    case 'TIMED':
      return 'SCHEDULED';
    case 'IN_PLAY':
    case 'PAUSED':
      return 'LIVE';
    case 'FINISHED':
      return 'FINISHED';
    case 'POSTPONED':
    case 'SUSPENDED':
    case 'CANCELLED':
      return 'POSTPONED';
    default:
      return 'UNKNOWN';
  }
}

export class FootballDataProvider implements MatchProvider {
  name = PROVIDER_NAME;
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: env.footballDataBaseUrl,
      timeout: env.httpTimeoutMs,
      headers: env.footballDataApiKey ? { 'X-Auth-Token': env.footballDataApiKey } : {},
    });
  }

  private assertConfigured(): void {
    // Se la chiave è vuota o è ancora il placeholder di .env.example, evitiamo
    // del tutto la chiamata HTTP (che fallirebbe comunque con 400/401) e
    // passiamo subito al provider di fallback (TheSportsDB), risparmiando
    // tempo e retry inutili.
    if (!env.isFootballDataConfigured) {
      throw new Error(
        'FOOTBALL_DATA_API_KEY non configurata: impostarla in apps/backend/.env (vedi .env.example)'
      );
    }
  }

  async getNextMatchday(league: League): Promise<Match[]> {
    this.assertConfigured();
    const competitionCode = league.providerIds.footballData;
    if (!competitionCode) {
      throw new Error(`Campionato ${league.code} non mappato per football-data.org`);
    }

    return withRetry(
      () =>
        requestQueue.run(async () => {
          // football-data.org espone lo stato "SCHEDULED" per le partite future.
          // Filtriamo lato client per prendere solo la prossima giornata disponibile.
          const { data } = await this.client.get(`/competitions/${competitionCode}/matches`, {
            params: { status: 'SCHEDULED' },
          });

          const matches: FdMatch[] = data.matches ?? [];
          if (matches.length === 0) return [];

          // Determina la prossima giornata (matchday) a partire dalla partita
          // SCHEDULED cronologicamente più vicina, NON dal numero di giornata
          // più basso: in campionati come LaLiga i numeri di giornata non sono
          // sempre in ordine cronologico (partite rinviate a causa di
          // impegni europei/coppe possono slittare a dopo giornate
          // successive). Usare il numero minimo porterebbe a selezionare una
          // giornata "vecchia" con solo poche partite rinviate ancora da
          // giocare, invece della prossima giornata completa. Prendendo il
          // matchday della partita più vicina nel tempo otteniamo sempre il
          // turno corretto, con tutte le sue partite (anche se alcune di
          // quel turno sono già state giocate in anticipo).
          const nextMatchday = findNextMatchdayNumber(matches);

          const filtered = matches.filter((m) => m.matchday === nextMatchday);

          return filtered.map((m) => this.mapMatch(m, league));
        }),
      { maxRetries: env.httpMaxRetries }
    );
  }

  private mapMatch(m: FdMatch, league: League): Match {
    return {
      id: buildCompositeId(PROVIDER_NAME, m.id),
      leagueCode: league.code,
      utcDate: toIsoUtc(m.utcDate),
      status: mapStatus(m.status),
      matchday: m.matchday,
      venue: m.venue,
      homeTeam: {
        id: buildCompositeId(PROVIDER_NAME, m.homeTeam.id),
        name: m.homeTeam.name,
        shortName: m.homeTeam.shortName,
        crestUrl: m.homeTeam.crest,
      },
      awayTeam: {
        id: buildCompositeId(PROVIDER_NAME, m.awayTeam.id),
        name: m.awayTeam.name,
        shortName: m.awayTeam.shortName,
        crestUrl: m.awayTeam.crest,
      },
      source: PROVIDER_NAME,
    };
  }

  async getTeamForm(teamId: string, _leagueCode: string): Promise<TeamForm> {
    this.assertConfigured();
    // Il teamId interno è nel formato "football-data:123" -> estraiamo l'id nativo.
    const nativeId = teamId.split(':').pop();

    return withRetry(
      () =>
        requestQueue.run(async () => {
          const { data } = await this.client.get(`/teams/${nativeId}/matches`, {
            params: { status: 'FINISHED', limit: 5 },
          });
          const matches: any[] = (data.matches ?? []).slice(0, 5);

          const lastResults: Array<'W' | 'D' | 'L'> = [];
          const goalsScored: number[] = [];
          const goalsConceded: number[] = [];

          for (const m of matches) {
            const isHome = String(m.homeTeam.id) === nativeId;
            const scored = isHome ? m.score.fullTime.home : m.score.fullTime.away;
            const conceded = isHome ? m.score.fullTime.away : m.score.fullTime.home;
            if (typeof scored === 'number') goalsScored.push(scored);
            if (typeof conceded === 'number') goalsConceded.push(conceded);

            if (scored > conceded) lastResults.push('W');
            else if (scored === conceded) lastResults.push('D');
            else lastResults.push('L');
          }

          return {
            teamId,
            lastResults,
            goalsScoredAvg: average(goalsScored),
            goalsConcededAvg: average(goalsConceded),
          };
        }),
      { maxRetries: env.httpMaxRetries }
    );
  }

  async getHeadToHead(
    homeTeamId: string,
    awayTeamId: string
  ): Promise<{ totalMatches: number; homeWins: number; draws: number; awayWins: number }> {
    this.assertConfigured();
    // football-data.org non espone un endpoint diretto H2H nel piano free per matchId
    // sconosciuto a priori; qui usiamo l'endpoint /matches con filtro team come fallback
    // semplificato. In assenza di dati sufficienti si restituisce un H2H neutro.
    try {
      const nativeHomeId = homeTeamId.split(':').pop();
      const { data } = await requestQueue.run(() =>
        this.client.get(`/teams/${nativeHomeId}/matches`, {
          params: { status: 'FINISHED', limit: 20 },
        })
      );
      const nativeAwayId = awayTeamId.split(':').pop();
      const matches: any[] = (data.matches ?? []).filter(
        (m: any) =>
          String(m.homeTeam.id) === nativeAwayId || String(m.awayTeam.id) === nativeAwayId
      );

      let homeWins = 0;
      let draws = 0;
      let awayWins = 0;
      for (const m of matches) {
        const homeIsOurHome = String(m.homeTeam.id) === nativeHomeId;
        const homeGoals = m.score.fullTime.home;
        const awayGoals = m.score.fullTime.away;
        if (homeGoals === awayGoals) draws++;
        else if ((homeGoals > awayGoals) === homeIsOurHome) homeWins++;
        else awayWins++;
      }

      return { totalMatches: matches.length, homeWins, draws, awayWins };
    } catch (err) {
      logger.warn('Impossibile calcolare H2H da football-data.org, uso valori neutri', err);
      return { totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0 };
    }
  }

  /**
   * Recupera la classifica corrente del campionato (GET /competitions/{code}/standings),
   * usata dal motore pronostici per pesare la forza delle squadre in base alla
   * posizione in classifica (oltre alla sola forma recente).
   */
  async getStandings(league: League): Promise<Standing[]> {
    this.assertConfigured();
    const competitionCode = league.providerIds.footballData;
    if (!competitionCode) {
      throw new Error(`Campionato ${league.code} non mappato per football-data.org`);
    }

    return withRetry(
      () =>
        requestQueue.run(async () => {
          const { data } = await this.client.get(`/competitions/${competitionCode}/standings`);
          // Il piano free restituisce più "tipi" di classifica (TOTAL, HOME, AWAY);
          // usiamo la classifica generale (TOTAL).
          const totalTable =
            (data.standings ?? []).find((s: any) => s.type === 'TOTAL')?.table ?? [];

          return totalTable.map(
            (row: any): Standing => ({
              teamId: buildCompositeId(PROVIDER_NAME, row.team.id),
              position: row.position,
              played: row.playedGames,
              won: row.won,
              draw: row.draw,
              lost: row.lost,
              goalsFor: row.goalsFor,
              goalsAgainst: row.goalsAgainst,
              goalDifference: row.goalDifference,
              points: row.points,
            })
          );
        }),
      { maxRetries: env.httpMaxRetries }
    );
  }
}
