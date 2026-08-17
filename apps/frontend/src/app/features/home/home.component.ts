/**
 * Home page: permette di selezionare un campionato, recuperare le partite
 * della prossima giornata e visualizzarle in tabella. Ogni riga ha un
 * pulsante "Pronostico" che apre il dialog di dettaglio con le statistiche
 * e il pronostico calcolato dal backend.
 */
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { League, Match } from '../../core/models/league.model';
import { Prediction } from '../../core/models/prediction.model';
import { MatchDetailDialogComponent } from '../match-detail/match-detail-dialog.component';

@Component({
  selector: 'app-home',
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
    MatDialogModule,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit {
  leagues: League[] = [];
  selectedLeagueCode: string | null = null;
  matches: Match[] = [];
  loadingLeagues = false;
  loadingMatches = false;
  hasSearched = false;

  /**
   * Quota stimata calcolata in modo asincrono per ogni partita, popolata
   * lazy dopo la ricerca (il backend calcola/mette in cache il pronostico
   * completo, qui usiamo solo la quota per la colonna della tabella).
   */
  oddsByMatchId: Record<string, number | 'loading' | 'error'> = {};

  readonly displayedColumns = [
    'date',
    'time',
    'home',
    'away',
    'venue',
    'odds',
    'details',
    'prediction',
  ];

  constructor(
    private readonly api: ApiService,
    private readonly dialog: MatDialog,
    private readonly snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadingLeagues = true;
    this.api.getLeagues().subscribe({
      next: (leagues) => {
        this.leagues = leagues;
        this.loadingLeagues = false;
      },
      error: () => {
        this.loadingLeagues = false;
        this.snackBar.open('Impossibile caricare la lista dei campionati.', 'Chiudi', {
          duration: 5000,
        });
      },
    });
  }

  search(): void {
    if (!this.selectedLeagueCode) {
      this.snackBar.open('Selezionare prima un campionato.', 'Chiudi', { duration: 3000 });
      return;
    }

    this.loadingMatches = true;
    this.hasSearched = true;
    this.oddsByMatchId = {};
    this.api.getMatchday(this.selectedLeagueCode).subscribe({
      next: (response) => {
        this.matches = response.matches;
        this.loadingMatches = false;
        if (this.matches.length === 0) {
          this.snackBar.open('Nessuna partita trovata per la prossima giornata.', 'Chiudi', {
            duration: 4000,
          });
        } else {
          this.loadEstimatedOdds();
          if (response.warning) {
            this.snackBar.open(response.warning, 'Chiudi', { duration: 10000 });
          }
        }
      },
      error: (err) => {
        this.loadingMatches = false;
        this.matches = [];
        const message =
          err?.error?.error ?? 'Errore nel recupero delle partite. Riprovare più tardi.';
        this.snackBar.open(message, 'Chiudi', { duration: 6000 });
      },
    });
  }

  /**
   * Recupera la quota stimata per ciascuna partita in modo asincrono e
   * indipendente, così la tabella si popola progressivamente senza
   * bloccarsi in attesa di tutte le chiamate.
   */
  private loadEstimatedOdds(): void {
    for (const match of this.matches) {
      this.oddsByMatchId[match.id] = 'loading';
      this.api.getMatchPrediction(match.id).subscribe({
        next: ({ prediction }: { prediction: Prediction }) => {
          this.oddsByMatchId[match.id] = prediction.estimatedOdds;
        },
        error: () => {
          this.oddsByMatchId[match.id] = 'error';
        },
      });
    }
  }

  openPrediction(match: Match): void {
    this.dialog.open(MatchDetailDialogComponent, {
      data: { matchId: match.id },
      width: '640px',
      maxWidth: '95vw',
    });
  }

  matchDate(match: Match): Date {
    return new Date(match.utcDate);
  }
}
