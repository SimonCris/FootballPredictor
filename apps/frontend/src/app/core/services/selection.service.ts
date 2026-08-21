/**
 * Servizio di selezione lato frontend: mantiene in `sessionStorage` l'elenco
 * delle partite scelte manualmente dall'utente tramite la checkbox nelle
 * tabelle delle giornate di ciascun campionato. Il pronostico viene salvato
 * insieme alla partita al momento della selezione (è già disponibile in
 * tabella, calcolato dal motore del backend), così la sezione
 * "Pronostici Selezionati" può mostrarle senza eseguire alcuna nuova
 * chiamata al backend né ai servizi esterni.
 */
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Match } from '../models/league.model';
import { Prediction, TopPredictionEntry } from '../models/prediction.model';

@Injectable({ providedIn: 'root' })
export class SelectionService {
  private readonly storageKey = 'fp-selected-matches';
  private readonly entriesSubject = new BehaviorSubject<TopPredictionEntry[]>(
    this.readFromStorage()
  );

  /** Stream reattivo delle partite selezionate, usato dalla pagina "Pronostici Selezionati". */
  readonly entries$: Observable<TopPredictionEntry[]> = this.entriesSubject.asObservable();

  getAll(): TopPredictionEntry[] {
    return this.entriesSubject.value;
  }

  isSelected(matchId: string): boolean {
    return this.entriesSubject.value.some((entry) => entry.match.id === matchId);
  }

  toggle(match: Match, prediction: Prediction): void {
    if (this.isSelected(match.id)) {
      this.remove(match.id);
    } else {
      this.add(match, prediction);
    }
  }

  add(match: Match, prediction: Prediction): void {
    const withoutMatch = this.entriesSubject.value.filter((entry) => entry.match.id !== match.id);
    this.persist([...withoutMatch, { match, prediction }]);
  }

  remove(matchId: string): void {
    this.persist(this.entriesSubject.value.filter((entry) => entry.match.id !== matchId));
  }

  clear(): void {
    this.persist([]);
  }

  private persist(entries: TopPredictionEntry[]): void {
    this.entriesSubject.next(entries);
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(entries));
    } catch {
      // sessionStorage piena/non disponibile: la selezione resta valida solo in memoria per la sessione corrente.
    }
  }

  private readFromStorage(): TopPredictionEntry[] {
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}
