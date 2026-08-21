import { defaultPolicyKey, isSiteMode, SitePolicyStore } from "../shared/site-policy";
import {
  BlockedSubjectsStore,
  parseBlockedSubjects,
  uniqueKeywords,
} from "../shared/blocked-subjects";

export interface OptionsChromeApi {
  storage: {
    local: {
      get(keys: null | string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
}

export async function mountOptions(
  root: HTMLElement,
  chromeApi: OptionsChromeApi,
): Promise<void> {
  const values = await chromeApi.storage.local.get(null);
  const store = new SitePolicyStore(chromeApi.storage.local);
  const blockedStore = new BlockedSubjectsStore(chromeApi.storage.local);
  const defaultMode = values[defaultPolicyKey] === "strict" ? "strict" : "protected";
  const status = root.querySelector<HTMLElement>("#save-status");
  const defaultButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-default-mode]"),
  );

  const selectDefault = (mode: "protected" | "strict"): void => {
    for (const button of defaultButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.defaultMode === mode));
    }
  };
  selectDefault(defaultMode);

  const blocked = parseBlockedSubjects(values["blocked-subjects"]);
  const blockedEnabled = root.querySelector<HTMLInputElement>("#blocked-subjects-enabled");
  const blockedKeywords = root.querySelector<HTMLTextAreaElement>("#blocked-subject-keywords");
  const blockedStatus = root.querySelector<HTMLElement>("#blocked-subjects-status");
  if (blockedEnabled) blockedEnabled.checked = blocked.enabled;
  if (blockedKeywords) blockedKeywords.value = blocked.keywords.join("\n");
  const saveBlockedSubjects = (): void => {
    const config = parseBlockedSubjects({
      enabled: blockedEnabled?.checked ?? false,
      keywords: uniqueKeywords(blockedKeywords?.value.split("\n") ?? []),
    });
    if (blockedKeywords) blockedKeywords.value = config.keywords.join("\n");
    void blockedStore.set(config).then(() => {
      values["blocked-subjects"] = config;
      if (blockedStatus) blockedStatus.textContent = "Saved locally";
    });
  };
  blockedEnabled?.addEventListener("change", saveBlockedSubjects);
  blockedKeywords?.addEventListener("change", saveBlockedSubjects);

  for (const button of defaultButtons) {
    button.addEventListener("click", () => {
      const mode = button.dataset.defaultMode === "strict" ? "strict" : "protected";
      selectDefault(mode);
      void store.setDefault(mode).then(() => {
        values[defaultPolicyKey] = mode;
        if (status) status.textContent = "Saved";
      });
    });
  }

  const rules = root.querySelector<HTMLElement>("#site-rules");
  const renderRules = (): void => {
    if (!rules) return;
    const entries = Object.entries(values).filter(([key, value]) =>
      key.startsWith("site-policy:") && isSiteMode(value));
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-rules";
      empty.textContent = "No site exceptions yet.";
      rules.replaceChildren(empty);
      return;
    }

    rules.replaceChildren(...entries.map(([key, mode]) => {
      const origin = key.slice("site-policy:".length);
      const row = document.createElement("div");
      row.className = "site-rule";
      const copy = document.createElement("span");
      const host = document.createElement("strong");
      try {
        host.textContent = new URL(origin).hostname;
      } catch {
        host.textContent = origin;
      }
      const label = document.createElement("span");
      label.textContent = mode === "trusted" ? "Always show" : mode === "strict" ? "Always frost" : "Protected";
      copy.append(host, label);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.removePolicy = key;
      remove.textContent = "Use default";
      remove.addEventListener("click", () => {
        delete values[key];
        renderRules();
        void chromeApi.storage.local.remove(key);
      });
      row.append(copy, remove);
      return row;
    }));
  };
  renderRules();

  const demo = root.querySelector<HTMLElement>("#demo-media");
  const demoReveal = root.querySelector<HTMLButtonElement>("#demo-reveal");
  demoReveal?.addEventListener("click", () => {
    const revealed = demo?.classList.toggle("is-revealed") ?? false;
    demoReveal.textContent = revealed ? "Frost again" : "Click to reveal";
  });
}

if (typeof chrome !== "undefined" && typeof document !== "undefined") {
  const root = document.querySelector<HTMLElement>("#app");
  if (root) void mountOptions(root, chrome);
}
