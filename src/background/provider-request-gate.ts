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
}

export class ProviderRequestGate {
  private readonly updateSessionRules: (options: RuleUpdate) => Promise<void>;
  private readonly getSessionRules: ((
    filter: chrome.declarativeNetRequest.GetRulesFilter,
  ) => Promise<chrome.declarativeNetRequest.Rule[]>) | undefined;
  private readonly token: () => string;
  private readonly ruleId: () => number;
  private readonly grants = new Map<number, number>();

  constructor(environment: ProviderRequestGateEnvironment) {
    this.updateSessionRules = environment.updateSessionRules;
    this.getSessionRules = environment.getSessionRules;
    this.token = environment.token ?? randomToken;
    this.ruleId = environment.ruleId ?? randomRuleId;
  }

  async authorize(
    tabId: number,
    source: string,
    disableAutoplay = true,
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
    this.grants.set(grantId, tabId);
    return { grantId, source: parsed.href };
  }

  async revoke(tabId: number, grantId: number): Promise<void> {
    let ownerTabId = this.grants.get(grantId);
    if (ownerTabId === undefined && this.getSessionRules) {
      const [rule] = await this.getSessionRules({ ruleIds: [grantId] });
      if (rule?.condition.tabIds?.includes(tabId)) ownerTabId = tabId;
    }
    if (ownerTabId !== tabId) return;
    await this.updateSessionRules({ addRules: [], removeRuleIds: [grantId] });
    this.grants.delete(grantId);
  }

  private uniqueRuleId(): number {
    let id = this.ruleId();
    while (this.grants.has(id)) id = this.ruleId();
    return id;
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
