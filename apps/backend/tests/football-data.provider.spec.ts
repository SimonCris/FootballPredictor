/**
 * Test per la logica di individuazione della "prossima giornata" del
 * provider football-data.org. Copre in particolare il bug osservato su
 * LaLiga: i numeri di giornata (matchday) non sono sempre in ordine
 * cronologico, perché alcune partite rinviate slittano a dopo giornate
 * successive già completamente programmate.
 */
import { findNextMatchdayNumber } from '../src/providers/football-data.provider';

// Tipo minimo compatibile con FdMatch (non esportato dal modulo).
type MatchInput = { matchday?: number; utcDate: string };

describe('findNextMatchdayNumber', () => {
  it('sceglie il matchday con numero più basso quando le date sono in ordine cronologico coerente', () => {
    const matches: MatchInput[] = [
      { matchday: 2, utcDate: '2026-09-05T15:00:00Z' },
      { matchday: 1, utcDate: '2026-08-25T15:00:00Z' },
      { matchday: 1, utcDate: '2026-08-26T15:00:00Z' },
    ];
    expect(findNextMatchdayNumber(matches)).toBe(1);
  });

  it('sceglie il matchday della partita cronologicamente più vicina, non il numero più basso (caso LaLiga)', () => {
    // Riproduce lo scenario reale: 4 partite della giornata 1 sono state
    // rinviate a fine agosto, mentre la giornata 2 (9 partite) è interamente
    // ancora da giocare e inizia prima cronologicamente.
    const matches: MatchInput[] = [
      { matchday: 1, utcDate: '2026-08-25T19:00:00Z' },
      { matchday: 1, utcDate: '2026-08-26T19:00:00Z' },
      { matchday: 1, utcDate: '2026-08-27T18:30:00Z' },
      { matchday: 1, utcDate: '2026-08-27T19:00:00Z' },
      { matchday: 2, utcDate: '2026-08-21T19:00:00Z' },
      { matchday: 2, utcDate: '2026-08-22T15:00:00Z' },
      { matchday: 2, utcDate: '2026-08-22T17:30:00Z' },
      { matchday: 3, utcDate: '2026-08-28T17:00:00Z' },
    ];
    // La partita più vicina nel tempo è del matchday 2 (21 agosto), quindi
    // deve essere selezionato il matchday 2, non il matchday 1.
    expect(findNextMatchdayNumber(matches)).toBe(2);
  });

  it('restituisce undefined se non ci sono partite con matchday valorizzato', () => {
    const matches: MatchInput[] = [{ utcDate: '2026-08-25T19:00:00Z' }];
    expect(findNextMatchdayNumber(matches)).toBeUndefined();
  });

  it('ignora le partite senza matchday numerico quando ne esistono altre valide', () => {
    const matches: MatchInput[] = [
      { utcDate: '2026-08-20T19:00:00Z' }, // senza matchday, cronologicamente prima ma da ignorare
      { matchday: 5, utcDate: '2026-08-25T19:00:00Z' },
    ];
    expect(findNextMatchdayNumber(matches)).toBe(5);
  });
});
