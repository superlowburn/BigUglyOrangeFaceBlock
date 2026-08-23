export type MediaKind =
  | "image"
  | "background-image"
  | "native-video"
  | "video-iframe";

export interface MediaCandidate {
  element: HTMLElement;
  kind: MediaKind;
}

export interface ProtectionContext {
  origin: string;
  descriptionsVisible?: boolean;
  blockedSubjects?: import("./blocked-subjects").BlockedSubjectsConfig;
}

export type ExtensionMessage =
  | { type: "options:open" }
  | { type: "provider:authorize"; source: string; disableAutoplay: boolean }
  | { type: "provider:revoke"; grantId: number };
