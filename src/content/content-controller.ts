import { classifyElement } from "../media/classifier";
import { resolveDescription } from "../media/description";
import { NativeVideoController } from "../media/native-video";
import { isSupportedVideoFrame, ProviderFrameController } from "../media/provider-frames";
import {
  ProtectionRenderer,
  type ProtectionHandle,
  type ProtectionOptions,
} from "../protection/renderer";
import type {
  MediaCandidate,
  PolicyContext,
  SiteMode,
} from "../shared/media-types";
import {
  candidateMatchesBlockedSubject,
  parseBlockedSubjects,
  type BlockedSubjectsConfig,
} from "../shared/blocked-subjects";
import { DocumentObserver } from "./document-observer";

declare const __DEV__: boolean;

export interface DocumentObserverPort {
  start(
    onCandidates: (elements: readonly Element[]) => void,
    onLayoutChange?: () => void,
  ): void;
  scan(root: ParentNode): void;
  stop(): void;
  hadRelevantAttributeChange?(element: Element): boolean;
  trackLayout?(element: Element): void;
  untrackLayout?(element: Element): void;
}

interface RendererPort {
  protect(candidate: MediaCandidate, options: ProtectionOptions): ProtectionHandle;
}

interface NativeVideoPort {
  secure(video: HTMLVideoElement): void;
  release(video: HTMLVideoElement): void;
  reprotect(video: HTMLVideoElement): void;
  restore(video: HTMLVideoElement): void;
}

interface ProviderFramePort {
  gate(frame: HTMLIFrameElement): void;
  release(frame: HTMLIFrameElement): void | Promise<void>;
  regate(frame: HTMLIFrameElement): void;
  restore(frame: HTMLIFrameElement): void | Promise<void>;
  trust?(frame: HTMLIFrameElement): void | Promise<void>;
  forget?(frame: HTMLIFrameElement): void;
  dispose?(): void;
}

export interface ContentControllerDependencies {
  document?: Document;
  observer?: DocumentObserverPort;
  renderer?: RendererPort;
  nativeVideo?: NativeVideoPort;
  providerFrames?: ProviderFramePort;
  classify?: (element: Element) => MediaCandidate | null;
  resolveDescription?: (candidate: MediaCandidate) => string;
  development?: boolean;
  logDiagnostic?: (tagName: string, message: string) => void;
  setSiteMode?: (origin: string, mode: SiteMode) => void | Promise<void>;
  setDescriptionsVisible?: (origin: string, visible: boolean) => void | Promise<void>;
  openSettings?: () => void | Promise<void>;
  enableSiteControl?: boolean;
}

interface ProtectionRecord {
  candidate: MediaCandidate;
  handle: ProtectionHandle;
  expectedProviderSource?: string | null;
}

export class ContentController {
  private readonly document: Document;
  private readonly observer: DocumentObserverPort;
  private readonly renderer: RendererPort;
  private readonly nativeVideo: NativeVideoPort;
  private readonly providerFrames: ProviderFramePort;
  private readonly classify: (element: Element) => MediaCandidate | null;
  private readonly describe: (candidate: MediaCandidate) => string;
  private readonly development: boolean;
  private readonly logDiagnostic: (tagName: string, message: string) => void;
  private readonly setDescriptionsVisible: (origin: string, visible: boolean) => void | Promise<void>;
  private readonly byElement = new WeakMap<Element, ProtectionRecord>();
  private readonly records = new Set<ProtectionRecord>();
  private mode: SiteMode = "trusted";
  private origin: string | null = null;
  private descriptionsVisible = true;
  private blockedSubjects = parseBlockedSubjects(null);
  private started = false;
  private observing = false;

