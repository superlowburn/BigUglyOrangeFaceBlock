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
    const url = new URL(element.src, document.baseURI);
    return (
      url.protocol === "https:" &&
      supportedProviders.some(
        ({ host, path }) => url.hostname === host && path.test(url.pathname),
      )
    );
  } catch {
    return false;
  }
}

interface ProviderFrameState {
  originalSource: string;
}

export class ProviderFrameController {
  private readonly states = new WeakMap<HTMLIFrameElement, ProviderFrameState>();

  gate(frame: HTMLIFrameElement): void {
    if (this.states.has(frame) || !isSupportedVideoFrame(frame)) return;

    const originalSource = frame.getAttribute("src");
    if (!originalSource) return;

    this.states.set(frame, { originalSource });
    frame.setAttribute("src", "about:blank");
  }

  release(frame: HTMLIFrameElement): void {
    const state = this.states.get(frame);
    if (state) frame.setAttribute("src", state.originalSource);
  }

  regate(frame: HTMLIFrameElement): void {
    if (this.states.has(frame)) frame.setAttribute("src", "about:blank");
  }

  restore(frame: HTMLIFrameElement): void {
    const state = this.states.get(frame);
    if (!state) return;

    frame.setAttribute("src", state.originalSource);
    this.states.delete(frame);
  }
}
