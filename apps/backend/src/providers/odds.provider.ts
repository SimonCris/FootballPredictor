/**
 * Provider di arricchimento (non fa parte del fallback MatchProvider):
 * The Odds API (https://the-odds-api.com/) — piano free gratuito con 500
 * richieste/mese, richiede solo una registrazione via email (nessuna carta
 * di credito). Fornisce le quote reali aggregate da molti bookmaker per il
 * mercato 1X2 (h2h) delle partite di calcio.
 *
 * Usato dal motore pronostici come segnale aggiuntivo per "correggere" le
 * probabilità puramente statistiche verso il consenso reale del mercato
 * delle scommesse (vedi services/prediction.service.ts).
 *
 * CHANGE_ME: registrarsi su https://the-odds-api.com/ e impostare
 * ODDS_API_KEY in apps/backend/.env. Se non configurata, l'arricchimento
 * viene semplicemente saltato (nessun errore, il motore usa solo il modello
 * statistico).
 */
import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import { League, MarketOdds, Team } from '../types/domain';
import { normalizeTeamName, teamNamesMatch } from '../utils/normalize';
import { withRetry } from '../utils/http-retry';
import { logger } from '../utils/logger';
import { RequestQueue } from '../utils/request-queue';
import { getOrSetCache } from '../services/cache.service';

const PROVIDER_NAME = 'the-odds-api';

// Piano free: 500 richieste/mese. Serializziamo comunque le chiamate per
// evitare burst e restare ben all'interno di qualunque limite per-minuto.
const requestQueue = new RequestQueue(1, 1000);

interface OddsApiOutcome {
  name: string; // nome squadra (o "Draw")
  price: number; // quota decimale
}

interface OddsApiMarket {
  key: string; // "h2h"
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: OddsApiMarket[];
}

interface OddsApiEvent {
  id: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

/** Normalizza nome completo e shortName di una squadra, senza duplicati. */
function uniqueNormalized(...names: (string | undefined)[]): string[] {
  const normalized = names.filter(Boolean).map((n) => normalizeTeamName(n as string));
  return Array.from(new Set(normalized)).filter((n) => n.length > 0);
}

class OddsProvider {
  name = PROVIDER_NAME;
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: env.oddsApiBaseUrl,
      timeout: env.httpTimeoutMs,
    });
  }

  /** Recupera e mette in cache tutti gli eventi con quote per un campionato. */
  private async fetchLeagueOdds(league: League): Promise<OddsApiEvent[]> {
    const sportKey = league.providerIds.oddsApi;
    if (!sportKey) return [];

    const cacheKey = `odds:${league.code}`;
    return getOrSetCache(cacheKey, env.cacheTtlOdds, () =>
      withRetry(
        () =>
          requestQueue.run(async () => {
            const { data } = await this.client.get(`/sports/${sportKey}/odds`, {
              params: {
                apiKey: env.oddsApiKey,
                regions: 'eu,uk',
                markets: 'h2h',
                oddsFormat: 'decimal',
              },
            });
            return (data ?? []) as OddsApiEvent[];
          }),
        { maxRetries: env.httpMaxRetries }
      )
    );
  }

  /**
   * Trova le quote 1X2 di mercato per una specifica partita, abbinando le
   * squadre per nome normalizzato (The Odds API non condivide gli stessi id
   * squadra di football-data.org/TheSportsDB).
   */
  async getMatchOdds(
    league: League,
    homeTeam: Team,
    awayTeam: Team
  ): Promise<MarketOdds | undefined> {
    if (!env.isOddsApiConfigured || !league.providerIds.oddsApi) return undefined;

    try {
      const events = await this.fetchLeagueOdds(league);

      // Ogni provider può usare nomi diversi per la stessa squadra (nome
      // completo ufficiale vs nome comune): proviamo il match sia sul nome
      // completo sia sullo shortName, con confronto "per contenimento"
      // (vedi teamNamesMatch) per gestire casi come "FC Internazionale
      // Milano" (football-data) vs "Inter Milan" (The Odds API).
      const homeCandidates = uniqueNormalized(homeTeam.name, homeTeam.shortName);
      const awayCandidates = uniqueNormalized(awayTeam.name, awayTeam.shortName);

      const matchesTeam = (oddsName: string, candidates: string[]) => {
        const normalizedOddsName = normalizeTeamName(oddsName);
        return candidates.some((candidate) => teamNamesMatch(candidate, normalizedOddsName));
      };

      const event = events.find(
        (e) => matchesTeam(e.home_team, homeCandidates) && matchesTeam(e.away_team, awayCandidates)
      );
      if (!event || event.bookmakers.length === 0) {
        logger.warn(
          `Nessuna quota di mercato trovata su ${PROVIDER_NAME} per ${homeTeam.name} vs ${awayTeam.name} (nessun evento con nomi squadra corrispondenti)`
        );
        return undefined;
      }

      // Media delle quote decimali di tutti i bookmaker che offrono il mercato h2h.
      const homeOdds: number[] = [];
      const drawOdds: number[] = [];
      const awayOdds: number[] = [];

      for (const bookmaker of event.bookmakers) {
        const h2hMarket = bookmaker.markets.find((m) => m.key === 'h2h');
        if (!h2hMarket) continue;

        for (const outcome of h2hMarket.outcomes) {
          if (matchesTeam(outcome.name, homeCandidates)) homeOdds.push(outcome.price);
          else if (matchesTeam(outcome.name, awayCandidates)) awayOdds.push(outcome.price);
          else if (outcome.name.toLowerCase() === 'draw') drawOdds.push(outcome.price);
        }
      }

      if (homeOdds.length === 0 || drawOdds.length === 0 || awayOdds.length === 0) {
        return undefined;
      }

      const avg = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
      const averageOdds = {
        home: avg(homeOdds),
        draw: avg(drawOdds),
        away: avg(awayOdds),
      };

      // Le quote dei bookmaker includono il margine (overround): le probabilità
      // implicite grezze (1/quota) sommano a più di 100%. Le "de-vigghiamo"
      // (rimuoviamo il margine) normalizzando affinché sommino esattamente a 1,
      // ottenendo così probabilità di mercato pure e confrontabili con quelle
      // del nostro modello statistico.
      const rawImplied = {
        home: 1 / averageOdds.home,
        draw: 1 / averageOdds.draw,
        away: 1 / averageOdds.away,
      };
      const totalImplied = rawImplied.home + rawImplied.draw + rawImplied.away;

      return {
        source: PROVIDER_NAME,
        bookmakersCount: event.bookmakers.length,
        averageOdds: {
          home: Math.round(averageOdds.home * 100) / 100,
          draw: Math.round(averageOdds.draw * 100) / 100,
          away: Math.round(averageOdds.away * 100) / 100,
        },
        impliedProbabilities: {
          home: rawImplied.home / totalImplied,
          draw: rawImplied.draw / totalImplied,
          away: rawImplied.away / totalImplied,
        },
      };
    } catch (err) {
      // L'arricchimento con le quote di mercato è opzionale: qualunque
      // errore (rate limit del piano free, partita non ancora quotata, ecc.)
      // viene loggato e ignorato, senza far fallire il calcolo del pronostico.
      logger.warn(
        `Impossibile recuperare le quote di mercato da ${PROVIDER_NAME} per ${homeTeam.name} vs ${awayTeam.name}`,
        err instanceof Error ? err.message : err
      );
      return undefined;
    }
  }
}

export const oddsProvider = new OddsProvider();
