import { Injectable } from '@angular/core';
import { MatchData, TeamStats } from '../models/football.model';

@Injectable({
  providedIn: 'root'
})
export class NormalizerService {
  normalize(rawMatch: any): MatchData {
    const homeTeamData = rawMatch.team1 ?? rawMatch.Team1 ?? {};
    const awayTeamData = rawMatch.team2 ?? rawMatch.Team2 ?? {};

    const homeTeamName = homeTeamData.teamName ?? homeTeamData.TeamName ?? rawMatch.homeTeam ?? rawMatch.home_team ?? 'Home';
    const awayTeamName = awayTeamData.teamName ?? awayTeamData.TeamName ?? rawMatch.awayTeam ?? rawMatch.away_team ?? 'Away';

    let homeGoals = 0;
    let awayGoals = 0;

    const matchResults = Array.isArray(rawMatch.matchResults)
      ? rawMatch.matchResults
      : Array.isArray(rawMatch.MatchResults)
        ? rawMatch.MatchResults
        : [];

    const finalResult = matchResults.find((result: any) =>
      result?.resultTypeID === 1 || result?.ResultTypeID === 1 || result?.resultTypeId === 1
    );

    if (finalResult) {
      homeGoals = Number(finalResult.pointsTeam1 ?? finalResult.PointsTeam1 ?? finalResult.goalsTeam1 ?? finalResult.GoalsTeam1 ?? 0);
      awayGoals = Number(finalResult.pointsTeam2 ?? finalResult.PointsTeam2 ?? finalResult.goalsTeam2 ?? finalResult.GoalsTeam2 ?? 0);
    } else if (rawMatch.goals) {
      homeGoals = Number(rawMatch.goals.goalsTeam1 ?? rawMatch.goals.GoalsTeam1 ?? 0);
      awayGoals = Number(rawMatch.goals.goalsTeam2 ?? rawMatch.goals.GoalsTeam2 ?? 0);
    }

    const home = this.mapTeam(homeTeamName, homeTeamData.teamId ?? homeTeamData.TeamId ?? 1);
    const away = this.mapTeam(awayTeamName, awayTeamData.teamId ?? awayTeamData.TeamId ?? 2);

    return {
      id: String(rawMatch.matchID ?? rawMatch.MatchID ?? rawMatch.id ?? `${Date.now()}`),
      competition: rawMatch.strLeague || rawMatch.competition || rawMatch.leagueName || 'Unknown',
      round: rawMatch.group?.groupName || rawMatch.Group?.GroupName || rawMatch.round || 'N/A',
      homeTeam: homeTeamName,
      awayTeam: awayTeamName,
      kickoff: rawMatch.matchDateTime || rawMatch.MatchDateTime || rawMatch.kickoff || new Date().toISOString(),
      venue: rawMatch.location || rawMatch.Location || rawMatch.venue || 'Unknown venue',
      source: 'openligadb',
      homeStats: { ...home, goalsFor: homeGoals, goalsAgainst: awayGoals },
      awayStats: { ...away, goalsFor: awayGoals, goalsAgainst: homeGoals }
    };
  }

  private mapTeam(teamName: string, teamId: number): TeamStats {
    return {
      teamId: String(teamId),
      name: teamName,
      shortName: teamName.substring(0, 3).toUpperCase(),
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      form: [1, 1, 1, 1],
      xg: 1.5,
      xga: 1.2,
      shots: 12,
      shotsOnTarget: 5,
      possession: 50,
      passAccuracy: 80,
      homeForm: 1.5,
      awayForm: 1.3,
      injuries: 0,
      recentTrend: 0
    };
  }
}
