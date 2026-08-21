import type { MediaCandidate } from "./media-types";

type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  area: string,
) => void;

type StorageChangeEvent = {
  addListener(listener: StorageChangeListener): void;
  removeListener(listener: StorageChangeListener): void;
};

export interface BlockedSubjectsConfig {
  enabled: boolean;
  keywords: string[];
}

export const blockedSubjectsKey = "blocked-subjects";
export const defaultTrumpKeywords = [
  "Donald Trump",
  "Donald J. Trump",
  "President Trump",
  "Former President Trump",
  "Trump",
  "@realDonaldTrump",
  "The Donald",
];

export function parseBlockedSubjects(value: unknown): BlockedSubjectsConfig {
  if (!value || typeof value !== "object") {
    return { enabled: false, keywords: [...defaultTrumpKeywords] };
  }
  const candidate = value as { enabled?: unknown; keywords?: unknown };
  const keywords = Array.isArray(candidate.keywords)
    ? uniqueKeywords(candidate.keywords.filter((item): item is string => typeof item === "string"))
    : [];
  return {
    enabled: candidate.enabled === true,
    keywords: keywords.length > 0 ? keywords : [...defaultTrumpKeywords],
  };
}

export function matchesBlockedSubject(
  element: HTMLElement,
  keywords: readonly string[],
): boolean {
  return textMatchesBlockedSubject(subjectContext(element), keywords);
}

export function candidateMatchesBlockedSubject(
  candidate: MediaCandidate,
  config: BlockedSubjectsConfig,
): boolean {
  return config.enabled &&
    isSubjectCandidate(candidate) &&
    (matchesBlockedSubject(candidate.element, config.keywords) ||
      (candidate.kind === "background-image" && textMatchesBlockedSubject(
        candidate.element.ownerDocument.defaultView?.getComputedStyle(candidate.element).backgroundImage ?? "",
        config.keywords,
      )));
}

export class BlockedSubjectsStore {
  constructor(
    private readonly area: StorageArea,
    private readonly onChanged?: StorageChangeEvent,
  ) {}

  async get(): Promise<BlockedSubjectsConfig> {
    return parseBlockedSubjects((await this.area.get(blockedSubjectsKey))[blockedSubjectsKey]);
  }

  async set(config: BlockedSubjectsConfig): Promise<void> {
    await this.area.set({ [blockedSubjectsKey]: parseBlockedSubjects(config) });
  }

  watch(listener: (config: BlockedSubjectsConfig) => void): () => void {
    const onChange: StorageChangeListener = (changes, area) => {
      if (area === "local" && blockedSubjectsKey in changes) {
        listener(parseBlockedSubjects(changes[blockedSubjectsKey]?.newValue));
      }
    };
    this.onChanged?.addListener(onChange);
    return () => this.onChanged?.removeListener(onChange);
  }
}

export function uniqueKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  return keywords.flatMap((keyword) => {
    const normalized = keyword.replace(/\s+/gu, " ").trim();
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function subjectContext(element: HTMLElement): string {
  const values = ["alt", "aria-label", "title", "src", "data-src", "poster"]
    .map((name) => element.getAttribute(name) ?? "");
  const link = element.closest("a[href]");
  if (link) values.push(
    link.getAttribute("href") ?? "",
    link.getAttribute("aria-label") ?? "",
    link.getAttribute("title") ?? "",
  );
  const container = element.closest("figure, shreddit-post, [data-testid*='post']");
  if (container) {
    values.push(...Array.from(container.querySelectorAll(
      "h1, h2, h3, h4, figcaption, [slot='title'], [slot='post-title']",
    )).map((node) => node.textContent ?? ""));
  }
  return values.join(" ").replace(/\s+/gu, " ");
}

function isSubjectCandidate(candidate: MediaCandidate): boolean {
  return candidate.kind === "image" ||
    candidate.kind === "background-image" ||
    candidate.kind === "native-video" ||
    candidate.kind === "video-iframe";
}

function subjectPattern(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu");
}

function textMatchesBlockedSubject(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => subjectPattern(keyword).test(text));
}
