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
