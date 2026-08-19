import type { ExtensionMessage, PolicyContext, SiteMode } from "../shared/media-types";
import { isSiteMode } from "../shared/site-policy";

type PopupTab = { id?: number | undefined; url?: string | undefined };

export interface PopupChromeApi {
  tabs: {
    query(queryInfo: { active: true; currentWindow: true }): Promise<PopupTab[]>;
  };
  runtime: {
    sendMessage(message: ExtensionMessage): Promise<unknown>;
  };
}

type ModeOption = {
  mode: SiteMode;
  label: string;
  description: string;
};

const TITLE = "Goggles";
const GROUP_LABEL = "Image protection for this site";
const SAVE_ERROR = "Could not update protection. Try again.";
const START_ERROR = "Protection settings are unavailable on this page.";

const MODES: readonly ModeOption[] = [
  { mode: "trusted", label: "Trusted", description: "Show normally" },
  { mode: "protected", label: "Protected", description: "Frost individually" },
  { mode: "strict", label: "Strict", description: "Always re-protect" },
];

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
  const hostname = createTextElement("p", "popup-hostname", "");
  hostname.setAttribute("aria-live", "polite");
  const group = document.createElement("div");
  group.className = "mode-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", GROUP_LABEL);
  const error = createTextElement("p", "popup-error", "");
  error.setAttribute("role", "alert");
  error.hidden = true;
  root.append(heading, hostname, group, error);

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

  try {
    hostname.textContent = new URL(initialResponse.origin).hostname;
  } catch {
    error.textContent = START_ERROR;
    error.hidden = false;
    return;
  }

  let confirmedMode = initialResponse.mode;
  const buttons = new Map<SiteMode, HTMLButtonElement>();

  const selectMode = (selectedMode: SiteMode): void => {
    for (const [mode, button] of buttons) {
      button.setAttribute("aria-pressed", String(mode === selectedMode));
    }
  };

  const setBusy = (busy: boolean): void => {
    for (const button of buttons.values()) button.disabled = busy;
  };

  for (const option of MODES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode-button";
    button.dataset.mode = option.mode;
    button.setAttribute("aria-pressed", String(option.mode === confirmedMode));
    button.append(
      createTextElement("span", "mode-label", option.label),
      createTextElement("span", "mode-description", option.description),
    );
    buttons.set(option.mode, button);
    group.append(button);

    button.addEventListener("click", async () => {
      if (button.disabled || option.mode === confirmedMode) return;

      const priorMode = confirmedMode;
      error.hidden = true;
      error.textContent = "";
      selectMode(option.mode);
      setBusy(true);

      try {
        const response = await chromeApi.runtime.sendMessage({
          type: "policy:set-tab",
          tabId,
          mode: option.mode,
          expectedOrigin: initialResponse.origin,
        });
        if (
          !isPolicyContext(response) ||
          response.mode !== option.mode ||
          response.origin !== initialResponse.origin
        ) {
          throw new TypeError("Invalid policy response");
        }
        confirmedMode = response.mode;
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
}

const popupRoot = document.querySelector<HTMLElement>("#app");
if (popupRoot && typeof chrome !== "undefined") {
  void mountPopup(popupRoot, {
    tabs: { query: (queryInfo) => chrome.tabs.query(queryInfo) },
    runtime: { sendMessage: (message) => chrome.runtime.sendMessage(message) },
  }).catch(() => {
    popupRoot.replaceChildren(createTextElement("p", "popup-error", START_ERROR));
  });
}
