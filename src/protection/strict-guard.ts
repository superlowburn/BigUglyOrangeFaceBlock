export interface IntersectionObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}

export type IntersectionObserverFactory = (
  callback: IntersectionObserverCallback,
) => IntersectionObserverLike;

export interface StrictRevealGuardEnvironment {
  createObserver?: IntersectionObserverFactory;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

export class StrictRevealGuard {
  private readonly createObserver: IntersectionObserverFactory;
  private readonly setTimer: typeof globalThis.setTimeout;
  private readonly clearTimer: typeof globalThis.clearTimeout;

  constructor(environment: StrictRevealGuardEnvironment = {}) {
    this.createObserver =
      environment.createObserver ??
      ((callback) => new IntersectionObserver(callback, { threshold: 0 }));
    this.setTimer = environment.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimer = environment.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  }

  watch(element: Element, reprotect: () => void): () => void {
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let outside = false;
    let disposed = false;

    const clearPending = (): void => {
      if (timer === null) return;
      this.clearTimer(timer);
      timer = null;
    };

    const observer = this.createObserver((entries) => {
      if (disposed) return;
      const entry = entries.find((candidate) => candidate.target === element);
      if (!entry) return;

      if (entry.intersectionRatio > 0) {
        outside = false;
        clearPending();
        return;
      }

      if (outside) return;
      outside = true;
      timer = this.setTimer(() => {
        timer = null;
        if (!disposed && outside) reprotect();
      }, 2_000);
    });

    observer.observe(element);

    return () => {
      if (disposed) return;
      disposed = true;
      outside = false;
      clearPending();
      observer.disconnect();
    };
  }
}
