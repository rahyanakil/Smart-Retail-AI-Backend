import { env } from '../config/env';

/**
 * Round-robin Gemini API key rotator.
 *
 * Usage:
 *   Set any combination of GEMINI_API_KEY, GEMINI_API_KEY_1, GEMINI_API_KEY_2 in .env.
 *   Each unique key is a separate Google project with its own free-tier quota bucket.
 *   The rotator cycles through them in order, so with N keys you get N × 15 RPM.
 *
 * Automatic fallback:
 *   If a call fails with RESOURCE_EXHAUSTED (quota hit on the active key), call
 *   tryNext() to get the next key and retry once before surfacing the error.
 */
class KeyRotator {
  private cursor = 0;

  /** All unique, non-empty configured keys in insertion order. */
  keys(): string[] {
    const raw = [env.GEMINI_API_KEY, env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2];
    return [...new Set(raw.filter((k): k is string => Boolean(k)))];
  }

  /** How many distinct keys are configured. */
  count(): number {
    return this.keys().length;
  }

  /** Returns the next key in the rotation and advances the cursor. */
  next(): string {
    const pool = this.keys();
    if (pool.length === 0) {
      throw new Error('No Gemini API key configured. Add GEMINI_API_KEY to backend/.env');
    }
    const key = pool[this.cursor % pool.length];
    this.cursor = (this.cursor + 1) % pool.length;
    return key;
  }

  /**
   * Peek at the next key without advancing.
   * Used to "look ahead" after a quota failure to decide whether to retry.
   */
  peek(): string | null {
    const pool = this.keys();
    if (pool.length < 2) return null;
    return pool[this.cursor % pool.length];
  }
}

export const keyRotator = new KeyRotator();
