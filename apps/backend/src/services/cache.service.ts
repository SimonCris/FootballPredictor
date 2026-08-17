/**
 * Wrapper generico attorno a node-cache per centralizzare la logica di
 * caching in memoria (get-or-set con TTL) usata dai servizi che chiamano
 * i provider esterni.
 */
import NodeCache from 'node-cache';

const cache = new NodeCache({ checkperiod: 120 });

export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  const cached = cache.get<T>(key);
  if (cached !== undefined) {
    return cached;
  }
  const value = await loader();
  cache.set(key, value, ttlSeconds);
  return value;
}

export function clearCache(): void {
  cache.flushAll();
}
