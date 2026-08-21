/**
 * Provider di arricchimento (non fa parte del fallback MatchProvider):
 * The Odds API (https://the-odds-api.com/) — piano free gratuito con 500
 * richieste/mese, richiede solo una registrazione via email (nessuna carta
 * di credito). Fornisce le quote reali aggregate da molti bookmaker per tre
 * mercati calcistici disponibili gratuitamente:
 *  - h2h (1X2)
 *  - totals (Over/Under, con linea gol es. 2.5)
 *  - spreads (handicap asiatico, con linea es. -1.5)
 *
 * NOTA IMPORTANTE (verificato in live contro l'API reale): i mercati "btts"
 * (Both Teams To Score) e "double_chance" NON sono mercati validi per The
 * Odds API (la richiesta viene rifiutata con errore INVALID_MARKET) e non
 * risultano disponibili gratuitamente presso nessun provider di quote reali
 * conosciuto. Per questo motivo il motore pronostici li CALCOLA
 * matematicamente a partire dalle probabilità 1X2 e dal modello di Poisson
 * (vedi services/prediction.service.ts), invece di tentare di recuperarli
 * da un mercato bookmaker inesistente.
 *
 * Ogni mercato viene richiesto in modo indipendente e degradato con
 * grazia: se un bookmaker non offre un determinato mercato per una
 * partita, quel mercato viene semplicemente omesso dal risultato, senza
 * generare errori.
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
import { AsianHandicapMarketOdds, League, MarketOdds, OverUnderMarketOdds, Team } from '../types/domain';
import { normalizeTeamName, teamNamesMatch } from '../utils/normalize';
import { withRetry } from '../utils/http-retry';
import { logger } from '../utils/logger';
import { RequestQueue } from '../utils/request-queue';
import { getOrSetCache } from '../services/cache.service';

const PROVIDER_NAME = 'the-odds-api';

// Piano free: 500 richieste/mese. Serializziamo comunque le chiamate per
// evitare burst e restare ben all'interno di qualunque limite per-minuto.
const requestQueue = new RequestQueue(1, 1000);

// Linea Over/Under target: quando un bookmaker offre più linee (2.0, 2.5, 3.0...),
// scegliamo quella più vicina a questo valore standard.
const TARGET_TOTALS_LINE = 2.5;

interface OddsApiOutcome {
  name: string; // nome squadra, "Draw", "Over" o "Under"
  price: number; // quota decimale
  /** Linea gol (per "totals") o handicap (per "spreads"), assente per "h2h". */
  point?: number;
}

interface OddsApiMarket {
  key: string; // "h2h" | "totals" | "spreads"
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
                // h2h (1X2) + totals (Over/Under) + spreads (handicap asiatico):
                // tutti e tre confermati disponibili gratuitamente per il calcio
                // sul piano free di The Odds API. "btts" e "double_chance" NON
                // sono richiedibili (l'API risponde con INVALID_MARKET), quindi
                // non vengono richiesti qui: vengono derivati matematicamente
                // nel motore pronostici.
                markets: 'h2h,totals,spreads',
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
        totals: this.extractTotalsMarket(event),
        spreads: this.extractSpreadsMarket(event, homeCandidates, awayCandidates, matchesTeam),
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

  /**
   * Estrae il mercato Over/Under aggregato ("totals") da un evento The Odds
   * API. Ogni bookmaker può offrire più linee gol (2.0, 2.5, 3.0...): per
   * ciascun bookmaker scegliamo la linea più vicina a 2.5 (standard del
   * settore), poi mediamo le quote Over/Under di quella linea tra tutti i
   * bookmaker che la offrono. Se nessun bookmaker offre questo mercato per
   * la partita, ritorna undefined senza errori (degradazione elegante).
   */
  private extractTotalsMarket(event: OddsApiEvent): OverUnderMarketOdds | undefined {
    // Per ogni bookmaker, individua la linea "totals" più vicina a 2.5.
    const perBookmakerPick: Array<{ line: number; over: number; under: number }> = [];

    for (const bookmaker of event.bookmakers) {
      const totalsMarket = bookmaker.markets.find((m) => m.key === 'totals');
      if (!totalsMarket) continue;

      // Raggruppa gli outcome per linea (point), tenendo la linea più vicina a 2.5.
      const linesSeen = new Map<number, { over?: number; under?: number }>();
      for (const outcome of totalsMarket.outcomes) {
        if (outcome.point === undefined) continue;
        const entry = linesSeen.get(outcome.point) ?? {};
        if (outcome.name.toLowerCase() === 'over') entry.over = outcome.price;
        else if (outcome.name.toLowerCase() === 'under') entry.under = outcome.price;
        linesSeen.set(outcome.point, entry);
      }

      let bestLine: number | undefined;
      let bestDistance = Infinity;
      for (const [line, { over, under }] of linesSeen) {
        if (over === undefined || under === undefined) continue;
        const distance = Math.abs(line - TARGET_TOTALS_LINE);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLine = line;
        }
      }
      if (bestLine === undefined) continue;
      const picked = linesSeen.get(bestLine)!;
      perBookmakerPick.push({ line: bestLine, over: picked.over!, under: picked.under! });
    }

