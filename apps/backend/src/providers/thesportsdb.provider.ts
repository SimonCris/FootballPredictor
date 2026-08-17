/**
 * Provider di fallback: TheSportsDB (https://www.thesportsdb.com/free_sport_api)
 * Usa la chiave pubblica di test "3", gratuita e senza registrazione, adatta
 * come fallback quando football-data.org non è raggiungibile o ha esaurito
 * il rate limit. Copertura dati meno dettagliata rispetto al provider primario.
 *
 * CHANGE_ME: per un uso più intensivo, registrare una chiave Patreon su
 * https://www.thesportsdb.com/ e impostarla in THESPORTSDB_API_KEY.
 */
import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import { League, Match, MatchProvider, TeamForm } from '../types/domain';
import { buildCompositeId, average, toIsoUtc } from '../utils/normalize';
import { withRetry } from '../utils/http-retry';
import { logger } from '../utils/logger';
import { RequestQueue } from '../utils/request-queue';

const PROVIDER_NAME = 'thesportsdb';

// TheSportsDB (piano free, chiave pubblica "3") è protetto da Cloudflare e
// applica un rate limit piuttosto aggressivo (HTTP 429, "Error 1015: You are
// being rate limited") quando riceve troppe richieste ravvicinate dallo
// stesso IP. Serializziamo le chiamate (1 alla volta) con un ritardo minimo
// tra l'una e l'altra per restare sotto quella soglia, anche quando più
// campionati/partite vengono richiesti in rapida successione (es. pagina
// Top Pronostici che interroga i top 5 campionati e tutte le loro partite).
const requestQueue = new RequestQueue(1, 1200);

interface TsdbEvent {
  idEvent: string;
  strEvent: string;
  dateEvent: string;
  strTime?: string;
  strTimestamp?: string;
  idHomeTeam: string;
  idAwayTeam: string;
  strHomeTeam: string;
  strAwayTeam: string;
  strVenue?: string;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
  intRound?: string;
  strSeason?: string;
  strStatus?: string;
}

function mapTsdbStatus(strStatus: string | undefined): Match['status'] {
  switch (strStatus) {
    case 'FT':
    case 'AET':
    case 'PEN':
      return 'FINISHED';
    case '1H':
    case '2H':
    case 'HT':
    case 'ET':
      return 'LIVE';
    case 'PST':
    case 'CANC':
    case 'ABD':
      return 'POSTPONED';
    case 'NS':
    case '':
    case undefined:
      return 'SCHEDULED';
    default:
      return 'SCHEDULED';
  }
}

