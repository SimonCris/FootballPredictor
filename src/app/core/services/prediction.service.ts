import { Injectable } from '@angular/core';
import { MatchData, MatchPrediction } from '../models/football.model';

@Injectable({
  providedIn: 'root'
})
export class PredictionService {
  predictMatch(match: MatchData): MatchPrediction {
    const home = match.homeStats;
    const away = match.awayStats;

    const homeForm = this.average(home.form);
    const awayForm = this.average(away.form);
    const homeAttack = home.goalsFor / Math.max(1, away.goalsAgainst + 1);
    const awayAttack = away.goalsFor / Math.max(1, home.goalsAgainst + 1);
    const homeDefense = 1 / Math.max(1, home.goalsAgainst);
    const awayDefense = 1 / Math.max(1, away.goalsAgainst);
    const homeXg = home.xg - home.xga + home.recentTrend;
    const awayXg = away.xg - away.xga + away.recentTrend;

    const homeRawScore =
      homeForm * 22 +
      homeAttack * 20 +
      homeDefense * 16 +
      homeXg * 12 +
      home.homeForm * 8 +
      home.possession * 0.18;

    const awayRawScore =
      awayForm * 22 +
      awayAttack * 20 +
      awayDefense * 16 +
      awayXg * 12 +
      away.awayForm * 8 +
      away.possession * 0.18;

    const totalPower = homeRawScore + awayRawScore;
    const homeWin = Math.min(0.68, Math.max(0.24, (homeRawScore / totalPower) * 0.72 + 0.18));
    const awayWin = Math.min(0.52, Math.max(0.14, (awayRawScore / totalPower) * 0.62 + 0.12));
    const draw = Math.max(0.12, 1 - homeWin - awayWin);

    const normalizedHome = Math.min(0.65, Math.max(0.15, homeWin));
    const normalizedAway = Math.min(0.55, Math.max(0.1, awayWin));
    const normalizedDraw = Math.max(0.12, 1 - normalizedHome - normalizedAway);

    const drawProb = normalizedDraw;
    const homeProb = normalizedHome;
    const awayProb = Math.max(0.1, 1 - homeProb - drawProb);

    const over25 = Math.min(0.7, Math.max(0.28, ((home.xg + away.xg) / 4) * 0.32 + 0.38));
    const under25 = 1 - over25;
    const confidence = Math.min(92, Math.max(52, Math.round((homeProb * 60 + drawProb * 20 + awayProb * 20 + ((home.xg + away.xg) / 2) * 9) * 1.2)));

    return {
      id: match.id,
      competition: match.competition,
      round: match.round,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoff: match.kickoff,
      venue: match.venue,
      homeWin: Number(homeProb.toFixed(2)),
      draw: Number(drawProb.toFixed(2)),
      awayWin: Number(awayProb.toFixed(2)),
      over25: Number(over25.toFixed(2)),
      under25: Number(under25.toFixed(2)),
      confidence,
      reason: [
        `${match.homeTeam} totalizza ${(homeForm + home.recentTrend).toFixed(1)} punti forma`,
        `${match.awayTeam} presenta xG medio di ${(away.xg).toFixed(2)} e xGA ${(away.xga).toFixed(2)}`,
        `Home/away trend: ${home.homeForm.toFixed(1)} / ${away.awayForm.toFixed(1)}`
      ]
    };
  }

  private average(values: number[]): number {
    return values.reduce((sum, current) => sum + current, 0) / values.length;
  }
}
