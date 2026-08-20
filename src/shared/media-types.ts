export type SiteMode = "trusted" | "protected" | "strict";

export type MediaKind =
  | "image"
  | "background-image"
  | "native-video"
  | "video-iframe";

export interface MediaCandidate {
  element: HTMLElement;
  kind: MediaKind;
}

export interface PolicyContext {
  origin: string;
  mode: SiteMode;
}

export type ExtensionMessage =
  | { type: "policy:get-current" }
  | { type: "policy:get-tab"; tabId: number }
  | { type: "policy:set-tab"; tabId: number; mode: SiteMode; expectedOrigin: string }
  | { type: "options:open" }
  | { type: "provider:authorize"; source: string; disableAutoplay: boolean }
  | { type: "provider:revoke"; grantId: number };
