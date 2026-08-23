import { ContentController } from "./content-controller";
import {
  BlockedSubjectsStore,
  type BlockedSubjectsConfig,
} from "../shared/blocked-subjects";
import { DescriptionPreferencesStore } from "../shared/description-preferences";
import type { ProtectionContext } from "../shared/media-types";

interface ContentControllerPort {
  start(context: ProtectionContext): void;
  applyBlockedSubjects(config: BlockedSubjectsConfig): void;
  stop(options?: { restoreMedia?: boolean }): void;
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
  getDescriptionsVisible: (origin: string) => Promise<boolean>;
  getBlockedSubjects: () => Promise<BlockedSubjectsConfig>;
  watchBlockedSubjects: (listener: (config: BlockedSubjectsConfig) => void) => () => void;
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
  let currentBlockedSubjects: BlockedSubjectsConfig | null = null;
  let started = false;
  let disposed = false;

  dependencies.addPageHideListener(() => {
    disposed = true;
    stopWatching?.();
    controller.stop({ restoreMedia: false });
  });

  stopWatching = dependencies.watchBlockedSubjects((config) => {
    currentBlockedSubjects = config;
    if (started) controller.applyBlockedSubjects(config);
  });

  const origin = fallbackOrigin(page, dependencies);
  const [descriptionsVisible, storedSubjects] = await Promise.all([
    dependencies.getDescriptionsVisible(origin).catch(() => false),
    dependencies.getBlockedSubjects().catch(() => ({ enabled: false, keywords: [] })),
  ]);
  if (disposed) return;

  controller.start({
    origin,
    descriptionsVisible,
    blockedSubjects: currentBlockedSubjects ?? storedSubjects,
  });
  started = true;
}

function productionDependencies(): ContentBootstrapDependencies {
  const descriptions = new DescriptionPreferencesStore(chrome.storage.local);
  const blockedSubjects = new BlockedSubjectsStore(chrome.storage.local, chrome.storage.onChanged);
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
    createController: () => new ContentController({
      setDescriptionsVisible: (origin, visible) => descriptions.set(origin, visible),
    }),
    getDescriptionsVisible: (origin) => descriptions.get(origin),
    getBlockedSubjects: () => blockedSubjects.get(),
    watchBlockedSubjects: (listener) => blockedSubjects.watch(listener),
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
  dependencies: Pick<ContentBootstrapDependencies, "isChildFrame" | "parentLocation">,
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

function fallbackOrigin(
  page: URL,
  dependencies: Pick<ContentBootstrapDependencies, "parentLocation">,
): string {
  if (page.protocol === "http:" || page.protocol === "https:") return page.origin;
  return dependencies.parentLocation()?.origin ?? "null";
}

if (typeof chrome !== "undefined" && typeof chrome.runtime?.sendMessage === "function") {
  void bootstrapContentScript();
}
