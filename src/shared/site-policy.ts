import type { SiteMode } from "./media-types";

type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type StorageChange = { newValue?: unknown };
type StorageChangeListener = (
  changes: Record<string, StorageChange>,
  areaName: string,
) => void;

type StorageChangeEvent = {
  addListener(listener: StorageChangeListener): void;
  removeListener(listener: StorageChangeListener): void;
};

const defaultMode: SiteMode = "protected";

export function policyKey(origin: string): string {
  return `site-policy:${origin}`;
}

export function isSiteMode(value: unknown): value is SiteMode {
  return value === "trusted" || value === "protected" || value === "strict";
}

export class SitePolicyStore {
  constructor(
    private readonly area: StorageArea,
    private readonly onChanged?: StorageChangeEvent,
  ) {}

  async get(origin: string): Promise<SiteMode> {
    const key = policyKey(origin);
    const values = await this.area.get(key);
    const value = values[key];

    return isSiteMode(value) ? value : defaultMode;
  }

  async set(origin: string, mode: SiteMode): Promise<void> {
    await this.area.set({ [policyKey(origin)]: mode });
  }

  watch(origin: string, listener: (mode: SiteMode) => void): () => void {
    const key = policyKey(origin);
    const onChange: StorageChangeListener = (changes, areaName) => {
      if (areaName !== "local" || !(key in changes)) return;

      listener(isSiteMode(changes[key]?.newValue) ? changes[key].newValue : defaultMode);
    };

    this.onChanged?.addListener(onChange);

    return () => this.onChanged?.removeListener(onChange);
  }
}
