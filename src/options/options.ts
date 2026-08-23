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
    };
  };
}

export async function mountOptions(
  root: HTMLElement,
  chromeApi: OptionsChromeApi,
): Promise<void> {
  document.title = "Big Ugly Orange Face Settings";
  const values = await chromeApi.storage.local.get("blocked-subjects");
  const blockedStore = new BlockedSubjectsStore(chromeApi.storage.local);
  const blocked = parseBlockedSubjects(values["blocked-subjects"]);
  const enabled = root.querySelector<HTMLInputElement>("#blocked-subjects-enabled");
  const keywords = root.querySelector<HTMLTextAreaElement>("#blocked-subject-keywords");
  const status = root.querySelector<HTMLElement>("#blocked-subjects-status");

  if (enabled) enabled.checked = blocked.enabled;
  if (keywords) keywords.value = blocked.keywords.join("\n");

  const save = (): void => {
    const config = parseBlockedSubjects({
      enabled: enabled?.checked ?? false,
      keywords: uniqueKeywords(keywords?.value.split("\n") ?? []),
    });
    if (keywords) keywords.value = config.keywords.join("\n");
    void blockedStore.set(config).then(() => {
      if (status) status.textContent = "Saved locally";
    });
  };
  enabled?.addEventListener("change", save);
  keywords?.addEventListener("change", save);
}

if (typeof chrome !== "undefined" && typeof document !== "undefined") {
  const root = document.querySelector<HTMLElement>("#app");
  if (root) void mountOptions(root, chrome);
}
