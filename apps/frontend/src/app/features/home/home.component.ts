/**
 * Home page: permette di selezionare un campionato, recuperare le partite
 * della prossima giornata e visualizzarle in tabella. Ogni riga ha un
 * pulsante "Pronostico" che apre il dialog di dettaglio con le statistiche
 * e il pronostico calcolato dal backend.
 */
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ApiService } from '../../core/services/api.service';
import { SelectionService } from '../../core/services/selection.service';
import { League, Match } from '../../core/models/league.model';
import { Prediction } from '../../core/models/prediction.model';
import { MatchDetailDialogComponent } from '../match-detail/match-detail-dialog.component';
import { Subscription } from 'rxjs';

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
    MatTooltipModule,
    MatCheckboxModule,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  leagues: League[] = [];
  selectedLeagueCode: string | null = null;
  matches: Match[] = [];
  loadingLeagues = false;
  loadingMatches = false;
  hasSearched = false;

  /**
   * Pronostico completo calcolato in modo asincrono per ogni partita,
   * popolato lazy dopo la ricerca (il backend calcola/mette in cache il
   * pronostico). Oltre alla quota stimata, usiamo la confidenza per
   * evidenziare le 3 partite più probabili della giornata.
   */
  predictionsByMatchId: Record<string, Prediction | 'loading' | 'error'> = {};

  /** Id delle 3 partite con confidenza più alta nella tabella corrente. */
  topPickIds = new Set<string>();

  /** Id delle partite selezionate manualmente dall'utente (sincronizzato con SelectionService). */
  selectedMatchIds = new Set<string>();

  /** Numero totale di partite selezionate (mostrato come badge in navbar). */
  selectedCount = 0;

  private selectionSubscription?: Subscription;

  readonly displayedColumns = [
    'select',
    'date',
    'time',
    'home',
    'away',
    'predictionOutcome',
    'odds',
    'detail',
  ];

  constructor(
    private readonly api: ApiService,
    private readonly dialog: MatDialog,
    private readonly snackBar: MatSnackBar,
    private readonly selection: SelectionService
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
    this.selectionSubscription = this.selection.entries$.subscribe((entries) => {
      this.selectedCount = entries.length;
      this.refreshSelectedIds();
    });
  }

  ngOnDestroy(): void {
    this.selectionSubscription?.unsubscribe();
  }

  /**
   * @param forceRefresh se `true` ignora la cache lato FE e ripete la
   * chiamata al backend (usato dal pulsante "Aggiorna").
   */
  search(forceRefresh = false): void {
    if (!this.selectedLeagueCode) {
      this.snackBar.open('Selezionare prima un campionato.', 'Chiudi', { duration: 3000 });
      return;
    }

    this.loadingMatches = true;
    this.hasSearched = true;
    this.predictionsByMatchId = {};
    this.topPickIds = new Set<string>();
    this.api.getMatchday(this.selectedLeagueCode, forceRefresh).subscribe({
      next: (response) => {
        this.matches = response.matches;
        this.loadingMatches = false;
        this.refreshSelectedIds();
        if (this.matches.length === 0) {
          this.snackBar.open('Nessuna partita trovata per la prossima giornata.', 'Chiudi', {
            duration: 4000,
          });
        } else {
          this.loadPredictions(forceRefresh);
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
   * Recupera il pronostico completo per ciascuna partita in modo asincrono
   * e indipendente, così la tabella si popola progressivamente senza
   * bloccarsi in attesa di tutte le chiamate. Le risposte vengono servite
   * dalla cache FE se già disponibili (es. dialog già aperto in precedenza).
   * Dopo ogni arrivo si ricalcolano le 3 partite più probabili della
   * giornata (top pick) in base alla confidenza del pronostico.
   */
  private loadPredictions(forceRefresh = false): void {
    for (const match of this.matches) {
      this.predictionsByMatchId[match.id] = 'loading';
      this.api.getMatchPrediction(match.id, forceRefresh).subscribe({
        next: ({ prediction }: { prediction: Prediction }) => {
          this.predictionsByMatchId[match.id] = prediction;
          this.recomputeTopPicks();
        },
        error: () => {
          this.predictionsByMatchId[match.id] = 'error';
        },
      });
    }
  }

  /** Ricalcola le id delle 3 partite con confidenza più alta tra quelle già caricate. */
  private recomputeTopPicks(): void {
    const loaded = this.matches
      .map((match) => ({ match, prediction: this.predictionsByMatchId[match.id] }))
      .filter(
        (entry): entry is { match: Match; prediction: Prediction } =>
          typeof entry.prediction === 'object'
      )
      .sort((a, b) => b.prediction.confidence - a.prediction.confidence)
      .slice(0, 3)
      .map((entry) => entry.match.id);
    this.topPickIds = new Set(loaded);
  }

  /** `true` se la partita è tra le 3 con pronostico più probabile della tabella corrente. */
  isTopPick(match: Match): boolean {
    return this.topPickIds.has(match.id);
  }

  /** Sincronizza `selectedMatchIds` con lo stato salvato in sessione. */
  private refreshSelectedIds(): void {
    const ids = new Set(this.selection.getAll().map((entry) => entry.match.id));
    this.selectedMatchIds = new Set(
      this.matches.filter((match) => ids.has(match.id)).map((match) => match.id)
    );
  }

  isSelected(match: Match): boolean {
    return this.selectedMatchIds.has(match.id);
  }

  /**
   * Seleziona/deseleziona una partita per la sezione "Pronostici Selezionati".
   * Richiede che il pronostico sia già stato caricato (avviene automaticamente
   * dopo la ricerca), così non serve alcuna chiamata aggiuntiva al backend.
   */
  toggleSelection(match: Match): void {
    const prediction = this.predictionsByMatchId[match.id];
    if (typeof prediction !== 'object') {
      this.snackBar.open('Attendere il calcolo del pronostico prima di selezionare.', 'Chiudi', {
        duration: 3000,
      });
      return;
    }
    // La subscription su selection.entries$ aggiorna selectedMatchIds di conseguenza.
    this.selection.toggle(match, prediction);
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

  /** Etichetta sintetica (1/X/2) mostrata nella colonna "Pronostico" della tabella. */
  outcomeLabel(outcome: string): string {
    switch (outcome) {
      case '1':
        return '1';
      case 'X':
        return 'X';
      case '2':
        return '2';
      default:
        return outcome;
    }
  }

  /** Etichetta estesa mostrata come tooltip sulla colonna "Pronostico". */
  outcomeTooltip(outcome: string): string {
    switch (outcome) {
      case '1':
        return 'Vittoria squadra di casa';
      case 'X':
        return 'Pareggio';
      case '2':
        return 'Vittoria squadra ospite';
      default:
        return '';
    }
  }
}
