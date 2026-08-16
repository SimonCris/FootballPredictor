import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should keep the full match slate while tracking a selected match', () => {
    component.predictions = [
      {
        id: 'm-1',
        competition: 'Serie A',
        round: 'Giornata 1',
        homeTeam: 'Juventus',
        awayTeam: 'Inter',
        kickoff: '2026-08-18T20:45:00Z',
        venue: 'Allianz Stadium',
        homeWin: 0.45,
        draw: 0.28,
        awayWin: 0.27,
        over25: 0.58,
        under25: 0.42,
        confidence: 72,
        reason: ['test']
      },
      {
        id: 'm-2',
        competition: 'Premier League',
        round: 'Round 1',
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea',
        kickoff: '2026-08-19T18:00:00Z',
        venue: 'Emirates',
        homeWin: 0.52,
        draw: 0.23,
        awayWin: 0.25,
        over25: 0.61,
        under25: 0.39,
        confidence: 69,
        reason: ['test']
      }
    ];
    component.filteredPredictions = [...component.predictions];
    component.selectedPredictionId = 'm-2';
    component.syncSelectedPrediction();

    expect(component.selectedPrediction?.id).toBe('m-2');
    expect(component.filteredPredictions.length).toBe(2);
  });

  it('should search the next round fixtures for a selected league and expose the selected forecast detail', () => {
    component.matches = [
      {
        id: 'match-1',
        competition: 'Serie A',
        round: 'Giornata 1',
        homeTeam: 'Juventus',
        awayTeam: 'Inter',
        kickoff: '2026-08-18T20:45:00Z',
        venue: 'Allianz Stadium',
        homeStats: {
          teamId: 'juv', name: 'Juventus', shortName: 'JUV', points: 0, goalsFor: 0, goalsAgainst: 0, form: [1, 2, 1, 3], xg: 1.5, xga: 1.2, shots: 12, shotsOnTarget: 7, possession: 58, passAccuracy: 82, homeForm: 2.1, awayForm: 1.5, injuries: 1, recentTrend: 1.5
        },
        awayStats: {
          teamId: 'int', name: 'Inter', shortName: 'INT', points: 0, goalsFor: 0, goalsAgainst: 0, form: [2, 1, 2, 2], xg: 1.7, xga: 1.1, shots: 14, shotsOnTarget: 8, possession: 55, passAccuracy: 81, homeForm: 1.5, awayForm: 2.2, injuries: 0, recentTrend: 1.2
        },
        source: 'openligadb'
      },
      {
        id: 'match-2',
        competition: 'Premier League',
        round: 'Round 1',
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea',
        kickoff: '2026-08-19T18:00:00Z',
        venue: 'Emirates',
        homeStats: {
          teamId: 'ars', name: 'Arsenal', shortName: 'ARS', points: 0, goalsFor: 0, goalsAgainst: 0, form: [2, 3, 2, 2], xg: 1.8, xga: 1.3, shots: 13, shotsOnTarget: 9, possession: 60, passAccuracy: 84, homeForm: 2.4, awayForm: 1.8, injuries: 1, recentTrend: 1.8
        },
        awayStats: {
          teamId: 'che', name: 'Chelsea', shortName: 'CHE', points: 0, goalsFor: 0, goalsAgainst: 0, form: [1, 2, 1, 2], xg: 1.4, xga: 1.5, shots: 11, shotsOnTarget: 6, possession: 52, passAccuracy: 79, homeForm: 1.9, awayForm: 1.6, injuries: 2, recentTrend: 1.1
        },
        source: 'openligadb'
      }
    ];

    component.predictions = component.matches.map((match) => ({
      id: match.id,
      competition: match.competition,
      round: match.round,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoff: match.kickoff,
      venue: match.venue,
      homeWin: 0.55,
      draw: 0.26,
      awayWin: 0.19,
      over25: 0.63,
      under25: 0.37,
      confidence: 74,
      reason: ['fixture ready']
    }));

    component.selectedLeague = 'Serie A';
    component.searchRoundFixtures();
    component.openForecast('match-1');

    expect(component.nextRoundFixtures.length).toBe(1);
    expect(component.selectedForecastPreview?.id).toBe('match-1');
    expect(component.selectedForecastPreview?.homeTeam).toBe('Juventus');
  });
});
