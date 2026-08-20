import type { ExtensionMessage, PolicyContext } from "../shared/media-types";
import { isSiteMode, SitePolicyStore } from "../shared/site-policy";
import { ProviderRequestGate } from "./provider-request-gate";

type StorageArea = {
  get(key: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type Tab = { id?: number | undefined; url?: string | undefined };

type MessageSender = { tab?: Tab };

type WorkerDependencies = {
  storage: StorageArea;
  tabs: { get(tabId: number): Promise<Tab> };
  openOptionsPage?: () => Promise<void>;
  providerGate?: Pick<ProviderRequestGate, "authorize" | "revoke">;
};

interface ProviderLifecycleGate {
  sweep(): Promise<void>;
  revokeTab(tabId: number): Promise<void>;
}

interface TabLifecycleEvents {
  onRemoved: { addListener(listener: (tabId: number) => void): void };
}

interface NavigationLifecycleEvents {
  onBeforeNavigate: {
    addListener(listener: (details: {
      tabId: number;
      frameId: number;
    }) => void): void;
  };
}

interface FirstRunRuntime {
  onInstalled: {
    addListener(listener: (details: { reason: string }) => void): void;
  };
  openOptionsPage(): Promise<void>;
}

type WorkerResponse = PolicyContext | { grantId: number; source: string } | { opened: true } | {
  error: "unsupported-page" | "invalid-message" | "origin-changed";
};

function isExtensionMessage(message: unknown): message is ExtensionMessage {
  if (!message || typeof message !== "object" || !("type" in message)) return false;

  switch (message.type) {
    case "policy:get-current":
      return true;
    case "options:open":
      return true;
    case "policy:get-tab":
      return "tabId" in message && typeof message.tabId === "number";
    case "policy:set-tab":
      return (
        "tabId" in message &&
        typeof message.tabId === "number" &&
        "mode" in message &&
        isSiteMode(message.mode) &&
        "expectedOrigin" in message &&
        typeof message.expectedOrigin === "string"
      );
    case "provider:authorize":
      return "source" in message && typeof message.source === "string" &&
        "disableAutoplay" in message && typeof message.disableAutoplay === "boolean";
    case "provider:revoke":
      return "grantId" in message && typeof message.grantId === "number";
    default:
      return false;
  }
}

function originFor(tab?: Tab): string | undefined {
  if (!tab?.url) return undefined;

  try {
    const url = new URL(tab.url);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

async function contextFor(
  tab: Tab | undefined,
  store: SitePolicyStore,
): Promise<WorkerResponse> {
  const origin = originFor(tab);
  if (!origin) return { error: "unsupported-page" };

  return { origin, mode: await store.get(origin) };
}

export async function handleExtensionMessage(
  message: unknown,
  sender: MessageSender,
  deps: WorkerDependencies,
): Promise<WorkerResponse> {
  if (!isExtensionMessage(message)) return { error: "invalid-message" };

  const store = new SitePolicyStore(deps.storage);

  switch (message.type) {
    case "options:open":
      await (deps.openOptionsPage ?? (() => chrome.runtime.openOptionsPage()))();
      return { opened: true };
    case "policy:get-current":
      return contextFor(sender.tab, store);
    case "policy:get-tab":
      return contextFor(await deps.tabs.get(message.tabId), store);
    case "policy:set-tab": {
      const origin = originFor(await deps.tabs.get(message.tabId));
      if (!origin) return { error: "unsupported-page" };
      if (origin !== message.expectedOrigin) return { error: "origin-changed" };

      await store.set(origin, message.mode);
      return { origin, mode: message.mode };
    }
    case "provider:authorize": {
      const tabId = sender.tab?.id;
      if (typeof tabId !== "number" || !originFor(sender.tab)) {
        return { error: "unsupported-page" };
      }
      if (!deps.providerGate) await productionProviderReady;
      return providerGate(deps).authorize(
        tabId,
        message.source,
        message.disableAutoplay,
      );
    }
    case "provider:revoke": {
      const tabId = sender.tab?.id;
      if (typeof tabId !== "number" || !originFor(sender.tab)) {
        return { error: "unsupported-page" };
      }
      await providerGate(deps).revoke(tabId, message.grantId);
      return { origin: originFor(sender.tab)!, mode: "protected" };
    }
  }
}

const productionProviderGate = new ProviderRequestGate({
  updateSessionRules: (options) => chrome.declarativeNetRequest.updateSessionRules(options),
  getSessionRules: (filter) => chrome.declarativeNetRequest.getSessionRules(filter),
});

export async function installProviderGateLifecycle(
  gate: ProviderLifecycleGate,
  tabs: TabLifecycleEvents,
  navigation: NavigationLifecycleEvents,
): Promise<void> {
  tabs.onRemoved.addListener((tabId) => void gate.revokeTab(tabId));
  navigation.onBeforeNavigate.addListener(({ tabId, frameId }) => {
    if (frameId === 0) void gate.revokeTab(tabId);
  });
  await gate.sweep();
}

export function installFirstRun(runtime: FirstRunRuntime): void {
  runtime.onInstalled.addListener(({ reason }) => {
    if (reason === "install") void runtime.openOptionsPage();
  });
}

const productionProviderReady = installProviderGateLifecycle(
  productionProviderGate,
  chrome.tabs,
  chrome.webNavigation,
);

function providerGate(
  deps: WorkerDependencies,
): Pick<ProviderRequestGate, "authorize" | "revoke"> {
  return deps.providerGate ?? productionProviderGate;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleExtensionMessage(message, sender, {
    storage: chrome.storage.local,
    tabs: chrome.tabs,
    openOptionsPage: () => chrome.runtime.openOptionsPage(),
  }).then(sendResponse);
  return true;
});

if (chrome.runtime.onInstalled) installFirstRun(chrome.runtime);
