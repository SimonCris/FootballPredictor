/**
 * Servizio HTTP centralizzato per comunicare con il backend REST.
 * Tutte le chiamate al backend passano da qui, cosicché eventuali cambi di
 * base URL o gestione errori vadano fatti in un unico posto.
 *
 * Ogni endpoint è avvolto da `CacheService.getOrFetch`, che mantiene la
 * risposta in `sessionStorage` per la durata del TTL configurato in
 * `environment.cacheTtlMs`. Così, passando da una sezione all'altra
 * dell'app (es. home -> dettaglio partita -> top pronostici e ritorno), i
 * dati già recuperati vengono riletti dalla cache invece di rieseguire la
 * chiamata HTTP, riducendo il consumo di chiamate verso i provider esterni.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { League, MatchdayResponse } from '../models/league.model';
import { MatchPredictionResponse, TopPredictionsResponse } from '../models/prediction.model';
import { CacheService } from './cache.service';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = environment.apiBaseUrl;

  constructor(
    private readonly http: HttpClient,
    private readonly cache: CacheService
  ) {}

  /**
   * @param forceRefresh se `true`, ignora/invalida la cache e ripete la
   * chiamata al backend (usato dal pulsante "Aggiorna" esplicito dell'utente).
   */
  getLeagues(forceRefresh = false): Observable<League[]> {
    const key = 'leagues';
    if (forceRefresh) {
      this.cache.invalidate(key);
    }
    return this.cache.getOrFetch(key, environment.cacheTtlMs.leagues, () =>
      this.http.get<League[]>(`${this.baseUrl}/leagues`)
    );
  }

  getMatchday(leagueCode: string, forceRefresh = false): Observable<MatchdayResponse> {
    const key = `matchday:${leagueCode}`;
    if (forceRefresh) {
      this.cache.invalidate(key);
    }
    return this.cache.getOrFetch(key, environment.cacheTtlMs.matchday, () =>
      this.http.get<MatchdayResponse>(`${this.baseUrl}/matchday`, {
        params: { league: leagueCode },
      })
    );
  }

  getMatchPrediction(matchId: string, forceRefresh = false): Observable<MatchPredictionResponse> {
    const key = `prediction:${matchId}`;
    if (forceRefresh) {
      this.cache.invalidate(key);
    }
    return this.cache.getOrFetch(key, environment.cacheTtlMs.prediction, () =>
      this.http.get<MatchPredictionResponse>(
        `${this.baseUrl}/match/${encodeURIComponent(matchId)}/predictions`
      )
    );
  }

  getTopPredictions(n: number, forceRefresh = false): Observable<TopPredictionsResponse> {
    const key = `top-predictions:${n}`;
    if (forceRefresh) {
      this.cache.invalidate(key);
    }
    return this.cache.getOrFetch(key, environment.cacheTtlMs.topPredictions, () =>
      this.http.get<TopPredictionsResponse>(`${this.baseUrl}/top-predictions`, {
        params: { n: n.toString() },
      })
    );
  }

  /**
   * Forza il refresh di tutti i dati (es. pulsante "Aggiorna" esplicito
   * dell'utente), svuotando la cache lato FE così la prossima chiamata
   * torna a interrogare il backend.
   */
  clearCache(): void {
    this.cache.clearAll();
  }
}