  constructor(dependencies: ContentControllerDependencies = {}) {
    this.document = dependencies.document ?? document;
    this.observer = dependencies.observer ?? new DocumentObserver({ document: this.document });
    this.renderer = dependencies.renderer ??
      new ProtectionRenderer({
        document: this.document,
        window: this.document.defaultView ?? window,
      });
    this.nativeVideo = dependencies.nativeVideo ?? new NativeVideoController();
    this.providerFrames = dependencies.providerFrames ?? new ProviderFrameController();
    const view = this.document.defaultView ?? window;
    this.classify = dependencies.classify ??
      ((element) =>
        classifyElement(element, {
          box: (target) => target.getBoundingClientRect(),
          style: (target) => view.getComputedStyle(target),
        }));
    this.describe = dependencies.resolveDescription ?? resolveDescription;
    this.development = dependencies.development ?? isDevelopmentRuntime();
    this.logDiagnostic = dependencies.logDiagnostic ??
      ((tagName, message) => console.warn(`Goggles: ${tagName}: ${message}`));
    this.setDescriptionsVisible = dependencies.setDescriptionsVisible ?? (() => undefined);
  }

  start(context: PolicyContext): void {
    if (this.started) this.stop();
    this.started = true;
    this.origin = context.origin;
    this.mode = normalizeMode(context.mode);
    this.descriptionsVisible = context.descriptionsVisible ?? false;
    this.blockedSubjects = parseBlockedSubjects(context.blockedSubjects);
    this.startObservation();
  }

  applyMode(mode: SiteMode): void {
    mode = normalizeMode(mode);
    if (!this.started || mode === this.mode) return;

    this.mode = mode;
    this.reconcileProtection();
  }

  applyBlockedSubjects(config: BlockedSubjectsConfig): void {
    this.blockedSubjects = parseBlockedSubjects(config);
    if (this.started) this.reconcileProtection();
  }

  stop(options: { restoreMedia?: boolean } = {}): void {
    this.stopObservation();
    this.clearProtection(options.restoreMedia ?? true);
    if (options.restoreMedia === false) this.providerFrames.dispose?.();
    this.mode = "trusted";
    this.origin = null;
    this.started = false;
  }

  private startObservation(): void {
    if (this.observing) return;
    this.observing = true;
    this.observer.start(
      (elements) => {
        for (const element of elements) this.processCandidate(element);
      },
      () => {
        for (const record of this.records) record.handle.update();
      },
    );
    this.observer.scan(this.document);
  }

  private stopObservation(): void {
    if (!this.observing) return;
    this.observer.stop();
    this.observing = false;
  }

  private processCandidate(element: Element): void {
    let detachedCandidate: MediaCandidate | null = null;
    try {
      const existing = this.byElement.get(element);
      if (existing) {
        if (!element.isConnected) {
          this.detachRecord(existing, true);
          return;
        }

        if (!this.observer.hadRelevantAttributeChange?.(element)) {
          existing.handle.update();
          return;
        }

        if (
          existing.handle.isRevealed() &&
          existing.candidate.kind !== "video-iframe"
        ) {
          existing.handle.update();
          return;
        }

        if (existing.candidate.kind === "native-video") {
          this.enforceProtection(existing.candidate);
          existing.handle.update();
          return;
        }

        if (
          existing.candidate.kind === "video-iframe" &&
          element instanceof HTMLIFrameElement
        ) {
          const currentSource = element.getAttribute("src");
          if (currentSource === existing.expectedProviderSource) {
            delete existing.expectedProviderSource;
            existing.handle.update();
            return;
          }

          this.detachRecord(existing, false);
          if (this.providerFrames.forget) this.providerFrames.forget(element);
          else void this.providerFrames.restore(element);
          replaceSource(element, currentSource);
        } else {
          this.detachRecord(existing, false);
          detachedCandidate = existing.candidate;
          this.enforceProtection(existing.candidate);
        }
      }

      if (!element.isConnected) return;
      if (this.mode === "trusted") {
        const candidate = this.classify(element);
        if (candidate && candidateMatchesBlockedSubject(candidate, this.blockedSubjects)) {
          this.createProtection(candidate, true);
          return;
        }
        if (isSupportedVideoFrame(element)) void this.providerFrames.trust?.(element);
        return;
      }
      const candidate = this.classify(element);
      if (!candidate) {
        if (detachedCandidate) this.restoreMedia(detachedCandidate);
        return;
      }
      this.createProtection(candidate);
      detachedCandidate = null;
    } catch {
      if (detachedCandidate) this.restoreMedia(detachedCandidate);
      this.reportCandidateFailure(element);
    }
  }

