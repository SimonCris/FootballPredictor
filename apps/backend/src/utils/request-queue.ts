/**
 * Coda con limite di concorrenza e ritardo minimo tra le richieste, usata dai
 * provider dati esterni per evitare di superare i rate limit (es. Cloudflare
 * "Error 1015: You are being rate limited" su TheSportsDB, o i 10
 * richieste/minuto del piano free di football-data.org).
 *
 * Ogni chiamata HTTP verso un provider viene incapsulata in `queue.run(...)`:
 * la coda garantisce al massimo `maxConcurrent` richieste in volo
 * contemporaneamente e attende almeno `minDelayMs` tra il completamento di
 * una richiesta e l'avvio della successiva.
 */
export class RequestQueue {
  private activeCount = 0;
  private pending: Array<() => void> = [];
  private lastStartedAt = 0;

  constructor(
    private readonly maxConcurrent: number,
    private readonly minDelayMs: number
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      const tryStart = async () => {
        if (this.activeCount >= this.maxConcurrent) return false;

        // Rispetta il ritardo minimo dall'ultima richiesta avviata, per
        // spalmare nel tempo le chiamate ed evitare burst che scatenano il
        // rate limiting lato provider.
        const elapsed = Date.now() - this.lastStartedAt;
        if (elapsed < this.minDelayMs) {
          await new Promise((r) => setTimeout(r, this.minDelayMs - elapsed));
        }

        this.activeCount++;
        this.lastStartedAt = Date.now();
        resolve();
        return true;
      };

      const attempt = () => {
        tryStart().then((started) => {
          if (!started) this.pending.push(attempt);
        });
      };
      attempt();
    });
  }

  private release(): void {
    this.activeCount--;
    const next = this.pending.shift();
    if (next) next();
  }
}