export class TheSportsDbProvider implements MatchProvider {
  name = PROVIDER_NAME;
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: `${env.theSportsDbBaseUrl}/${env.theSportsDbApiKey}`,
      timeout: env.httpTimeoutMs,
    });
  }

  async getNextMatchday(league: League): Promise<Match[]> {
    const leagueId = league.providerIds.theSportsDb;
    if (!leagueId) {
      throw new Error(`Campionato ${league.code} non mappato per TheSportsDB`);
    }

    // Step 1: l'endpoint eventsnextleague.php, con la chiave pubblica di
    // test "3", restituisce in modo affidabile solo il prossimo singolo
    // evento per molti campionati (limitazione nota del piano free di
    // TheSportsDB). Lo usiamo solo per scoprire QUALE turno (intRound) e
    // QUALE stagione (strSeason) sia il prossimo.
    const nextEvents = await withRetry(
      () =>
        requestQueue.run(async () => {
          const { data } = await this.client.get('/eventsnextleague.php', {
            params: { id: leagueId },
          });
          return (data.events ?? []) as TsdbEvent[];
        }),
      { maxRetries: env.httpMaxRetries }
    );

    if (nextEvents.length === 0) return [];

    const referenceEvent = nextEvents[0];

    // Step 2: se abbiamo round e stagione, recuperiamo l'intero turno con
    // eventsround.php, che (a differenza di eventsnextleague.php) restituisce
    // tutte le partite del turno anche con la chiave free, per qualunque
    // campionato.
    if (referenceEvent.intRound && referenceEvent.strSeason) {
      try {
        const roundEvents = await withRetry(
          () =>
            requestQueue.run(async () => {
              const { data } = await this.client.get('/eventsround.php', {
                params: {
                  id: leagueId,
                  r: referenceEvent.intRound,
                  s: referenceEvent.strSeason,
                },
              });
              return (data.events ?? []) as TsdbEvent[];
            }),
          { maxRetries: env.httpMaxRetries }
        );

        if (roundEvents.length > 0) {
          return roundEvents.map((e) => this.mapMatch(e, league));
        }
      } catch (err) {
        logger.warn(
          `eventsround.php fallito per ${league.name}, uso il fallback su eventsnextleague.php`,
          err
        );
      }
    }

    // Fallback: se eventsround.php non è disponibile o non ha restituito
    // dati, raggruppiamo gli eventi già ottenuti da eventsnextleague.php per
    // finestra di date (i turni di campionato si giocano tipicamente in un
    // arco di ~4 giorni tra weekend e recuperi infrasettimanali).
    const sorted = [...nextEvents].sort(
      (a, b) =>
        new Date(a.strTimestamp ?? a.dateEvent).getTime() -
        new Date(b.strTimestamp ?? b.dateEvent).getTime()
    );
    const firstDate = new Date(sorted[0].strTimestamp ?? sorted[0].dateEvent).getTime();
    const MATCHDAY_WINDOW_MS = 4 * 24 * 60 * 60 * 1000; // 4 giorni
    const filtered = sorted.filter(
      (e) => new Date(e.strTimestamp ?? e.dateEvent).getTime() - firstDate <= MATCHDAY_WINDOW_MS
    );

    return filtered.map((e) => this.mapMatch(e, league));
  }

  private mapMatch(e: TsdbEvent, league: League): Match {
    const isoDate = e.strTimestamp
      ? toIsoUtc(`${e.strTimestamp}Z`)
      : toIsoUtc(`${e.dateEvent}T${e.strTime ?? '00:00:00'}Z`);

    return {
      id: buildCompositeId(PROVIDER_NAME, e.idEvent),
      leagueCode: league.code,
      utcDate: isoDate,
      status: mapTsdbStatus(e.strStatus),
      matchday: e.intRound ? Number(e.intRound) : undefined,
      venue: e.strVenue,
      homeTeam: {
        id: buildCompositeId(PROVIDER_NAME, e.idHomeTeam),
        name: e.strHomeTeam,
      },
      awayTeam: {
        id: buildCompositeId(PROVIDER_NAME, e.idAwayTeam),
        name: e.strAwayTeam,
      },
      source: PROVIDER_NAME,
    };
  }

  async getTeamForm(teamId: string, _leagueCode: string): Promise<TeamForm> {
    const nativeId = teamId.split(':').pop();

    return withRetry(
      () =>
        requestQueue.run(async () => {
          const { data } = await this.client.get('/eventslast.php', {
            params: { id: nativeId },
          });
          const events: TsdbEvent[] = (data.results ?? []).slice(0, 5);

          const lastResults: Array<'W' | 'D' | 'L'> = [];
          const goalsScored: number[] = [];
          const goalsConceded: number[] = [];

          for (const e of events) {
            const isHome = e.idHomeTeam === nativeId;
            const scored = Number(isHome ? e.intHomeScore : e.intAwayScore);
            const conceded = Number(isHome ? e.intAwayScore : e.intHomeScore);
            if (!Number.isNaN(scored)) goalsScored.push(scored);
            if (!Number.isNaN(conceded)) goalsConceded.push(conceded);

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
    const nativeHomeId = homeTeamId.split(':').pop();
    const nativeAwayId = awayTeamId.split(':').pop();

    // L'endpoint eventsh2h.php richiede una chiave premium (Patreon) su TheSportsDB;
    // con la chiave pubblica di test "3" risponde 404. Degradiamo con grazia
    // restituendo un H2H neutro invece di far fallire l'intero pronostico.
    try {
      return await withRetry(
        () =>
          requestQueue.run(async () => {
            const { data } = await this.client.get('/eventsh2h.php', {
              params: { team1: nativeHomeId, team2: nativeAwayId },
            });
            const events: TsdbEvent[] = data.event ?? [];

            let homeWins = 0;
            let draws = 0;
            let awayWins = 0;
            for (const e of events) {
              const homeGoals = Number(e.intHomeScore);
              const awayGoals = Number(e.intAwayScore);
              if (Number.isNaN(homeGoals) || Number.isNaN(awayGoals)) continue;

              const homeIsOurHome = e.idHomeTeam === nativeHomeId;
              if (homeGoals === awayGoals) draws++;
              else if ((homeGoals > awayGoals) === homeIsOurHome) homeWins++;
              else awayWins++;
            }

            return { totalMatches: events.length, homeWins, draws, awayWins };
          }),
        { maxRetries: env.httpMaxRetries }
      );
    } catch (err) {
      logger.warn('Impossibile calcolare H2H da TheSportsDB, uso valori neutri', err);
      return { totalMatches: 0, homeWins: 0, draws: 0, awayWins: 0 };
    }
  }
}
