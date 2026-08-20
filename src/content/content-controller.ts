import { classifyElement } from "../media/classifier";
import { resolveDescription } from "../media/description";
import { NativeVideoController } from "../media/native-video";
import { isSupportedVideoFrame, ProviderFrameController } from "../media/provider-frames";
import {
  ProtectionRenderer,
  type ProtectionHandle,
  type ProtectionOptions,
  type SiteAllowedControlOptions,
} from "../protection/renderer";
import type {
  MediaCandidate,
  PolicyContext,
  SiteMode,
} from "../shared/media-types";
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
  showSiteAllowedControl?(options: SiteAllowedControlOptions): void;
  hideSiteAllowedControl?(): void;
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
  private readonly setSiteMode: (origin: string, mode: SiteMode) => void | Promise<void>;
  private readonly setDescriptionsVisible: (origin: string, visible: boolean) => void | Promise<void>;
  private readonly openSettings: () => void | Promise<void>;
  private readonly enableSiteControl: boolean;
  private readonly byElement = new WeakMap<Element, ProtectionRecord>();
  private readonly records = new Set<ProtectionRecord>();
  private mode: SiteMode = "trusted";
  private origin: string | null = null;
  private descriptionsVisible = true;
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
    this.setSiteMode = dependencies.setSiteMode ?? (() => undefined);
    this.setDescriptionsVisible = dependencies.setDescriptionsVisible ?? (() => undefined);
    this.openSettings = dependencies.openSettings ?? (() => undefined);
    this.enableSiteControl = dependencies.enableSiteControl ?? true;
  }

  start(context: PolicyContext): void {
    if (this.started) this.stop();
    this.started = true;
    this.origin = context.origin;
    this.mode = context.mode;
    this.descriptionsVisible = context.descriptionsVisible ?? false;
    this.syncSiteControl();
    this.startObservation();
  }

  applyMode(mode: SiteMode): void {
    if (!this.started || mode === this.mode) return;

    if (mode === "trusted") {
      this.mode = mode;
      this.syncSiteControl();
      this.clearProtection();
      this.observer.scan(this.document);
      return;
    }

    if (this.mode === "trusted") {
      this.mode = mode;
      this.syncSiteControl();
      this.startObservation();
      this.observer.scan(this.document);
      return;
    }

    this.mode = mode;
    this.syncSiteControl();
    for (const record of [...this.records]) {
      const { candidate } = record;
      try {
        this.detachRecord(record, false);
        if (!candidate.element.isConnected) {
          this.restoreMedia(candidate);
          continue;
        }
        this.enforceProtection(candidate);
        this.createProtection(candidate);
      } catch {
        this.restoreMedia(candidate);
        this.reportCandidateFailure(candidate.element);
      }
    }
  }

  stop(options: { restoreMedia?: boolean } = {}): void {
    this.stopObservation();
    this.clearProtection(options.restoreMedia ?? true);
    this.renderer.hideSiteAllowedControl?.();
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

  private createProtection(candidate: MediaCandidate): void {
    let prepared = false;
    try {
      const expectedProviderSource = this.prepareMedia(candidate);
      prepared = true;
      let record!: ProtectionRecord;
      const handle = this.renderer.protect(candidate, {
        description: this.describe(candidate),
        mode: this.mode,
        onReveal: () => {
          void this.releaseRecord(record).catch(() => {
            record.handle.reprotect();
            this.reportProviderFailure(candidate.element);
          });
        },
        onRevealAll: () => this.revealAll(),
        onAllowSite: () => this.requestSiteMode("trusted"),
        onOpenSettings: () => void Promise.resolve(this.openSettings()).catch(() => undefined),
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

  private revealAll(): void {
    for (const record of [...this.records]) record.handle.reveal();
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

  private requestSiteMode(mode: SiteMode): void {
    if (!this.origin) return;
    void Promise.resolve(this.setSiteMode(this.origin, mode)).catch(() => undefined);
  }

  private syncSiteControl(): void {
    if (this.enableSiteControl && this.mode === "trusted") {
      this.renderer.showSiteAllowedControl?.({
        onProtectSite: () => this.requestSiteMode("protected"),
        onOpenSettings: () => void Promise.resolve(this.openSettings()).catch(() => undefined),
      });
      return;
    }
    this.renderer.hideSiteAllowedControl?.();
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
