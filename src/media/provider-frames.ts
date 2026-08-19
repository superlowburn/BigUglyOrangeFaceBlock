const supportedProviders = [
  { host: "www.youtube.com", path: /^\/embed\/[^/]+$/ },
  { host: "www.youtube-nocookie.com", path: /^\/embed\/[^/]+$/ },
  { host: "player.vimeo.com", path: /^\/video\/[^/]+$/ },
] as const;

export function isSupportedVideoFrame(element: Element): element is HTMLIFrameElement {
  if (!(element instanceof HTMLIFrameElement)) return false;

  const source = element.getAttribute("src");
  if (!source) return false;

  try {
    return supportedProviderUrl(element.src, document.baseURI) !== null;
  } catch {
    return false;
  }
}

export function supportedProviderUrl(source: string, base = "https://invalid.local/"): URL | null {
  try {
    const url = new URL(source, base);
    return url.protocol === "https:" && supportedProviders.some(
      ({ host, path }) => url.hostname === host && path.test(url.pathname),
    ) ? url : null;
  } catch {
    return null;
  }
}

interface ProviderFrameState {
  originalSource: string;
  authorizedSource?: string;
  grantId?: number;
  version: number;
  inflight?: Promise<void>;
  ready?: Promise<void>;
}

interface ProviderAuthorizationPort {
  authorize(source: string, disableAutoplay: boolean): Promise<{
    grantId: number;
    source: string;
  }>;
  revoke(grantId: number): Promise<void>;
}

interface ProviderFrameEnvironment {
  prepare(frame: HTMLIFrameElement): Promise<void>;
  navigate(frame: HTMLIFrameElement, source: string): void;
}

export class ProviderFrameController {
  private readonly states = new WeakMap<HTMLIFrameElement, ProviderFrameState>();
  private readonly activeFrames = new Set<HTMLIFrameElement>();

  constructor(
    private readonly authorization: ProviderAuthorizationPort = runtimeAuthorization(),
    private readonly environment: ProviderFrameEnvironment = browserFrameEnvironment(),
  ) {}

  gate(frame: HTMLIFrameElement): void {
    const existing = this.states.get(frame);
    if (existing) {
      existing.version += 1;
      void this.revoke(existing);
      delete existing.authorizedSource;
      existing.ready = this.environment.prepare(frame);
      return;
    }
    if (!isSupportedVideoFrame(frame)) return;

    const originalSource = frame.getAttribute("src");
    if (!originalSource) return;

    const state: ProviderFrameState = { originalSource, version: 0 };
    this.states.set(frame, state);
    this.activeFrames.add(frame);
    state.ready = this.environment.prepare(frame);
  }

  async release(frame: HTMLIFrameElement): Promise<void> {
    const state = this.states.get(frame);
    if (!state) return;
    await this.loadAuthorized(frame, state, true);
  }

  regate(frame: HTMLIFrameElement): void {
    const state = this.states.get(frame);
    if (!state) return;
    state.version += 1;
    void this.revoke(state);
    delete state.authorizedSource;
    state.ready = this.environment.prepare(frame);
  }

  async restore(frame: HTMLIFrameElement): Promise<void> {
    const state = this.states.get(frame);
    if (!state) return;
    await this.loadAuthorized(frame, state, false);
  }

  async trust(frame: HTMLIFrameElement): Promise<void> {
    let state = this.states.get(frame);
    const originalSource = frame.getAttribute("src");
    if (!originalSource) return;
    if (
      state &&
      (originalSource === "about:blank" || originalSource === state.authorizedSource)
    ) {
      await state.inflight;
      return;
    }
    if (!isSupportedVideoFrame(frame)) return;
    if (state?.originalSource === originalSource) {
      await state.inflight;
      return;
    }
    if (state) {
      state.version += 1;
      await this.revoke(state);
    }
    state = { originalSource, version: 0 };
    this.states.set(frame, state);
    this.activeFrames.add(frame);
    state.ready = this.environment.prepare(frame);
    await state.ready;
    if (this.states.get(frame) !== state) return;
    await this.loadAuthorized(frame, state, false);
  }

  forget(frame: HTMLIFrameElement): void {
    const state = this.states.get(frame);
    if (!state) return;
    state.version += 1;
    void this.revoke(state);
    this.states.delete(frame);
    this.activeFrames.delete(frame);
  }

  dispose(): void {
    for (const frame of [...this.activeFrames]) this.forget(frame);
  }

  private async loadAuthorized(
    frame: HTMLIFrameElement,
    state: ProviderFrameState,
    disableAutoplay: boolean,
  ): Promise<void> {
    if (state.inflight) return state.inflight;
    const operation = this.performAuthorizedNavigation(frame, state, disableAutoplay);
    state.inflight = operation;
    try {
      await operation;
    } finally {
      if (state.inflight === operation) delete state.inflight;
    }
  }

  private async performAuthorizedNavigation(
    frame: HTMLIFrameElement,
    state: ProviderFrameState,
    disableAutoplay: boolean,
  ): Promise<void> {
    const version = ++state.version;
    await state.ready;
    if (state.version !== version || this.states.get(frame) !== state) return;
    await this.revoke(state);
    const authorization = await this.authorization.authorize(
      state.originalSource,
      disableAutoplay,
    );
    if (state.version !== version || this.states.get(frame) !== state) {
      await this.authorization.revoke(authorization.grantId);
      return;
    }
    state.grantId = authorization.grantId;
    state.authorizedSource = authorization.source;
    try {
      this.environment.navigate(frame, authorization.source);
    } catch (error) {
      await this.revoke(state);
      throw error;
    }
  }

  private async revoke(state: ProviderFrameState): Promise<void> {
    const grantId = state.grantId;
    if (grantId === undefined) return;
    delete state.grantId;
    await this.authorization.revoke(grantId);
  }
}

function browserFrameEnvironment(): ProviderFrameEnvironment {
  return {
    prepare: async (frame) => {
      frame.removeAttribute("srcdoc");
      frame.setAttribute("src", "about:blank");
    },
    navigate: (frame, source) => {
      frame.setAttribute("src", source);
    },
  };
}

function runtimeAuthorization(): ProviderAuthorizationPort {
  return {
    authorize: async (source, disableAutoplay) => {
      const response = await chrome.runtime.sendMessage({
        type: "provider:authorize",
        source,
        disableAutoplay,
      });
      if (
        !response ||
        typeof response !== "object" ||
        !("grantId" in response) ||
        typeof response.grantId !== "number" ||
        !("source" in response) ||
        typeof response.source !== "string"
      ) {
        throw new TypeError("Provider authorization failed");
      }
      return { grantId: response.grantId, source: response.source };
    },
    revoke: async (grantId) => {
      await chrome.runtime.sendMessage({ type: "provider:revoke", grantId });
    },
  };
}
