import type { MediaCandidate, MediaKind, SiteMode } from "../shared/media-types";
import { StrictRevealGuard } from "./strict-guard";
import { protectionStyles } from "./styles";

export interface ProtectionHandle {
  reveal(): void;
  reprotect(): void;
  remove(): void;
  update(): void;
  isRevealed(): boolean;
}

export interface ProtectionOptions {
  description: string;
  mode: SiteMode;
  onReveal: () => void;
  onReprotect: () => void;
}

export interface RendererEnvironment {
  document?: Document;
  window?: Window;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  trustedActivation?: (event: Event) => boolean;
  createStrictGuard?: () => Pick<StrictRevealGuard, "watch">;
}

interface ProtectionRecord {
  candidate: MediaCandidate;
  description: string;
  host: HTMLElement;
  layer: HTMLButtonElement;
  onReveal: () => void;
  onReprotect: () => void;
  mode: SiteMode;
  revealed: boolean;
  removed: boolean;
  stopStrictWatch: (() => void) | null;
  handle: ProtectionHandle;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function isTrustedActivation(event: Event): boolean {
  if (!event.isTrusted) return false;
  if (event.type === "click") return true;
  if (event.type !== "keydown") return false;

  const key = (event as KeyboardEvent).key;
  return key === "Enter" || key === " " || key === "Spacebar";
}

export class ProtectionRenderer {
  private readonly document: Document;
  private readonly window: Window;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly trustedActivation: (event: Event) => boolean;
  private readonly createStrictGuard: () => Pick<StrictRevealGuard, "watch">;
  private readonly records = new Map<HTMLElement, ProtectionRecord>();
  private readonly dirtyRecords = new Set<ProtectionRecord>();
  private frame: number | null = null;
  private listening = false;

  constructor(environment: RendererEnvironment = {}) {
    this.document = environment.document ?? document;
    this.window = environment.window ?? window;
    this.requestFrame = environment.requestAnimationFrame ?? this.window.requestAnimationFrame.bind(this.window);
    this.cancelFrame = environment.cancelAnimationFrame ?? this.window.cancelAnimationFrame.bind(this.window);
    this.trustedActivation = environment.trustedActivation ?? isTrustedActivation;
    this.createStrictGuard = environment.createStrictGuard ?? (() => new StrictRevealGuard());
  }

  protect(candidate: MediaCandidate, options: ProtectionOptions): ProtectionHandle {
    const existing = this.records.get(candidate.element);
    if (existing && !existing.removed) return existing.handle;

    const { host, shadow } = this.createRoot(candidate.element);
    const layer = this.document.createElement("button");
    layer.type = "button";
    layer.className = "eg-layer";
    shadow.append(layer);

    let record!: ProtectionRecord;
    const handle: ProtectionHandle = {
      reveal: () => this.reveal(record),
      reprotect: () => this.reprotect(record),
      remove: () => this.remove(record),
      update: () => this.scheduleRecordUpdate(record),
      isRevealed: () => record.revealed,
    };

    record = {
      candidate,
      description: options.description,
      host,
      layer,
      onReveal: options.onReveal,
      onReprotect: options.onReprotect,
      mode: options.mode,
      revealed: false,
      removed: false,
      stopStrictWatch: null,
      handle,
      onMouseEnter: () => layer.classList.add("eg-target-hover"),
      onMouseLeave: () => layer.classList.remove("eg-target-hover"),
    };

    layer.addEventListener("click", (event) => this.activate(record, event));
    candidate.element.addEventListener("mouseenter", record.onMouseEnter);
    candidate.element.addEventListener("mouseleave", record.onMouseLeave);

    this.records.set(candidate.element, record);
    markProtected(candidate);
    const box = candidate.element.getBoundingClientRect();
    this.renderProtected(record, box);
    this.updateRecord(record, box);
    this.startListening();
    return handle;
  }

  debugLayerFor(element: HTMLElement): HTMLButtonElement | null {
    return this.records.get(element)?.layer ?? null;
  }

