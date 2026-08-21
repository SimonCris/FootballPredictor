/**
 * Pagina "Pronostici Selezionati": mostra le partite scelte manualmente
 * dall'utente tramite la checkbox nelle tabelle delle giornate di ciascun
 * campionato, con il pronostico già calcolato dal backend al momento della
 * selezione. A differenza della precedente "Top Pronostici", non aggrega
 * più tutte le partite di tutti i campionati in un'unica chiamata
 * (inefficiente e con consumo eccessivo di chiamate ai provider esterni):
 * i dati provengono esclusivamente da `SelectionService`, che li mantiene
 * in sessione lato frontend, quindi non viene effettuata alcuna nuova
 * chiamata HTTP per popolare questa pagina.
 */
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { SelectionService } from '../../core/services/selection.service';
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
    RouterLink,
    MatToolbarModule,
    MatButtonModule,
    MatTableModule,
    MatCardModule,
    MatIconModule,
    MatSnackBarModule,
    NgxChartsModule,
    MatTooltipModule,
  ],
  templateUrl: './top-predictions.component.html',
  styleUrl: './top-predictions.component.scss',
})
export class TopPredictionsComponent implements OnInit, OnDestroy {
  entries: TopPredictionEntry[] = [];
  combinedOdds = 0;

  readonly displayedColumns = ['match', 'league', 'suggestion', 'confidence', 'odds', 'remove'];

  chartData: ChartDatum[] = [];

  private subscription?: Subscription;

  constructor(
    private readonly selection: SelectionService,
    private readonly snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.subscription = this.selection.entries$.subscribe((entries) => {
      // Ordina per confidenza decrescente, così le partite più probabili
      // (già evidenziate nelle tabelle delle giornate) restano in cima.
      this.entries = [...entries].sort(
        (a, b) => b.prediction.confidence - a.prediction.confidence
      );
      this.combinedOdds =
        this.entries.length === 0
          ? 0
          : this.entries.reduce((acc, entry) => acc * entry.prediction.estimatedOdds, 1);
      this.chartData = this.entries.map((entry) => ({
        name: `${entry.match.homeTeam.name} - ${entry.match.awayTeam.name}`,
        value: entry.prediction.confidence,
      }));
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  remove(entry: TopPredictionEntry): void {
    this.selection.remove(entry.match.id);
    this.snackBar.open('Partita rimossa dai pronostici selezionati.', 'Chiudi', {
      duration: 3000,
    });
  }

  clearAll(): void {
    this.selection.clear();
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
