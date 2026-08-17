/**
 * Pagina "Top Pronostici": aggrega le partite dei top 5 campionati e mostra
 * i migliori N pronostici (N selezionabile da 2 a 5) ordinati per
 * confidenza, con la quota combinata (prodotto delle quote stimate).
 */
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { ApiService } from '../../core/services/api.service';
import { TopPredictionEntry } from '../../core/models/prediction.model';

interface ChartDatum {
  name: string;
  value: number;
}

@Component({
  selector: 'app-top-predictions',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatToolbarModule,
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    MatTableModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    NgxChartsModule,
  ],
  templateUrl: './top-predictions.component.html',
  styleUrl: './top-predictions.component.scss',
})
export class TopPredictionsComponent implements OnInit {
  readonly nOptions = [2, 3, 4, 5];
  selectedN = 5;
  loading = false;
  entries: TopPredictionEntry[] = [];
  combinedOdds = 0;

  readonly displayedColumns = ['match', 'league', 'suggestion', 'confidence', 'odds'];

  chartData: ChartDatum[] = [];

  constructor(
    private readonly api: ApiService,
    private readonly snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.getTopPredictions(this.selectedN).subscribe({
      next: (response) => {
        this.entries = response.entries;
        this.combinedOdds = response.combinedOdds;
        this.chartData = response.entries.map((entry) => ({
          name: `${entry.match.homeTeam.name} - ${entry.match.awayTeam.name}`,
          value: entry.prediction.confidence,
        }));
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.entries = [];
        this.chartData = [];
        const message =
          err?.error?.error ?? 'Impossibile calcolare i top pronostici al momento.';
        this.snackBar.open(message, 'Chiudi', { duration: 6000 });
      },
    });
  }

  outcomeLabel(outcome: string): string {
    switch (outcome) {
      case '1':
        return '1 (Casa)';
      case 'X':
        return 'X (Pareggio)';
      case '2':
        return '2 (Trasferta)';
      default:
        return outcome;
    }
  }
}
