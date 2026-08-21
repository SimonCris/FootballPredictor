/**
 * Mappatura statica dei campionati supportati e dei relativi codici usati
 * dai provider esterni. Per aggiungere un nuovo campionato: aggiungere una
 * voce qui con i providerIds corretti (vedi documentazione dei provider).
 */
import { League } from '../types/domain';

export const LEAGUES: League[] = [
  {
    code: 'SA',
    name: 'Serie A',
    country: 'Italia',
    isTop5: true,
    providerIds: { footballData: 'SA', theSportsDb: '4332', oddsApi: 'soccer_italy_serie_a' },
  },
  {
    code: 'PL',
    name: 'Premier League',
    country: 'Inghilterra',
    isTop5: true,
    providerIds: { footballData: 'PL', theSportsDb: '4328', oddsApi: 'soccer_epl' },
  },
  {
    code: 'PD',
    name: 'LaLiga',
    country: 'Spagna',
    isTop5: true,
    providerIds: { footballData: 'PD', theSportsDb: '4335', oddsApi: 'soccer_spain_la_liga' },
  },
  {
    code: 'FL1',
    name: 'Ligue 1',
    country: 'Francia',
    isTop5: true,
    providerIds: { footballData: 'FL1', theSportsDb: '4334', oddsApi: 'soccer_france_ligue_one' },
  },
  {
    code: 'BL1',
    name: 'Bundesliga',
    country: 'Germania',
    isTop5: true,
    providerIds: { footballData: 'BL1', theSportsDb: '4331', oddsApi: 'soccer_germany_bundesliga' },
  },
  {
    code: 'DED',
    name: 'Eredivisie',
    country: 'Paesi Bassi',
    isTop5: false,
    providerIds: {
      footballData: 'DED',
      theSportsDb: '4337',
      oddsApi: 'soccer_netherlands_eredivisie',
    },
  },
  {
    code: 'PPL',
    name: 'Primeira Liga',
    country: 'Portogallo',
    isTop5: false,
    providerIds: {
      footballData: 'PPL',
      theSportsDb: '4344',
      oddsApi: 'soccer_portugal_primeira_liga',
    },
  },
];

export function findLeagueByCode(code: string): League | undefined {
  return LEAGUES.find((l) => l.code.toLowerCase() === code.toLowerCase());
}

export function getTop5Leagues(): League[] {
  return LEAGUES.filter((l) => l.isTop5);
}
