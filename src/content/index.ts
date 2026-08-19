import { isSiteMode, SitePolicyStore } from "../shared/site-policy";
import type { ExtensionMessage, PolicyContext, SiteMode } from "../shared/media-types";
import { ContentController } from "./content-controller";

interface ContentControllerPort {
  start(context: PolicyContext): void;
  applyMode(mode: SiteMode): void;
  stop(): void;
}

interface ParentLocation {
  protocol: string;
  origin: string;
}

export interface ContentBootstrapDependencies {
  href: string;
  isChildFrame: boolean;
  parentLocation: () => ParentLocation | null;
  createController: () => ContentControllerPort;
  sendMessage: (message: ExtensionMessage) => Promise<unknown>;
  watchPolicy: (origin: string, listener: (mode: SiteMode) => void) => () => void;
  addPageHideListener: (listener: () => void) => void;
}

export async function bootstrapContentScript(
  dependencies: ContentBootstrapDependencies = productionDependencies(),
): Promise<void> {
  const page = parseUrl(dependencies.href);
  if (!page || !isEligibleDocument(page, dependencies)) return;
  if (dependencies.isChildFrame && isSupportedProviderDocument(page)) return;

  const controller = dependencies.createController();
  let stopWatching: (() => void) | null = null;
  let disposed = false;

  dependencies.addPageHideListener(() => {
    disposed = true;
    stopWatching?.();
    controller.stop();
  });

  try {
    const response = await dependencies.sendMessage({ type: "policy:get-current" });
    if (!isPolicyContext(response)) throw new TypeError("Invalid policy response");
    if (disposed) return;

    controller.start(response);
    stopWatching = dependencies.watchPolicy(response.origin, (mode) => {
      controller.applyMode(mode);
    });
  } catch {
    if (disposed) return;
    controller.start({
      origin: fallbackOrigin(page, dependencies),
      mode: "protected",
    });
  }
}

function productionDependencies(): ContentBootstrapDependencies {
  const store = new SitePolicyStore(chrome.storage.local, chrome.storage.onChanged);
  return {
    href: window.location.href,
    isChildFrame: window !== window.top,
    parentLocation: () => {
      try {
        return {
          protocol: window.parent.location.protocol,
          origin: window.parent.location.origin,
        };
      } catch {
        return null;
      }
    },
    createController: () => new ContentController(),
    sendMessage: (message) => chrome.runtime.sendMessage(message),
    watchPolicy: (origin, listener) => store.watch(origin, listener),
    addPageHideListener: (listener) => {
      window.addEventListener("pagehide", listener, { once: true });
    },
  };
}

function parseUrl(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

function isEligibleDocument(
  page: URL,
  dependencies: Pick<
    ContentBootstrapDependencies,
    "isChildFrame" | "parentLocation"
  >,
): boolean {
  if (page.protocol === "http:" || page.protocol === "https:") return true;
  if (page.href !== "about:blank" || !dependencies.isChildFrame) return false;

  const parent = dependencies.parentLocation();
  return parent?.protocol === "http:" || parent?.protocol === "https:";
}

function isSupportedProviderDocument(page: URL): boolean {
  if (page.protocol !== "https:") return false;
  if (
    page.hostname === "www.youtube.com" ||
    page.hostname === "www.youtube-nocookie.com"
  ) {
    return /^\/embed\/[^/]+$/.test(page.pathname);
  }
  return page.hostname === "player.vimeo.com" && /^\/video\/[^/]+$/.test(page.pathname);
}

function isPolicyContext(value: unknown): value is PolicyContext {
  if (!value || typeof value !== "object") return false;
  if (!("origin" in value) || !("mode" in value)) return false;
  if (typeof value.origin !== "string" || !isSiteMode(value.mode)) return false;

  const origin = parseUrl(value.origin);
  return (
    origin !== null &&
    (origin.protocol === "http:" || origin.protocol === "https:") &&
    origin.origin === value.origin
  );
}

function fallbackOrigin(
  page: URL,
  dependencies: Pick<ContentBootstrapDependencies, "parentLocation">,
): string {
  if (page.protocol === "http:" || page.protocol === "https:") return page.origin;
  return dependencies.parentLocation()?.origin ?? "null";
}

if (
  typeof chrome !== "undefined" &&
  typeof chrome.runtime?.sendMessage === "function"
) {
  void bootstrapContentScript();
}
