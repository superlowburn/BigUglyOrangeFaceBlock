type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

function descriptionsKey(origin: string): string {
  return `site-descriptions:${origin}`;
}

export class DescriptionPreferencesStore {
  constructor(private readonly area: StorageArea) {}

  async get(origin: string): Promise<boolean> {
    const key = descriptionsKey(origin);
    return (await this.area.get(key))[key] === true;
  }

  async set(origin: string, visible: boolean): Promise<void> {
    await this.area.set({ [descriptionsKey(origin)]: visible });
  }
}
