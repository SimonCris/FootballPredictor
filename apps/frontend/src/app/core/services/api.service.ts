/**
 * Servizio HTTP centralizzato per comunicare con il backend REST.
 * Tutte le chiamate al backend passano da qui, cosicché eventuali cambi di
 * base URL o gestione errori vadano fatti in un unico posto.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { League, MatchdayResponse } from '../models/league.model';
import { MatchPredictionResponse, TopPredictionsResponse } from '../models/prediction.model';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = environment.apiBaseUrl;

  constructor(private readonly http: HttpClient) {}

  getLeagues(): Observable<League[]> {
    return this.http.get<League[]>(`${this.baseUrl}/leagues`);
  }

  getMatchday(leagueCode: string): Observable<MatchdayResponse> {
    return this.http.get<MatchdayResponse>(`${this.baseUrl}/matchday`, {
      params: { league: leagueCode },
    });
  }

  getMatchPrediction(matchId: string): Observable<MatchPredictionResponse> {
    return this.http.get<MatchPredictionResponse>(
      `${this.baseUrl}/match/${encodeURIComponent(matchId)}/predictions`
    );
  }

  getTopPredictions(n: number): Observable<TopPredictionsResponse> {
    return this.http.get<TopPredictionsResponse>(`${this.baseUrl}/top-predictions`, {
      params: { n: n.toString() },
    });
  }
}
