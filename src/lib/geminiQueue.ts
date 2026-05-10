/**
 * Serializes all Gemini API calls so they never overlap.
 *
 * Gemini 1.5 Flash free tier = 15 RPM. Three simultaneous page-load requests
 * can burst past this limit when the previous minute's quota is partially used.
 * A concurrency-1 queue with a 500 ms cooldown between calls keeps us well
 * within limits while adding only minimal latency (calls complete sequentially
 * in ~3-4 s instead of ~3-4 s in parallel — effectively the same perceived
 * load time because the slowest parallel call dominates anyway).
 */
class GeminiQueue {
  private running = false;
  private readonly waiters: Array<() => void> = [];
  // Minimum gap between the end of one call and the start of the next.
  // 500 ms is enough to stay safely below 15 RPM even under burst usage.
  private readonly cooldownMs: number;

  constructor(cooldownMs = 500) {
    this.cooldownMs = cooldownMs;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      // Hold the lock for the cooldown duration before releasing it
      setTimeout(() => this.release(), this.cooldownMs);
    }
  }

  private acquire(): Promise<void> {
    if (!this.running) {
      this.running = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.running = false;
    }
  }
}

// Single shared instance — all AI service functions share one queue
export const geminiQueue = new GeminiQueue(500);