  private createProtection(candidate: MediaCandidate, blockedSubject = false): void {
    if (isVisualCandidate(candidate) && this.hasOverlappingVideoRecord(candidate)) return;
    if (isVideoCandidate(candidate)) this.removeOverlappingVisualRecords(candidate);

    let prepared = false;
    try {
      const expectedProviderSource = this.prepareMedia(candidate);
      prepared = true;
      let record!: ProtectionRecord;
      const handle = this.renderer.protect(candidate, {
        description: this.describe(candidate),
        blockedSubject,
        mode: this.mode,
        onReveal: () => {
          void this.releaseRecord(record).catch(() => {
            record.handle.reprotect();
            this.reportProviderFailure(candidate.element);
          });
        },
        onToggleDescriptions: () => this.toggleDescriptions(),
        descriptionsVisible: this.descriptionsVisible,
        onReprotect: () => this.enforceRecord(record),
      });
      record = { candidate, handle };
      if (expectedProviderSource !== undefined) {
        record.expectedProviderSource = expectedProviderSource;
      }
      this.byElement.set(candidate.element, record);
      this.records.add(record);
      this.observer.trackLayout?.(candidate.element);
    } catch (error) {
      if (prepared) this.restoreMedia(candidate);
      throw error;
    }
  }

  private hasOverlappingVideoRecord(candidate: MediaCandidate): boolean {
    for (const record of this.records) {
      if (
        isVideoCandidate(record.candidate) &&
        sharesOverlappingMediaStack(candidate.element, record.candidate.element)
      ) {
        return true;
      }
    }
    return false;
  }

  private removeOverlappingVisualRecords(candidate: MediaCandidate): void {
    for (const record of [...this.records]) {
      if (
        isVisualCandidate(record.candidate) &&
        sharesOverlappingMediaStack(record.candidate.element, candidate.element)
      ) {
        this.detachRecord(record, true);
      }
    }
  }

  private toggleDescriptions(): void {
    this.descriptionsVisible = !this.descriptionsVisible;
    if (this.origin) {
      void Promise.resolve(this.setDescriptionsVisible(this.origin, this.descriptionsVisible))
        .catch(() => undefined);
    }
    for (const record of this.records) {
      record.handle.setDescriptionVisible(this.descriptionsVisible);
    }
  }

  private prepareMedia(candidate: MediaCandidate): string | null | undefined {
    if (candidate.kind === "native-video") {
      if (!(candidate.element instanceof HTMLVideoElement)) {
        throw new TypeError("Invalid native video candidate");
      }
      this.nativeVideo.secure(candidate.element);
      return undefined;
    }
    if (candidate.kind === "video-iframe") {
      if (!(candidate.element instanceof HTMLIFrameElement)) {
        throw new TypeError("Invalid provider frame candidate");
      }
      this.providerFrames.gate(candidate.element);
      return candidate.element.getAttribute("src");
    }
    return undefined;
  }

  private async releaseRecord(record: ProtectionRecord): Promise<void> {
    const { candidate } = record;
    if (candidate.kind === "native-video" && candidate.element instanceof HTMLVideoElement) {
      this.nativeVideo.release(candidate.element);
    } else if (
      candidate.kind === "video-iframe" &&
      candidate.element instanceof HTMLIFrameElement
    ) {
      await this.providerFrames.release(candidate.element);
      record.expectedProviderSource = candidate.element.getAttribute("src");
    }
  }

  private enforceRecord(record: ProtectionRecord): void {
    this.enforceProtection(record.candidate);
    if (
      record.candidate.kind === "video-iframe" &&
      record.candidate.element instanceof HTMLIFrameElement
    ) {
      record.expectedProviderSource = record.candidate.element.getAttribute("src");
    }
  }

