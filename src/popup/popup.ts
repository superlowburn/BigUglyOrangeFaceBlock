import type { ExtensionMessage, PolicyContext, SiteMode } from "../shared/media-types";
import { isSiteMode } from "../shared/site-policy";
import type { BlockedSubjectsConfig } from "../shared/blocked-subjects";

type PopupTab = { id?: number | undefined; url?: string | undefined };

export interface PopupChromeApi {
  tabs: {
    query(queryInfo: { active: true; currentWindow: true }): Promise<PopupTab[]>;
  };
  runtime: {
    sendMessage(message: ExtensionMessage): Promise<unknown>;
    openOptionsPage(): Promise<void>;
  };
}

const TITLE = "Goggles";
const SAVE_ERROR = "Could not update protection. Try again.";
const START_ERROR = "Protection settings are unavailable on this page.";

function isPolicyContext(value: unknown): value is PolicyContext {
  return (
    typeof value === "object" &&
    value !== null &&
    "origin" in value &&
    typeof value.origin === "string" &&
    "mode" in value &&
    isSiteMode(value.mode)
  );
}

function isBlockedSubjectsConfig(value: unknown): value is BlockedSubjectsConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "enabled" in value &&
    typeof value.enabled === "boolean" &&
    "keywords" in value &&
    Array.isArray(value.keywords) &&
    value.keywords.every((keyword) => typeof keyword === "string")
  );
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

export async function mountPopup(root: HTMLElement, chromeApi: PopupChromeApi): Promise<void> {
  root.replaceChildren();
  document.title = TITLE;

  const heading = createTextElement("h1", "popup-title", TITLE);
  const protectionSwitch = createTextElement("button", "popup-switch", "");
  protectionSwitch.type = "button";
  protectionSwitch.setAttribute("role", "switch");
  const blockedSubjects = createTextElement("p", "popup-subjects", "");
  const error = createTextElement("p", "popup-error", "");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const settings = createTextElement("button", "popup-settings", "Settings");
  settings.type = "button";
  settings.addEventListener("click", () => void chromeApi.runtime.openOptionsPage());
  root.append(heading, protectionSwitch, blockedSubjects, settings, error);

  const [activeTab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (typeof activeTab?.id !== "number") {
    error.textContent = START_ERROR;
    error.hidden = false;
    return;
  }

  const tabId = activeTab.id;
  const initialResponse = await chromeApi.runtime.sendMessage({
    type: "policy:get-tab",
    tabId,
  });
  if (!isPolicyContext(initialResponse)) {
    error.textContent = START_ERROR;
    error.hidden = false;
    return;
  }
  if (!isBlockedSubjectsConfig(initialResponse.blockedSubjects)) {
    error.textContent = START_ERROR;
    error.hidden = false;
    return;
  }
  blockedSubjects.textContent = initialResponse.blockedSubjects.enabled
    ? "Blocked subjects — On everywhere"
    : "Blocked subjects — Off";

  let hostname: string;
  try {
    hostname = new URL(initialResponse.origin).hostname;
  } catch {
    error.textContent = START_ERROR;
    error.hidden = false;
    return;
  }

  let confirmedMode: Exclude<SiteMode, "strict"> =
    initialResponse.mode === "trusted" ? "trusted" : "protected";

  const selectMode = (selectedMode: Exclude<SiteMode, "strict">): void => {
    protectionSwitch.setAttribute("aria-checked", String(selectedMode === "protected"));
    protectionSwitch.textContent = `Frost images and videos on ${hostname}`;
  };

  const setBusy = (busy: boolean): void => {
    protectionSwitch.disabled = busy;
  };

  selectMode(confirmedMode);
  protectionSwitch.addEventListener("click", async () => {
    if (protectionSwitch.disabled) return;

    const priorMode = confirmedMode;
    const nextMode = confirmedMode === "protected" ? "trusted" : "protected";
    error.hidden = true;
    error.textContent = "";
    selectMode(nextMode);
    setBusy(true);

    try {
      const response = await chromeApi.runtime.sendMessage({
        type: "policy:set-tab",
        tabId,
        mode: nextMode,
        expectedOrigin: initialResponse.origin,
      });
      if (
        !isPolicyContext(response) ||
        response.mode !== nextMode ||
        response.origin !== initialResponse.origin
      ) {
        throw new TypeError("Invalid policy response");
      }
      confirmedMode = nextMode;
      selectMode(confirmedMode);
    } catch {
      selectMode(priorMode);
      error.textContent = SAVE_ERROR;
      error.hidden = false;
    } finally {
      setBusy(false);
    }
  });
}

const popupRoot = document.querySelector<HTMLElement>("#app");
if (popupRoot && typeof chrome !== "undefined") {
  void mountPopup(popupRoot, {
    tabs: { query: (queryInfo) => chrome.tabs.query(queryInfo) },
    runtime: {
      sendMessage: (message) => chrome.runtime.sendMessage(message),
      openOptionsPage: () => chrome.runtime.openOptionsPage(),
    },
  }).catch(() => {
    popupRoot.replaceChildren(createTextElement("p", "popup-error", START_ERROR));
  });
}
