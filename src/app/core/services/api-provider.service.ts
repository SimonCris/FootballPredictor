import { Injectable } from '@angular/core';
import { Observable, of, forkJoin } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class ApiProviderService {
  // OpenLigaDB is completely free, no API key required
  private readonly openLigaLeagues = [
    { name: 'Bundesliga', id: 'bl1', seasons: [2024, 2025] },
    { name: 'Serie A', id: 'sa', seasons: [2024, 2025] },
    { name: 'LaLiga', id: 'pd', seasons: [2024, 2025] },
    { name: 'Premier League', id: 'pl', seasons: [2024, 2025] },
    { name: 'Ligue 1', id: 'fl1', seasons: [2024, 2025] }
  ];

  loadLeagueFixtures(leagueName?: string): Observable<any> {
    return this.fetchFromOpenLigaDB(leagueName);
  }

  private fetchFromOpenLigaDB(leagueName?: string): Observable<any> {
    const selectedLeagues = leagueName
      ? this.openLigaLeagues.filter((league) => league.name.toLowerCase() === leagueName.toLowerCase())
      : this.openLigaLeagues;

    const leagueRequests = selectedLeagues.flatMap((league) =>
      league.seasons.map((season) => this.fetchLeagueMatches(league.name, league.id, season))
    );

    return forkJoin(leagueRequests).pipe(
      map((results) => {
        const allMatches = results.flat();
        const uniqueMatches = allMatches.filter((match: any, index: number, array: any[]) =>
          match?.matchID && array.findIndex((entry: any) => entry?.matchID === match.matchID) === index
        );
        return { events: uniqueMatches };
      }),
      catchError((error) => {
        console.error('Error fetching from OpenLigaDB:', error);
        return of({ events: [] });
      })
    );
  }

  private fetchLeagueMatches(leagueName: string, leagueId: string, season: number): Observable<any[]> {
    const url = `https://api.openligadb.de/getmatchdata/${leagueId}/${season}`;

    return this.fetchUrl(url).pipe(
      map((matches) =>
        Array.isArray(matches)
          ? matches.map((match: any) => ({
              ...match,
              strLeague: leagueName,
              competition: leagueName,
              leagueName: match.leagueName || leagueName
            }))
          : []
      )
    );
  }

  private fetchUrl(url: string): Observable<any> {
    return new Observable<any>((observer) => {
      fetch(url, { mode: 'cors' })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const data = await response.json();
          observer.next(Array.isArray(data) ? data : [data]);
          observer.complete();
        })
        .catch((error) => {
          console.warn(`Failed to fetch ${url}:`, error);
          observer.next([]);
          observer.complete();
        });
    });
  }
}