  private createRoot(target: HTMLElement): { host: HTMLElement; shadow: ShadowRoot } {
    const host = this.document.createElement("div");
    host.setAttribute("data-eclipse-goggles-root", "");
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
    });
    const shadow = host.attachShadow({ mode: "open" });
    const style = this.document.createElement("style");
    style.textContent = protectionStyles;
    shadow.append(style);
    const anchor = target.closest("picture") ?? target;
    anchor.parentNode?.insertBefore(host, anchor.nextSibling);
    if (!host.isConnected) this.document.documentElement.append(host);
    return { host, shadow };
  }

  private activate(record: ProtectionRecord, event: Event): void {
    if (!this.trustedActivation(event) || record.removed) return;
    if (record.revealed) {
      if (record.layer.classList.contains("eg-reprotect")) record.handle.reprotect();
      return;
    }

    record.handle.reveal();
  }

  private reveal(record: ProtectionRecord): void {
    if (record.removed || record.revealed) return;
    record.revealed = true;
    record.layer.className = "eg-layer eg-revealed eg-reprotect";
    record.layer.setAttribute("aria-label", "Protect again");
    record.layer.textContent = "Protect again";
    record.candidate.element.removeAttribute("data-eclipse-goggles-protected");
    record.onReveal();
    this.updateRecord(record);
    if (record.mode === "strict") {
      record.stopStrictWatch = this.createStrictGuard().watch(record.candidate.element, () => {
        record.handle.reprotect();
      });
    }
  }

  private reprotect(record: ProtectionRecord): void {
    if (record.removed || !record.revealed) return;
    record.revealed = false;
    record.stopStrictWatch?.();
    record.stopStrictWatch = null;
    this.renderProtected(record);
    this.updateRecord(record);
    markProtected(record.candidate);
    record.onReprotect();
  }

  private renderProtected(record: ProtectionRecord, box?: DOMRect): void {
    const { layer, description } = record;
    layer.className = "eg-layer eg-frost";
    layer.setAttribute("aria-label", `Reveal protected media: ${description}`);

    const caption = this.document.createElement("div");
    caption.className = "eg-caption";
    const compact = this.isCompact(record, box);
    layer.classList.toggle("eg-compact", compact);

    if (!compact) {
      const copy = this.document.createElement("span");
      copy.className = "eg-description";
      copy.textContent = description;
      caption.append(copy);
    }

    const reveal = this.document.createElement("span");
    reveal.className = "eg-action";
    reveal.textContent = compact ? `Reveal ${mediaLabel(record.candidate.kind)}` : "Reveal";
    caption.append(reveal);
    layer.replaceChildren(caption);
  }

  private isCompact(record: ProtectionRecord, currentBox?: DOMRect): boolean {
    const box = currentBox ?? record.candidate.element.getBoundingClientRect();
    return box.width < 160 || box.height < 90;
  }

  private updateRecord(record: ProtectionRecord, currentBox?: DOMRect): void {
    if (record.removed) return;
    const box = currentBox ?? record.candidate.element.getBoundingClientRect();
    const compact = box.width < 160 || box.height < 90;
    if (record.revealed) {
      const width = Math.min(140, box.width);
      const height = Math.min(44, box.height);
      Object.assign(record.layer.style, {
        left: `${box.right - width}px`,
        top: `${box.bottom - height}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
      return;
    }
    if (!record.revealed && layerCompact(record.layer) !== compact) {
      this.renderProtected(record, box);
    }
    Object.assign(record.layer.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    record.layer.classList.toggle("eg-compact", compact);
  }

  private scheduleRecordUpdate(record: ProtectionRecord): void {
    if (record.removed) return;
    this.dirtyRecords.add(record);
    this.scheduleFrame();
  }

  private scheduleAllUpdates = (): void => {
    for (const record of this.records.values()) this.dirtyRecords.add(record);
    this.scheduleFrame();
  };

  private scheduleFrame(): void {
    if (this.frame !== null) return;
    this.frame = this.requestFrame(() => {
      this.frame = null;
      const records = [...this.dirtyRecords];
      this.dirtyRecords.clear();
      for (const record of records) this.updateRecord(record);
    });
  }

  private startListening(): void {
    if (this.listening) return;
    this.window.addEventListener("scroll", this.scheduleAllUpdates, true);
    this.window.addEventListener("resize", this.scheduleAllUpdates);
    this.listening = true;
  }

  private remove(record: ProtectionRecord): void {
    if (record.removed) return;
    record.removed = true;
    record.stopStrictWatch?.();
    record.stopStrictWatch = null;
    this.dirtyRecords.delete(record);
    record.host.remove();
    record.candidate.element.removeAttribute("data-eclipse-goggles-protected");
    record.candidate.element.removeEventListener("mouseenter", record.onMouseEnter);
    record.candidate.element.removeEventListener("mouseleave", record.onMouseLeave);
    if (this.records.get(record.candidate.element) === record) this.records.delete(record.candidate.element);

    if (this.records.size > 0) return;
    this.window.removeEventListener("scroll", this.scheduleAllUpdates, true);
    this.window.removeEventListener("resize", this.scheduleAllUpdates);
    this.listening = false;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
  }
}

function mediaLabel(kind: MediaKind): "image" | "video" {
  return kind === "native-video" || kind === "video-iframe" ? "video" : "image";
}

function layerCompact(layer: HTMLElement): boolean {
  return layer.classList.contains("eg-compact");
}

function markProtected(candidate: MediaCandidate): void {
  candidate.element.setAttribute(
    "data-eclipse-goggles-protected",
    mediaLabel(candidate.kind),
  );
}
