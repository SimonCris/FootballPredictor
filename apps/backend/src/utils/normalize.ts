/**
 * Funzioni di normalizzazione dati usate dai provider per convertire le
 * risposte grezze delle API esterne nel modello dati interno (types/domain.ts).
 */

/** Converte una data in qualunque formato accettato da Date in ISO 8601 UTC. */
export function toIsoUtc(dateInput: string | number | Date): string {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Data non valida ricevuta dal provider: ${String(dateInput)}`);
  }
  return date.toISOString();
}

/** Genera un id stabile combinando provider + id nativo, per evitare collisioni tra provider diversi. */
export function buildCompositeId(providerName: string, nativeId: string | number): string {
  return `${providerName}:${nativeId}`;
}

/** Calcola la media aritmetica di un array di numeri, 0 se l'array è vuoto. */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Arrotonda un numero a un certo numero di decimali. */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Alcuni club hanno nomi comuni completamente diversi da quelli ufficiali
 * usati dai provider di dati partite (football-data.org/TheSportsDB), al
 * punto che nessun confronto "per contenimento" può abbinarli (es. "Sporting
 * Lisbon" usato da molti bookmaker vs "Sporting Clube de Portugal", oppure
 * "Rennes" vs "Stade Rennais"). Mappiamo esplicitamente queste varianti note
 * verso una forma canonica comune. Aggiungere qui nuove voci se si notano
 * altri abbinamenti mancati nei log (`Nessuna quota di mercato trovata...`).
 */
const KNOWN_TEAM_ALIASES: Record<string, string> = {
  sportinglisbon: 'sportingcp',
  sportingclubedeportugal: 'sportingcp',
  rennes: 'rennes',
  staderennais: 'rennes',
};

/**
 * Normalizza il nome di una squadra per confronti "fuzzy" tra provider diversi
 * (es. per abbinare le squadre restituite da The Odds API, che usa nomi
 * completi in inglese, con quelle di football-data.org/TheSportsDB).
 * Rimuove articoli, suffissi societari comuni, anni di fondazione, accenti e
 * punteggiatura.
 *
 * NOTA: alcune squadre hanno come nome proprio una delle parole "generiche"
 * che di norma rimuoviamo (es. "AC Milan", dove "Milan" è il nome del club,
 * non una città/suffisso da scartare come in "Inter Milan"). Se rimuovendo
 * le parole generiche restasse una stringa vuota, usiamo come fallback la
 * versione senza quella rimozione, per non perdere completamente il nome.
 */
export function normalizeTeamName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // rimuove accenti
    .toLowerCase();

  const withoutGenericWords = base
    .replace(
      /\b(fc|cf|ac|as|ss|sc|bc|us|calcio|club|deportivo|real|cd|afc|the|milan|milano)\b/g,
      ' '
    )
    // Rimuove anni di fondazione spesso presenti in un solo provider
    // (es. "Como 1907" vs "Como", "Hellas Verona 1903" vs "Verona").
    .replace(/\b(18|19|20)\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .trim();

  const result =
    withoutGenericWords.length > 0
      ? withoutGenericWords
      : // Fallback: il nome era composto solo da parole "generiche" (es. "AC Milan"),
        // quindi le manteniamo per non azzerare il nome della squadra.
        base.replace(/[^a-z0-9]/g, '').trim();

  return KNOWN_TEAM_ALIASES[result] ?? result;
}

/**
 * Confronta due nomi squadra già normalizzati con `normalizeTeamName`,
 * accettando anche un match "per contenimento" (una stringa contenuta
 * nell'altra) per gestire i casi in cui un provider usa il nome completo e
 * l'altro un nome abbreviato (es. "internazionale" vs "inter", entrambi
 * ottenuti rimuovendo "milan/milano" da "Internazionale Milano"/"Inter
 * Milan", oppure "psveindhoven" vs "psv"). La soglia minima di lunghezza è
 * bassa (2) perché molte squadre sono note con sigle molto corte (es. "AZ"
 * per "AZ Alkmaar"); il rischio di falsi positivi resta comunque basso
 * perché il confronto avviene solo tra le due squadre di una specifica
 * partita già individuata, non su liste arbitrarie di nomi.
 */
export function teamNamesMatch(normalizedA: string, normalizedB: string): boolean {
  if (!normalizedA || !normalizedB) return false;
  if (normalizedA === normalizedB) return true;
  const MIN_LENGTH_FOR_CONTAINMENT = 2;
  if (normalizedA.length < MIN_LENGTH_FOR_CONTAINMENT || normalizedB.length < MIN_LENGTH_FOR_CONTAINMENT) {
    return false;
  }
  return normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA);
}

/**
 * Calcola la stagione calcistica corrente nel formato "YYYY-YYYY+1" usato da
 * molte API (es. TheSportsDB), assumendo che la stagione inizi a luglio.
 */
export function getCurrentFootballSeason(referenceDate: Date = new Date()): string {
  const month = referenceDate.getUTCMonth() + 1; // 1-12
  const year = referenceDate.getUTCFullYear();
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}
