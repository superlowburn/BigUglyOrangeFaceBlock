import { parseBlockedSubjects } from "../shared/blocked-subjects";

export interface PopupChromeApi {
  storage: {
    local: { get(key: string): Promise<Record<string, unknown>> };
  };
  runtime: { openOptionsPage(): Promise<void> };
}

const TITLE = "Big Ugly Orange Face";
const START_ERROR = "Subject settings are unavailable.";

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
  const subjects = createTextElement("div", "popup-subjects", "");
  const subjectsTitle = createTextElement("span", "popup-subjects-title", "Subject frosting");
  const subjectsState = createTextElement("span", "popup-subjects-state", "");
  const subjectsDescription = createTextElement("span", "popup-subjects-description", "");
  subjects.append(subjectsTitle, subjectsState, subjectsDescription);
  const error = createTextElement("p", "popup-error", "");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const settings = createTextElement("button", "popup-settings", "Open settings");
  settings.type = "button";
  settings.addEventListener("click", () => void chromeApi.runtime.openOptionsPage());
  root.append(heading, subjects, error, settings);

  try {
    const values = await chromeApi.storage.local.get("blocked-subjects");
    const config = parseBlockedSubjects(values["blocked-subjects"]);
    subjectsState.textContent = config.enabled ? "On" : "Off";
    subjectsDescription.textContent = config.enabled
      ? "Frosting likely matches everywhere."
      : "Turn on subject frosting in Settings.";
  } catch {
    error.textContent = START_ERROR;
    error.hidden = false;
  }
}

const popupRoot = document.querySelector<HTMLElement>("#app");
if (popupRoot && typeof chrome !== "undefined") {
  void mountPopup(popupRoot, {
    storage: { local: { get: (key) => chrome.storage.local.get(key) } },
    runtime: { openOptionsPage: () => chrome.runtime.openOptionsPage() },
  });
}
