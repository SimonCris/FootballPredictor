import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { MatchData } from '../models/football.model';
import { ApiProviderService } from './api-provider.service';
import { NormalizerService } from './normalizer.service';

@Injectable({
  providedIn: 'root'
})
export class FootballDataService {
  constructor(
    private readonly apiProviderService: ApiProviderService,
    private readonly normalizerService: NormalizerService
  ) {}

  getMatches(leagueName?: string): Observable<MatchData[]> {
    return this.apiProviderService.loadLeagueFixtures(leagueName).pipe(
      catchError(() => of({ events: [] })),
      map((payload) => {
        const events = Array.isArray(payload?.events) ? payload.events : [];

        const hasMeaningfulData = events.length > 0 && events.some((event: any) => {
          const home = event?.Team1?.TeamName || event?.homeTeam || '';
          const away = event?.Team2?.TeamName || event?.awayTeam || '';
          const competition = event?.strLeague || event?.competition || '';
          return Boolean(home && away && competition && competition.toLowerCase() !== 'unknown');
        });

        if (hasMeaningfulData) {
          const normalized = events.map((event: any) => this.normalizerService.normalize(event));
          this.cacheMatches(normalized);
          return normalized;
        }

        console.warn('No meaningful data from real APIs');
        return [];
      })
    );
  }

  getLeagueMatches(leagueName: string): Observable<MatchData[]> {
    if (!leagueName || leagueName === 'All') {
      return this.getMatches();
    }

    return this.getMatches(leagueName);
  }

  private cacheMatches(matches: MatchData[]): void {
    localStorage.setItem('footballPredictor.matches', JSON.stringify(matches));
  }
}
