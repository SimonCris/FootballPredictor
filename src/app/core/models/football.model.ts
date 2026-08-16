export interface TeamStats {
  teamId: string;
  name: string;
  shortName: string;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  form: number[];
  xg: number;
  xga: number;
  shots: number;
  shotsOnTarget: number;
  possession: number;
  passAccuracy: number;
  homeForm: number;
  awayForm: number;
  injuries: number;
  recentTrend: number;
}

export interface MatchData {
  id: string;
  competition: string;
  round: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  venue: string;
  homeStats: TeamStats;
  awayStats: TeamStats;
  source: string;
}

export interface MatchPrediction {
  id: string;
  competition: string;
  round: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  venue: string;
  homeWin: number;
  draw: number;
  awayWin: number;
  over25: number;
  under25: number;
  confidence: number;
  reason: string[];
}