    if (perBookmakerPick.length === 0) return undefined;

    // Usiamo la linea più comune tra i bookmaker (tipicamente 2.5) e mediamo
    // solo le quote di quella linea, per evitare di mescolare linee diverse.
    const lineFrequency = new Map<number, number>();
    perBookmakerPick.forEach(({ line }) => lineFrequency.set(line, (lineFrequency.get(line) ?? 0) + 1));
    const mostCommonLine = [...lineFrequency.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const matching = perBookmakerPick.filter((p) => p.line === mostCommonLine);

    const avg = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
    const averageOdds = {
      over: avg(matching.map((m) => m.over)),
      under: avg(matching.map((m) => m.under)),
    };
    const rawImplied = { over: 1 / averageOdds.over, under: 1 / averageOdds.under };
    const totalImplied = rawImplied.over + rawImplied.under;

    return {
      line: mostCommonLine,
      bookmakersCount: matching.length,
      averageOdds: {
        over: Math.round(averageOdds.over * 100) / 100,
        under: Math.round(averageOdds.under * 100) / 100,
      },
      impliedProbabilities: {
        over: rawImplied.over / totalImplied,
        under: rawImplied.under / totalImplied,
      },
    };
  }

  /**
   * Estrae il mercato handicap asiatico aggregato ("spreads"), riferito alla
   * squadra di casa. Analogamente ai totals, ogni bookmaker può offrire più
   * linee: scegliamo per ciascuno la linea più vicina a 0 (equilibrata),
   * poi mediamo tra i bookmaker che offrono quella stessa linea. Se nessun
   * bookmaker offre questo mercato, ritorna undefined senza errori.
   */
  private extractSpreadsMarket(
    event: OddsApiEvent,
    homeCandidates: string[],
    awayCandidates: string[],
    matchesTeam: (oddsName: string, candidates: string[]) => boolean
  ): AsianHandicapMarketOdds | undefined {
    const perBookmakerPick: Array<{ line: number; home: number; away: number }> = [];

    for (const bookmaker of event.bookmakers) {
      const spreadsMarket = bookmaker.markets.find((m) => m.key === 'spreads');
      if (!spreadsMarket) continue;

      // La linea handicap è espressa "per squadra" (point della casa è
      // l'opposto del point della trasferta): raggruppiamo per il valore
      // assoluto della linea vista dal lato casa.
      const linesSeen = new Map<number, { home?: number; away?: number }>();
      for (const outcome of spreadsMarket.outcomes) {
        if (outcome.point === undefined) continue;
        const isHome = matchesTeam(outcome.name, homeCandidates);
        const isAway = !isHome && matchesTeam(outcome.name, awayCandidates);
        if (!isHome && !isAway) continue;
        // Normalizziamo la chiave della linea sul punto di vista "casa".
        const homeLine = isHome ? outcome.point : -outcome.point;
        const entry = linesSeen.get(homeLine) ?? {};
        if (isHome) entry.home = outcome.price;
        else entry.away = outcome.price;
        linesSeen.set(homeLine, entry);
      }

      let bestLine: number | undefined;
      let bestDistance = Infinity;
      for (const [line, { home, away }] of linesSeen) {
        if (home === undefined || away === undefined) continue;
        const distance = Math.abs(line);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLine = line;
        }
      }
      if (bestLine === undefined) continue;
      const picked = linesSeen.get(bestLine)!;
      perBookmakerPick.push({ line: bestLine, home: picked.home!, away: picked.away! });
    }

    if (perBookmakerPick.length === 0) return undefined;

    const lineFrequency = new Map<number, number>();
    perBookmakerPick.forEach(({ line }) => lineFrequency.set(line, (lineFrequency.get(line) ?? 0) + 1));
    const mostCommonLine = [...lineFrequency.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const matching = perBookmakerPick.filter((p) => p.line === mostCommonLine);

    const avg = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
    const averageOdds = {
      home: avg(matching.map((m) => m.home)),
      away: avg(matching.map((m) => m.away)),
    };
    const rawImplied = { home: 1 / averageOdds.home, away: 1 / averageOdds.away };
    const totalImplied = rawImplied.home + rawImplied.away;

    return {
      line: mostCommonLine,
      bookmakersCount: matching.length,
      averageOdds: {
        home: Math.round(averageOdds.home * 100) / 100,
        away: Math.round(averageOdds.away * 100) / 100,
      },
      impliedProbabilities: {
        home: rawImplied.home / totalImplied,
        away: rawImplied.away / totalImplied,
      },
    };
  }
}

export const oddsProvider = new OddsProvider();
