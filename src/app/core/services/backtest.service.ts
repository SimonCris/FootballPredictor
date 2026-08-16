import { Injectable } from '@angular/core';
import { MatchData, MatchPrediction } from '../models/football.model';
import { PredictionService } from './prediction.service';

@Injectable({
  providedIn: 'root'
})
export class BacktestService {
  constructor(private readonly predictionService: PredictionService) {}

  evaluate(matches: MatchData[]): { total: number; accuracy: number; avgConfidence: number } {
    if (!matches.length) {
      return { total: 0, accuracy: 0, avgConfidence: 0 };
    }

    const predictions = matches.map((match) => this.predictionService.predictMatch(match));
    const avgConfidence = predictions.reduce((sum, item) => sum + item.confidence, 0) / predictions.length;
    const accuracy = predictions.reduce((sum, item) => sum + item.homeWin, 0) / predictions.length;

    return {
      total: predictions.length,
      accuracy: Number((accuracy * 100).toFixed(2)),
      avgConfidence: Number(avgConfidence.toFixed(2))
    };
  }
}
