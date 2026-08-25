import {
  BlockedSubjectsStore,
  type BlockedSubjectsConfig,
} from "../shared/blocked-subjects";

export interface PopupChromeApi {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
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

  const header = createTextElement("header", "popup-header", "");
  const logo = document.createElement("img");
  logo.className = "popup-logo";
  logo.src = "../icons/icon.svg";
  logo.alt = "";
  const headerCopy = createTextElement("div", "popup-header-copy", "");
  const heading = createTextElement("h1", "popup-title", TITLE);
  const tagline = createTextElement("p", "popup-tagline", "Keep the Orange One out of sight.");
  headerCopy.append(heading, tagline);
  header.append(logo, headerCopy);

  const subjects = createTextElement("section", "popup-subjects", "");
  const subjectHeader = createTextElement("div", "popup-subject-header", "");
  const subjectsTitle = createTextElement("h2", "popup-subjects-title", "Donald Trump");
  const switchLabel = createTextElement("label", "popup-switch-label", "");
  const subjectsState = createTextElement("span", "popup-subjects-state", "");
  const subjectSwitch = document.createElement("input");
  subjectSwitch.className = "popup-switch";
  subjectSwitch.type = "checkbox";
  subjectSwitch.setAttribute("role", "switch");
  subjectSwitch.setAttribute("aria-label", "Frost pictures of Donald Trump");
  subjectSwitch.disabled = true;
  switchLabel.append(subjectsState, subjectSwitch);
  subjectHeader.append(subjectsTitle, switchLabel);
  const subjectsDescription = createTextElement("p", "popup-subjects-description", "");
  subjects.append(subjectHeader, subjectsDescription);
  const error = createTextElement("p", "popup-error", "");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const settings = createTextElement("button", "popup-settings", "Edit matching words & settings");
  settings.type = "button";
  settings.addEventListener("click", () => void chromeApi.runtime.openOptionsPage());
  const privacy = createTextElement(
    "p",
    "popup-privacy",
    "Works locally. Your images never leave this device.",
  );
  root.append(header, subjects, error, settings, privacy);

  try {
    const store = new BlockedSubjectsStore(chromeApi.storage.local);
    let config = await store.get();
    renderSubjectState(config, subjectSwitch, subjectsState, subjectsDescription);
    subjectSwitch.disabled = false;
    subjectSwitch.addEventListener("change", () => {
      const next = { ...config, enabled: subjectSwitch.checked };
      void store.set(next).then(() => {
        config = next;
        error.hidden = true;
        renderSubjectState(config, subjectSwitch, subjectsState, subjectsDescription);
      }).catch(() => {
        renderSubjectState(config, subjectSwitch, subjectsState, subjectsDescription);
        error.textContent = START_ERROR;
        error.hidden = false;
      });
    });
  } catch {
    error.textContent = START_ERROR;
    error.hidden = false;
  }
}

function renderSubjectState(
  config: BlockedSubjectsConfig,
  subjectSwitch: HTMLInputElement,
  state: HTMLElement,
  description: HTMLElement,
): void {
  subjectSwitch.checked = config.enabled;
  state.textContent = config.enabled ? "On" : "Off";
  description.textContent = config.enabled
    ? "Likely pictures of Donald Trump are frosted on every site."
    : "Pictures of Donald Trump are currently visible.";
}

const popupRoot = document.querySelector<HTMLElement>("#app");
if (popupRoot && typeof chrome !== "undefined") {
  void mountPopup(popupRoot, {
    storage: {
      local: {
        get: (key) => chrome.storage.local.get(key),
        set: (items) => chrome.storage.local.set(items),
      },
    },
    runtime: { openOptionsPage: () => chrome.runtime.openOptionsPage() },
  });
}
