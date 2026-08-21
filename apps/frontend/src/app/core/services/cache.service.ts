/**
 * Servizio di cache lato frontend: mantiene in `sessionStorage` le risposte
 * già ottenute dal backend, così passando da una sezione all'altra
 * dell'app (home, dettaglio partita, top pronostici) non viene rifatta una
 * chiamata HTTP verso un endpoint già interrogato in precedenza. Questo
 * riduce sia la latenza percepita sia il numero di chiamate ai servizi
 * esterni (rate-limit dei provider gratuiti).
 *
 * La cache sopravvive alla navigazione SPA e anche a un refresh manuale
 * della pagina (sessionStorage viene svuotata solo alla chiusura della tab),
 * mentre le richieste concorrenti verso la stessa chiave vengono unificate
 * (in-flight de-duplication) per evitare doppie chiamate simultanee.
 */
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { finalize, shareReplay, tap } from 'rxjs/operators';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable({ providedIn: 'root' })
export class CacheService {
  private readonly storagePrefix = 'fp-cache:';
  private readonly inFlight = new Map<string, Observable<unknown>>();

  /**
   * Restituisce il valore in cache per `key` se ancora valido, altrimenti
   * esegue `factory()` (deduplicando eventuali richieste identiche già in
   * corso) e ne memorizza il risultato per `ttlMs` millisecondi.
   */
  getOrFetch<T>(key: string, ttlMs: number, factory: () => Observable<T>): Observable<T> {
    const cached = this.readFromStorage<T>(key);
    if (cached !== undefined) {
      return of(cached);
    }

    const pending = this.inFlight.get(key) as Observable<T> | undefined;
    if (pending) {
      return pending;
    }

    const request$ = factory().pipe(
      tap((value) => this.writeToStorage(key, value, ttlMs)),
      shareReplay({ bufferSize: 1, refCount: false }),
      finalize(() => this.inFlight.delete(key))
    );

    this.inFlight.set(key, request$);
    return request$;
  }

  /** Invalida una singola voce di cache (es. dopo un'azione che sappiamo cambiare i dati lato server). */
  invalidate(key: string): void {
    sessionStorage.removeItem(this.storagePrefix + key);
    this.inFlight.delete(key);
  }

  /** Svuota tutta la cache applicativa (es. pulsante "Aggiorna" esplicito dell'utente). */
  clearAll(): void {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(this.storagePrefix))
      .forEach((k) => sessionStorage.removeItem(k));
    this.inFlight.clear();
  }

  private readFromStorage<T>(key: string): T | undefined {
    try {
      const raw = sessionStorage.getItem(this.storagePrefix + key);
      if (!raw) {
        return undefined;
      }
      const entry: CacheEntry<T> = JSON.parse(raw);
      if (Date.now() > entry.expiresAt) {
        sessionStorage.removeItem(this.storagePrefix + key);
        return undefined;
      }
      return entry.value;
    } catch {
      // sessionStorage non disponibile o dato corrotto: si procede senza cache.
      return undefined;
    }
  }

  private writeToStorage<T>(key: string, value: T, ttlMs: number): void {
    try {
      const entry: CacheEntry<T> = { value, expiresAt: Date.now() + ttlMs };
      sessionStorage.setItem(this.storagePrefix + key, JSON.stringify(entry));
    } catch {
      // Storage pieno o non disponibile (es. modalità privata): si ignora,
      // la chiamata resta comunque servita, solo senza caching.
    }
  }
}
