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
  const blockedStore = new BlockedSubjectsStore(chromeApi.storage.local);

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

  const rules = root.querySelector<HTMLElement>("#site-rules");
  const renderRules = (): void => {
    if (!rules) return;
    const entries = Object.entries(values).filter(([key, value]) =>
      key.startsWith("site-policy:") && value === "trusted");
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-rules";
      empty.textContent = "No sites are showing images and videos. Use the Goggles menu on a page to change this.";
      rules.replaceChildren(empty);
      return;
    }

    rules.replaceChildren(...entries.map(([key]) => {
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
      label.textContent = "Showing images and videos";
      copy.append(host, label);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.removePolicy = key;
      remove.textContent = "Frost images and videos again";
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
