import { supportedProviderUrl } from "../media/provider-frames";

export interface ProviderAuthorization {
  grantId: number;
  source: string;
}

interface RuleUpdate {
  addRules: chrome.declarativeNetRequest.Rule[];
  removeRuleIds: number[];
}

export interface ProviderRequestGateEnvironment {
  updateSessionRules(options: RuleUpdate): Promise<void>;
  getSessionRules?(filter: chrome.declarativeNetRequest.GetRulesFilter): Promise<
    chrome.declarativeNetRequest.Rule[]
  >;
  token?: () => string;
  ruleId?: () => number;
  setTimeout?: (callback: () => void, delay: number) => number;
  clearTimeout?: (handle: number) => void;
}

interface GrantState {
  tabId: number;
  timer: number;
}

const grantLifetimeMs = 10_000;

export class ProviderRequestGate {
  private readonly updateSessionRules: (options: RuleUpdate) => Promise<void>;
  private readonly getSessionRules: ((
    filter: chrome.declarativeNetRequest.GetRulesFilter,
  ) => Promise<chrome.declarativeNetRequest.Rule[]>) | undefined;
  private readonly token: () => string;
  private readonly ruleId: () => number;
  private readonly setTimer: (callback: () => void, delay: number) => number;
  private readonly clearTimer: (handle: number) => void;
  private readonly grants = new Map<number, GrantState>();
  private operations: Promise<void> = Promise.resolve();

  constructor(environment: ProviderRequestGateEnvironment) {
    this.updateSessionRules = environment.updateSessionRules;
    this.getSessionRules = environment.getSessionRules;
    this.token = environment.token ?? randomToken;
    this.ruleId = environment.ruleId ?? randomRuleId;
    this.setTimer = environment.setTimeout ?? ((callback, delay) => self.setTimeout(callback, delay));
    this.clearTimer = environment.clearTimeout ?? ((handle) => self.clearTimeout(handle));
  }

  async authorize(
    tabId: number,
    source: string,
    disableAutoplay = true,
  ): Promise<ProviderAuthorization> {
    return this.serialize(() => this.authorizeNow(
      tabId,
      source,
      disableAutoplay,
    ));
  }

  async revoke(tabId: number, grantId: number): Promise<void> {
    await this.serialize(() => this.revokeNow(tabId, grantId));
  }

  async revokeTab(tabId: number): Promise<void> {
    await this.serialize(() => this.revokeTabNow(tabId));
  }

  async sweep(): Promise<void> {
    await this.serialize(() => this.sweepNow());
  }

  private async authorizeNow(
    tabId: number,
    source: string,
    disableAutoplay: boolean,
  ): Promise<ProviderAuthorization> {
    const parsed = supportedProviderUrl(source);
    if (!parsed) throw new TypeError("Unsupported provider URL");

    if (disableAutoplay) parsed.searchParams.set("autoplay", "0");
    parsed.searchParams.set("eg_eclipse_goggles", this.token());
    const grantId = this.uniqueRuleId();
    const requestUrl = new URL(parsed.href);
    requestUrl.hash = "";
    const rule: chrome.declarativeNetRequest.Rule = {
      id: grantId,
      priority: 2,
      action: { type: "allow" },
      condition: {
        regexFilter: `^${escapeRegex(requestUrl.href)}$`,
        resourceTypes: ["sub_frame"],
        tabIds: [tabId],
      },
    };
    await this.updateSessionRules({ addRules: [rule], removeRuleIds: [] });
    const timer = this.setTimer(() => void this.revoke(tabId, grantId), grantLifetimeMs);
    this.grants.set(grantId, {
      tabId,
      timer,
    });
    return { grantId, source: parsed.href };
  }

  private async revokeNow(tabId: number, grantId: number): Promise<void> {
    const local = this.grants.get(grantId);
    let ownerTabId = local?.tabId;
    if (ownerTabId === undefined && this.getSessionRules) {
      const [rule] = await this.getSessionRules({ ruleIds: [grantId] });
      if (rule?.condition.tabIds?.includes(tabId)) ownerTabId = tabId;
    }
    if (ownerTabId !== tabId) return;
    await this.updateSessionRules({ addRules: [], removeRuleIds: [grantId] });
    if (local) this.clearTimer(local.timer);
    this.grants.delete(grantId);
  }

  private async revokeTabNow(tabId: number): Promise<void> {
    const ids = new Set<number>();
    for (const [grantId, grant] of this.grants) {
      if (grant.tabId === tabId) ids.add(grantId);
    }
    if (this.getSessionRules) {
      const rules = await this.getSessionRules({});
      for (const rule of rules) {
        if (rule.condition.tabIds?.includes(tabId)) ids.add(rule.id);
      }
    }
    if (ids.size === 0) return;
    const removeRuleIds = [...ids];
    await this.updateSessionRules({ addRules: [], removeRuleIds });
    for (const grantId of removeRuleIds) {
      const local = this.grants.get(grantId);
      if (local) this.clearTimer(local.timer);
      this.grants.delete(grantId);
    }
  }

  private async sweepNow(): Promise<void> {
    if (!this.getSessionRules) return;
    const rules = await this.getSessionRules({});
    for (const grant of this.grants.values()) this.clearTimer(grant.timer);
    this.grants.clear();
    if (rules.length === 0) return;
    await this.updateSessionRules({
      addRules: [],
      removeRuleIds: rules.map(({ id }) => id),
    });
  }

  private uniqueRuleId(): number {
    let id = this.ruleId();
    while (this.grants.has(id)) id = this.ruleId();
    return id;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation, operation);
    this.operations = result.then(() => undefined, () => undefined);
    return result;
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomRuleId(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return 10_000 + (value[0]! % 2_000_000_000);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
