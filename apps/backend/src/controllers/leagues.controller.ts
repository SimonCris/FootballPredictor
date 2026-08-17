/**
 * GET /api/leagues -> lista dei campionati supportati dall'applicazione.
 */
import { Request, Response } from 'express';
import { LEAGUES } from '../config/leagues';

export function listLeagues(_req: Request, res: Response): void {
  res.json(LEAGUES);
}
