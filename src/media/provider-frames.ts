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
  grantId?: number;
  version: number;
}

interface ProviderAuthorizationPort {
  authorize(source: string, disableAutoplay: boolean): Promise<{
    grantId: number;
    source: string;
  }>;
  revoke(grantId: number): Promise<void>;
}

export class ProviderFrameController {
  private readonly states = new WeakMap<HTMLIFrameElement, ProviderFrameState>();

  constructor(private readonly authorization: ProviderAuthorizationPort = runtimeAuthorization()) {}

  gate(frame: HTMLIFrameElement): void {
    const existing = this.states.get(frame);
    if (existing) {
      existing.version += 1;
      void this.revoke(existing);
      frame.setAttribute("src", "about:blank");
      return;
    }
    if (!isSupportedVideoFrame(frame)) return;

    const originalSource = frame.getAttribute("src");
    if (!originalSource) return;

    this.states.set(frame, { originalSource, version: 0 });
    frame.setAttribute("src", "about:blank");
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
    frame.setAttribute("src", "about:blank");
  }

  async restore(frame: HTMLIFrameElement): Promise<void> {
    const state = this.states.get(frame);
    if (!state) return;
    await this.loadAuthorized(frame, state, false);
  }

  async trust(frame: HTMLIFrameElement): Promise<void> {
    if (!isSupportedVideoFrame(frame)) return;
    let state = this.states.get(frame);
    if (!state) {
      const originalSource = frame.getAttribute("src");
      if (!originalSource) return;
      state = { originalSource, version: 0 };
      this.states.set(frame, state);
    }
    await this.loadAuthorized(frame, state, false);
  }

  forget(frame: HTMLIFrameElement): void {
    const state = this.states.get(frame);
    if (!state) return;
    state.version += 1;
    void this.revoke(state);
    this.states.delete(frame);
  }

  private async loadAuthorized(
    frame: HTMLIFrameElement,
    state: ProviderFrameState,
    disableAutoplay: boolean,
  ): Promise<void> {
    const version = ++state.version;
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
    frame.addEventListener("load", () => void this.revoke(state), { once: true });
    frame.setAttribute("src", authorization.source);
  }

  private async revoke(state: ProviderFrameState): Promise<void> {
    const grantId = state.grantId;
    if (grantId === undefined) return;
    delete state.grantId;
    await this.authorization.revoke(grantId);
  }
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
