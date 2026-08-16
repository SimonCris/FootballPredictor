import { Injectable } from '@angular/core';
import { MatchData, TeamStats } from '../models/football.model';

@Injectable({
  providedIn: 'root'
})
export class TeamAnalysisService {
  buildFeatureSummary(match: MatchData): { home: TeamStats; away: TeamStats; formDelta: number; xgDelta: number; goalsDelta: number } {
    const home = match.homeStats;
    const away = match.awayStats;

    return {
      home,
      away,
      formDelta: this.average(home.form) - this.average(away.form),
      xgDelta: home.xg - away.xg,
      goalsDelta: (home.goalsFor - home.goalsAgainst) - (away.goalsFor - away.goalsAgainst)
    };
  }

  private average(values: number[]): number {
    return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : 0;
  }
}
