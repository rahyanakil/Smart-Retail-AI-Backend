interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class InMemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Evict expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => this.evict(), 5 * 60 * 1000);
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  deletePattern(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  size(): number {
    return this.store.size;
  }
}

export const cache = new InMemoryCache();

export const TTL = {
  ONE_MINUTE:    60_000,
  FIVE_MINUTES:  5 * 60_000,
  FIFTEEN_MIN:   15 * 60_000,
  THIRTY_MIN:    30 * 60_000,
  ONE_HOUR:      60 * 60_000,
} as const;
