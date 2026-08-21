import type { SiteMode } from "./media-types";

type StorageArea = {
  get(key: string | string[]): Promise<Record<string, unknown>>;
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
export const defaultPolicyKey = "default-site-mode";

export function policyKey(origin: string): string {
  return `site-policy:${origin}`;
}

export function descriptionsKey(origin: string): string {
  return `site-descriptions:${origin}`;
}

export function isSiteMode(value: unknown): value is SiteMode {
  return value === "trusted" || value === "protected" || value === "strict";
}

function supportedMode(value: unknown): SiteMode | null {
  if (value === "strict") return "protected";
  return value === "trusted" || value === "protected" ? value : null;
}

export class SitePolicyStore {
  constructor(
    private readonly area: StorageArea,
    private readonly onChanged?: StorageChangeEvent,
  ) {}

  async get(origin: string): Promise<SiteMode> {
    const key = policyKey(origin);
    const values = await this.area.get([key, defaultPolicyKey]);
    const value = values[key];

    return supportedMode(value) ?? supportedMode(values[defaultPolicyKey]) ?? defaultMode;
  }

  async set(origin: string, mode: SiteMode): Promise<void> {
    await this.area.set({ [policyKey(origin)]: supportedMode(mode) ?? defaultMode });
  }

  async setDefault(mode: Exclude<SiteMode, "trusted">): Promise<void> {
    await this.area.set({ [defaultPolicyKey]: supportedMode(mode) ?? defaultMode });
  }

  async getDescriptionsVisible(origin: string): Promise<boolean> {
    const key = descriptionsKey(origin);
    return (await this.area.get(key))[key] === true;
  }

  async setDescriptionsVisible(origin: string, visible: boolean): Promise<void> {
    await this.area.set({ [descriptionsKey(origin)]: visible });
  }

  watch(origin: string, listener: (mode: SiteMode) => void): () => void {
    const key = policyKey(origin);
    const onChange: StorageChangeListener = (changes, areaName) => {
      if (areaName !== "local" || !(key in changes)) return;

      listener(supportedMode(changes[key]?.newValue) ?? defaultMode);
    };

    this.onChanged?.addListener(onChange);

    return () => this.onChanged?.removeListener(onChange);
  }
}