  private enforceProtection(candidate: MediaCandidate): void {
    if (candidate.kind === "native-video" && candidate.element instanceof HTMLVideoElement) {
      this.nativeVideo.reprotect(candidate.element);
    } else if (
      candidate.kind === "video-iframe" &&
      candidate.element instanceof HTMLIFrameElement
    ) {
      this.providerFrames.regate(candidate.element);
    }
  }

  private restoreMedia(candidate: MediaCandidate): void {
    if (candidate.kind === "native-video" && candidate.element instanceof HTMLVideoElement) {
      this.nativeVideo.restore(candidate.element);
    } else if (
      candidate.kind === "video-iframe" &&
      candidate.element instanceof HTMLIFrameElement
    ) {
      this.providerFrames.restore(candidate.element);
    }
  }

  private detachRecord(record: ProtectionRecord, restore: boolean): void {
    record.handle.remove();
    this.records.delete(record);
    this.byElement.delete(record.candidate.element);
    this.observer.untrackLayout?.(record.candidate.element);
    if (restore) this.restoreMedia(record.candidate);
  }

  private clearProtection(restore = true): void {
    for (const record of [...this.records]) {
      this.detachRecord(record, restore);
      if (
        !restore &&
        record.candidate.kind === "video-iframe" &&
        record.candidate.element instanceof HTMLIFrameElement
      ) {
        this.providerFrames.forget?.(record.candidate.element);
      }
    }
  }

  private reconcileProtection(): void {
    for (const record of [...this.records]) {
      if (!record.candidate.element.isConnected || !this.requiresProtection(record.candidate)) {
        this.detachRecord(record, true);
      }
    }
    this.observer.scan(this.document);
  }

  private requiresProtection(candidate: MediaCandidate): boolean {
    return this.mode !== "trusted" ||
      candidateMatchesBlockedSubject(candidate, this.blockedSubjects);
  }

  private reportCandidateFailure(element: Element): void {
    if (!this.development) return;
    this.logDiagnostic(element.tagName, "candidate processing failed");
  }

  private reportProviderFailure(element: Element): void {
    if (!this.development) return;
    this.logDiagnostic(element.tagName, "provider allow rule failed");
  }
}

function isDevelopmentRuntime(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

function replaceSource(frame: HTMLIFrameElement, source: string | null): void {
  if (source === null) frame.removeAttribute("src");
  else frame.setAttribute("src", source);
}

function normalizeMode(mode: SiteMode): SiteMode {
  return mode === "strict" ? "protected" : mode;
}

function isVisualCandidate(candidate: MediaCandidate): boolean {
  return candidate.kind === "image" || candidate.kind === "background-image";
}

function isVideoCandidate(candidate: MediaCandidate): boolean {
  return candidate.kind === "native-video" || candidate.kind === "video-iframe";
}

function sharesOverlappingMediaStack(first: Element, second: Element): boolean {
  if (first.ownerDocument !== second.ownerDocument || !sharesNearbyAncestor(first, second)) {
    return false;
  }

  const firstBox = first.getBoundingClientRect();
  const secondBox = second.getBoundingClientRect();
  const smallerArea = Math.min(firstBox.width * firstBox.height, secondBox.width * secondBox.height);
  const largerArea = Math.max(firstBox.width * firstBox.height, secondBox.width * secondBox.height);
  if (smallerArea <= 0 || smallerArea / largerArea < 0.5) return false;

  const intersectionWidth = Math.max(
    0,
    Math.min(firstBox.right, secondBox.right) - Math.max(firstBox.left, secondBox.left),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(firstBox.bottom, secondBox.bottom) - Math.max(firstBox.top, secondBox.top),
  );
  return (intersectionWidth * intersectionHeight) / smallerArea >= 0.8;
}

function sharesNearbyAncestor(first: Element, second: Element): boolean {
  const firstAncestors = new Set<Element>();
  let current: Element | null = first;
  for (let depth = 0; current && current !== first.ownerDocument.body && depth < 8; depth += 1) {
    firstAncestors.add(current);
    current = current.parentElement;
  }

  current = second;
  for (let depth = 0; current && current !== second.ownerDocument.body && depth < 8; depth += 1) {
    if (firstAncestors.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}
