/**
 * Dialog di dettaglio partita: mostra probabilità 1X2, suggerimento
 * Over/Under, confidenza, quota stimata e le statistiche usate per generare
 * il pronostico (forma recente, scontri diretti, gol fatti/subiti,
 * infortuni se disponibili).
 */
import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../core/services/api.service';
import { Match } from '../../core/models/league.model';
import { Prediction } from '../../core/models/prediction.model';

export interface MatchDetailDialogData {
  matchId: string;
}

@Component({
  selector: 'app-match-detail-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './match-detail-dialog.component.html',
  styleUrl: './match-detail-dialog.component.scss',
})
export class MatchDetailDialogComponent implements OnInit {
  loading = true;
  error: string | null = null;
  match: Match | null = null;
  prediction: Prediction | null = null;

  constructor(
    private readonly api: ApiService,
    private readonly dialogRef: MatDialogRef<MatchDetailDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: MatchDetailDialogData
  ) {}

  ngOnInit(): void {
    this.api.getMatchPrediction(this.data.matchId).subscribe({
      next: (response) => {
        this.match = response.match;
        this.prediction = response.prediction;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error ?? 'Impossibile calcolare il pronostico al momento.';
        this.loading = false;
      },
    });
  }

  close(): void {
    this.dialogRef.close();
  }

  outcomeLabel(outcome: string): string {
    switch (outcome) {
      case '1':
        return 'Vittoria squadra di casa (1)';
      case 'X':
        return 'Pareggio (X)';
      case '2':
        return 'Vittoria squadra ospite (2)';
      default:
        return outcome;
    }
  }
}
