import type { ExtensionMessage, PolicyContext } from "../shared/media-types";
import { SitePolicyStore } from "../shared/site-policy";

type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type Tab = { id?: number | undefined; url?: string | undefined };

type MessageSender = { tab?: Tab };

type WorkerDependencies = {
  storage: StorageArea;
  tabs: { get(tabId: number): Promise<Tab> };
};

type PolicyResponse = PolicyContext | { error: "unsupported-page" };

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
): Promise<PolicyResponse> {
  const origin = originFor(tab);
  if (!origin) return { error: "unsupported-page" };

  return { origin, mode: await store.get(origin) };
}

export async function handleExtensionMessage(
  message: ExtensionMessage,
  sender: MessageSender,
  deps: WorkerDependencies,
): Promise<PolicyResponse> {
  const store = new SitePolicyStore(deps.storage);

  switch (message.type) {
    case "policy:get-current":
      return contextFor(sender.tab, store);
    case "policy:get-tab":
      return contextFor(await deps.tabs.get(message.tabId), store);
    case "policy:set-tab": {
      const origin = originFor(await deps.tabs.get(message.tabId));
      if (!origin) return { error: "unsupported-page" };

      await store.set(origin, message.mode);
      return { origin, mode: message.mode };
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleExtensionMessage(message as ExtensionMessage, sender, {
    storage: chrome.storage.local,
    tabs: chrome.tabs,
  }).then(sendResponse);
  return true;
});
