import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatchData, MatchPrediction } from '../../core/models/football.model';
import { BacktestService } from '../../core/services/backtest.service';
import { FootballDataService } from '../../core/services/football-data.service';
import { PredictionService } from '../../core/services/prediction.service';
import { TeamAnalysisService } from '../../core/services/team-analysis.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  matches: MatchData[] = [];
  predictions: MatchPrediction[] = [];
  filteredPredictions: MatchPrediction[] = [];
  nextRoundFixtures: MatchData[] = [];
  selectedPredictionId = '';
  selectedLeague = 'All';
  selectedForecastId = '';
  averageConfidence = 0;
  backtest = { total: 0, accuracy: 0, avgConfidence: 0 };
  competitions: string[] = [];
  selectedCompetition = 'All';
  marketOptions = ['all', 'homeWin', 'draw', 'awayWin', 'over25', 'under25'];
  selectedMarket = 'all';
  sortOptions = ['confidence', 'value', 'kickoff'];
  selectedSort = 'confidence';

  constructor(
    private readonly footballDataService: FootballDataService,
    private readonly predictionService: PredictionService,
    private readonly teamAnalysisService: TeamAnalysisService,
    private readonly backtestService: BacktestService,
    private readonly datePipe: DatePipe
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  get selectedPrediction(): MatchPrediction | undefined {
    return this.filteredPredictions.find((prediction) => prediction.id === this.selectedPredictionId)
      ?? this.filteredPredictions[0];
  }

  get selectedMatch(): MatchData | undefined {
    const selectedPrediction = this.selectedPrediction;
    if (!selectedPrediction) {
      return undefined;
    }

    return this.matches.find((match) => match.id === selectedPrediction.id);
  }

  get selectedForecastPreview(): MatchPrediction | undefined {
    return this.predictions.find((prediction) => prediction.id === this.selectedForecastId)
      ?? this.nextRoundFixtures
          .map((match) => this.predictionService.predictMatch(match))
          .find((prediction) => prediction.id === this.selectedForecastId);
  }

  get selectedForecastMatch(): MatchData | undefined {
    if (!this.selectedForecastId) {
      return undefined;
    }

    return this.matches.find((match) => match.id === this.selectedForecastId)
      ?? this.nextRoundFixtures.find((match) => match.id === this.selectedForecastId);
  }

  get featureSummary(): { home: any; away: any; formDelta: number; xgDelta: number; goalsDelta: number } | undefined {
    const selectedMatch = this.selectedMatch;
    if (!selectedMatch) {
      return undefined;
    }

    return this.teamAnalysisService.buildFeatureSummary(selectedMatch);
  }

  get forecastFeatureSummary(): { home: any; away: any; formDelta: number; xgDelta: number; goalsDelta: number } | undefined {
    const selectedMatch = this.selectedForecastMatch;
    if (!selectedMatch) {
      return undefined;
    }

    return this.teamAnalysisService.buildFeatureSummary(selectedMatch);
  }

  syncSelectedPrediction(): void {
    if (!this.filteredPredictions.length) {
      this.selectedPredictionId = '';
      return;
    }

    const exists = this.filteredPredictions.some((prediction) => prediction.id === this.selectedPredictionId);
    if (!exists) {
      this.selectedPredictionId = this.filteredPredictions[0].id;
    }
  }

  selectPrediction(predictionId: string): void {
    this.selectedPredictionId = predictionId;
  }

  openForecast(matchId: string): void {
    this.selectedForecastId = matchId;
  }

  searchRoundFixtures(): void {
    const leagueName = this.selectedLeague === 'All' ? undefined : this.selectedLeague;

    this.footballDataService.getLeagueMatches(leagueName ?? 'All').subscribe({
      next: (matches) => {
        this.matches = matches;
        this.predictions = matches.map((match) => this.predictionService.predictMatch(match));
        this.competitions = ['All', ...Array.from(new Set(matches.map((match) => match.competition)))];

        if (!this.competitions.includes(this.selectedLeague)) {
          this.selectedLeague = 'All';
        }

        const leagueMatches = this.selectedLeague === 'All'
          ? [...this.matches]
          : this.matches.filter((match) => match.competition === this.selectedLeague);

        if (!leagueMatches.length) {
          this.nextRoundFixtures = [];
          this.selectedForecastId = '';
          return;
        }

        const now = Date.now();
        const upcomingMatches = leagueMatches.filter((match) => new Date(match.kickoff).getTime() >= now - 60 * 60 * 1000);
        const sourceMatches = upcomingMatches.length ? upcomingMatches : leagueMatches;

        const roundGroups = new Map<string, MatchData[]>();
        sourceMatches.forEach((match) => {
          const roundKey = match.round || 'Round';
          const bucket = roundGroups.get(roundKey) ?? [];
          bucket.push(match);
          roundGroups.set(roundKey, bucket);
        });

        const nextRound = [...roundGroups.entries()]
          .sort(([, leftMatches], [, rightMatches]) => {
            const leftTime = new Date(leftMatches[0].kickoff).getTime();
            const rightTime = new Date(rightMatches[0].kickoff).getTime();
            return leftTime - rightTime;
          })
          .map(([, matches]) => matches)
          .at(0) ?? [];

        this.nextRoundFixtures = [...nextRound].sort((left, right) => new Date(left.kickoff).getTime() - new Date(right.kickoff).getTime());

        if (!this.nextRoundFixtures.some((match) => match.id === this.selectedForecastId)) {
          this.selectedForecastId = '';
        }

        this.applyCompetitionFilter();
        this.averageConfidence = Math.round(
          this.filteredPredictions.reduce((sum, item) => sum + item.confidence, 0) / Math.max(this.filteredPredictions.length, 1)
        );
        this.backtest = this.backtestService.evaluate(matches);
      },
      error: () => {
        this.matches = [];
        this.predictions = [];
        this.filteredPredictions = [];
        this.nextRoundFixtures = [];
        this.selectedPredictionId = '';
        this.selectedForecastId = '';
        this.competitions = ['All'];
        this.selectedCompetition = 'All';
        this.selectedLeague = 'All';
        this.averageConfidence = 0;
        this.backtest = { total: 0, accuracy: 0, avgConfidence: 0 };
      }
    });
  }

  loadData(): void {
    this.footballDataService.getMatches().subscribe({
      next: (matches) => {
        this.matches = matches;
        this.predictions = matches.map((match) => this.predictionService.predictMatch(match));
        this.competitions = ['All', ...Array.from(new Set(matches.map((match) => match.competition)))];
        if (!this.competitions.includes(this.selectedLeague)) {
          this.selectedLeague = 'All';
        }
        this.applyCompetitionFilter();
        this.searchRoundFixtures();
        this.averageConfidence = Math.round(
          this.filteredPredictions.reduce((sum, item) => sum + item.confidence, 0) / Math.max(this.filteredPredictions.length, 1)
        );

        this.backtest = this.backtestService.evaluate(matches);
      },
      error: () => {
        this.matches = [];
        this.predictions = [];
        this.filteredPredictions = [];
        this.nextRoundFixtures = [];
        this.selectedPredictionId = '';
        this.selectedForecastId = '';
        this.competitions = ['All'];
        this.selectedCompetition = 'All';
        this.selectedLeague = 'All';
        this.averageConfidence = 0;
        this.backtest = { total: 0, accuracy: 0, avgConfidence: 0 };
      }
    });
  }

  applyCompetitionFilter(): void {
    this.filteredPredictions = this.selectedCompetition === 'All'
      ? [...this.predictions]
      : this.predictions.filter((prediction) => prediction.competition === this.selectedCompetition);

    this.applyMarketFilter();
    this.syncSelectedPrediction();
  }

  applyMarketFilter(): void {
    const source = this.selectedCompetition === 'All'
      ? [...this.predictions]
      : this.predictions.filter((prediction) => prediction.competition === this.selectedCompetition);

    this.filteredPredictions = source.filter((prediction) => {
      if (this.selectedMarket === 'all') {
        return true;
      }

      const marketScore = this.getMarketScore(prediction, this.selectedMarket);
      return marketScore > 0;
    });

    this.sortPredictions();
    this.syncSelectedPrediction();
  }

  sortPredictions(): void {
    this.filteredPredictions = [...this.filteredPredictions].sort((a, b) => {
      switch (this.selectedSort) {
        case 'value': {
          const valueA = this.getMarketScore(a, this.selectedMarket === 'all' ? 'homeWin' : this.selectedMarket);
          const valueB = this.getMarketScore(b, this.selectedMarket === 'all' ? 'homeWin' : this.selectedMarket);
          return valueB - valueA || b.confidence - a.confidence;
        }
        case 'kickoff':
          return new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime();
        case 'confidence':
        default:
          return b.confidence - a.confidence || this.getMarketScore(b, this.selectedMarket === 'all' ? 'homeWin' : this.selectedMarket) - this.getMarketScore(a, this.selectedMarket === 'all' ? 'homeWin' : this.selectedMarket);
      }
    });
  }

  onSortChange(): void {
    this.sortPredictions();
    this.syncSelectedPrediction();
  }

  getMarketScore(prediction: MatchPrediction, market: string): number {
    switch (market) {
      case 'homeWin':
        return prediction.homeWin;
      case 'draw':
        return prediction.draw;
      case 'awayWin':
        return prediction.awayWin;
      case 'over25':
        return prediction.over25;
      case 'under25':
        return prediction.under25;
      default:
        return prediction.confidence / 100;
    }
  }

  get topPicks(): MatchPrediction[] {
    return this.filteredPredictions.slice(0, 3);
  }

  get valueBets(): Array<{ match: string; market: string; probability: number; odds: number; edge: number; expectedValue: number }> {
    return this.filteredPredictions
      .flatMap((prediction) => {
        const entries = [
          { key: 'homeWin', value: prediction.homeWin, odds: 1 / Math.max(0.12, prediction.homeWin) },
          { key: 'draw', value: prediction.draw, odds: 1 / Math.max(0.12, prediction.draw) },
          { key: 'awayWin', value: prediction.awayWin, odds: 1 / Math.max(0.12, prediction.awayWin) },
          { key: 'over25', value: prediction.over25, odds: 1 / Math.max(0.16, prediction.over25) },
          { key: 'under25', value: prediction.under25, odds: 1 / Math.max(0.16, prediction.under25) }
        ];

        return entries
          .filter((entry) => entry.value >= 0.28)
          .map((entry) => {
            const probability = entry.value;
            const odds = Number((entry.odds * 1.08).toFixed(2));
            const expectedValue = Number(((probability * odds) - 1).toFixed(3));
            return {
              match: `${prediction.homeTeam} vs ${prediction.awayTeam}`,
              market: entry.key,
              probability: Number((probability * 100).toFixed(1)),
              odds,
              edge: Number(((probability * odds - 1) * 100).toFixed(1)),
              expectedValue
            };
          });
      })
      .sort((a, b) => b.expectedValue - a.expectedValue)
      .slice(0, 6);
  }

  get primaryPick(): MatchPrediction | undefined {
    return this.filteredPredictions[0];
  }

  get teamAnalytics(): Array<{ name: string; form: number; xg: number; xga: number; possession: number; trend: number; rating: number }> {
    const teams = new Map<string, { name: string; form: number[]; xg: number; xga: number; possession: number; trend: number; rating: number }>();

    this.matches.forEach((match) => {
      ['home', 'away'].forEach((side) => {
        const stats = side === 'home' ? match.homeStats : match.awayStats;
        const existing = teams.get(stats.name) ?? {
          name: stats.name,
          form: [],
          xg: 0,
          xga: 0,
          possession: 0,
          trend: 0,
          rating: 0
        };

        existing.form.push(...stats.form);
        existing.xg += stats.xg;
        existing.xga += stats.xga;
        existing.possession += stats.possession;
        existing.trend += stats.recentTrend;
        teams.set(stats.name, existing);
      });
    });

    return Array.from(teams.values())
      .map((team) => ({
        name: team.name,
        form: team.form.length ? team.form.reduce((sum, value) => sum + value, 0) / team.form.length : 0,
        xg: Number((team.xg / Math.max(1, this.matches.length)).toFixed(2)),
        xga: Number((team.xga / Math.max(1, this.matches.length)).toFixed(2)),
        possession: Number((team.possession / Math.max(1, this.matches.length * 2)).toFixed(1)),
        trend: Number((team.trend / Math.max(1, this.matches.length)).toFixed(1)),
        rating: Number(((team.xg - team.xga) * 18 + (team.form.length ? team.form.reduce((sum, value) => sum + value, 0) / team.form.length : 0) * 8 + (team.possession / Math.max(1, this.matches.length * 2)) * 0.6).toFixed(1))
      }))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 6);
  }

  getProbabilityBars(prediction?: MatchPrediction): Array<{ label: string; value: number; color: string }> {
    if (!prediction) {
      return [];
    }

    return [
      { label: '1', value: prediction.homeWin * 100, color: 'home' },
      { label: 'X', value: prediction.draw * 100, color: 'draw' },
      { label: '2', value: prediction.awayWin * 100, color: 'away' }
    ];
  }

  getQuoteRows(prediction?: MatchPrediction): Array<{ label: string; probability: number; odds: number; implied: number; edge: number }> {
    if (!prediction) {
      return [];
    }

    const rows = [
      { label: '1', probability: prediction.homeWin, odds: 1 / Math.max(0.05, prediction.homeWin), implied: prediction.homeWin, edge: (1 / Math.max(0.05, prediction.homeWin) * prediction.homeWin) - 1 },
      { label: 'X', probability: prediction.draw, odds: 1 / Math.max(0.05, prediction.draw), implied: prediction.draw, edge: (1 / Math.max(0.05, prediction.draw) * prediction.draw) - 1 },
      { label: '2', probability: prediction.awayWin, odds: 1 / Math.max(0.05, prediction.awayWin), implied: prediction.awayWin, edge: (1 / Math.max(0.05, prediction.awayWin) * prediction.awayWin) - 1 }
    ];

    return rows.map((row) => ({
      ...row,
      probability: Number((row.probability * 100).toFixed(1)),
      odds: Number(row.odds.toFixed(2)),
      implied: Number((row.implied * 100).toFixed(1)),
      edge: Number((row.edge * 100).toFixed(1))
    }));
  }

  formatDate(date: string): string {
    return this.datePipe.transform(date, 'dd MMM yyyy, HH:mm') ?? date;
  }
}
