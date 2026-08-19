import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StrictRevealGuard,
  type IntersectionObserverFactory,
} from "../../src/protection/strict-guard";

function observerHarness(): {
  factory: IntersectionObserverFactory;
  emit: (target: Element, intersectionRatio: number) => void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
} {
  let callback: IntersectionObserverCallback | null = null;
  const observe = vi.fn();
  const disconnect = vi.fn();
  const observer = { observe, disconnect };

  return {
    factory: (nextCallback) => {
      callback = nextCallback;
      return observer;
    },
    emit: (target, intersectionRatio) => {
      if (!callback) throw new Error("observer callback was not registered");
      callback(
        [{ target, intersectionRatio, isIntersecting: intersectionRatio > 0 } as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      );
    },
    observe,
    disconnect,
  };
}

describe("StrictRevealGuard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not re-protect revealed media while any part remains visible", () => {
    const harness = observerHarness();
    const element = document.createElement("img");
    const reprotect = vi.fn();
    new StrictRevealGuard({ createObserver: harness.factory }).watch(element, reprotect);

    harness.emit(element, 0.01);
    vi.advanceTimersByTime(10_000);

    expect(harness.observe).toHaveBeenCalledWith(element);
    expect(reprotect).not.toHaveBeenCalled();
  });

  it("re-protects once after two continuous seconds completely outside the viewport", () => {
    const harness = observerHarness();
    const element = document.createElement("img");
    const reprotect = vi.fn();
    new StrictRevealGuard({ createObserver: harness.factory }).watch(element, reprotect);

    harness.emit(element, 0);
    vi.advanceTimersByTime(1_999);
    expect(reprotect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(reprotect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(reprotect).toHaveBeenCalledTimes(1);
  });

  it("cancels pending re-protection when media re-enters the viewport", () => {
    const harness = observerHarness();
    const element = document.createElement("img");
    const reprotect = vi.fn();
    new StrictRevealGuard({ createObserver: harness.factory }).watch(element, reprotect);

    harness.emit(element, 0);
    vi.advanceTimersByTime(1_999);
    harness.emit(element, 0.01);
    vi.advanceTimersByTime(10_000);

    expect(reprotect).not.toHaveBeenCalled();
  });

  it("disconnects observation and clears pending work when disposed", () => {
    const harness = observerHarness();
    const element = document.createElement("img");
    const reprotect = vi.fn();
    const dispose = new StrictRevealGuard({ createObserver: harness.factory }).watch(element, reprotect);
    harness.emit(element, 0);

    dispose();
    vi.advanceTimersByTime(2_000);

    expect(harness.disconnect).toHaveBeenCalledTimes(1);
    expect(reprotect).not.toHaveBeenCalled();
  });
});
