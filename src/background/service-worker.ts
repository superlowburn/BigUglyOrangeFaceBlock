import type { ExtensionMessage } from "../shared/media-types";
import { ProviderRequestGate } from "./provider-request-gate";

type Tab = { id?: number | undefined; url?: string | undefined };

type MessageSender = { tab?: Tab };

type WorkerDependencies = {
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

type WorkerResponse = { grantId: number; source: string } | { opened: true } | { revoked: true } | {
  error: "unsupported-page" | "invalid-message";
};

function isExtensionMessage(message: unknown): message is ExtensionMessage {
  if (!message || typeof message !== "object" || !("type" in message)) return false;

  switch (message.type) {
    case "options:open":
      return true;
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

export async function handleExtensionMessage(
  message: unknown,
  sender: MessageSender,
  deps: WorkerDependencies,
): Promise<WorkerResponse> {
  if (!isExtensionMessage(message)) return { error: "invalid-message" };

  switch (message.type) {
    case "options:open":
      await (deps.openOptionsPage ?? (() => chrome.runtime.openOptionsPage()))();
      return { opened: true };
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
      return { revoked: true };
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
    openOptionsPage: () => chrome.runtime.openOptionsPage(),
  }).then(sendResponse);
  return true;
});

if (chrome.runtime.onInstalled) installFirstRun(chrome.runtime);
