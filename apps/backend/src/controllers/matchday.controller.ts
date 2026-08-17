/**
 * GET /api/matchday?league=CODE -> partite della prossima giornata per il
 * campionato indicato.
 */
import { Request, Response } from 'express';
import { findLeagueByCode } from '../config/leagues';
import { getNextMatchday } from '../services/matchday.service';
import { logger } from '../utils/logger';

export async function getMatchday(req: Request, res: Response): Promise<void> {
  const leagueCode = req.query.league as string | undefined;
  if (!leagueCode) {
    res.status(400).json({ error: 'Parametro "league" mancante, es. ?league=SA' });
    return;
  }

  const league = findLeagueByCode(leagueCode);
  if (!league) {
    res.status(404).json({ error: `Campionato "${leagueCode}" non supportato` });
    return;
  }

  try {
    const matches = await getNextMatchday(league);

    // La chiave pubblica di test "3" di TheSportsDB limita a 5 il numero di
    // risultati restituiti da QUALSIASI endpoint a lista (eventsround,
    // eventsseason, ecc.), indipendentemente dal numero reale di partite
    // della giornata. Se il fallback TheSportsDB è stato usato e ha
    // restituito esattamente 5 partite, avvisiamo il frontend che l'elenco
    // potrebbe essere incompleto, suggerendo di configurare una chiave
    // gratuita football-data.org (che non ha questo limite) per avere
    // sempre la giornata completa.
    const isLikelyTruncatedByFreeTier =
      matches.length === 5 && matches.every((m) => m.source === 'thesportsdb');

    res.json({
      league,
      matches,
      warning: isLikelyTruncatedByFreeTier
        ? 'Elenco potenzialmente incompleto: il provider di fallback gratuito (TheSportsDB, chiave di test) limita a 5 il numero di partite restituite. Configura una chiave gratuita football-data.org in apps/backend/.env per ottenere sempre la giornata completa.'
        : undefined,
    });
  } catch (err) {
    logger.error('Errore nel recupero della prossima giornata', err);
    res.status(502).json({
      error:
        'Impossibile recuperare le partite dai provider dati esterni al momento. Riprovare più tardi.',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
