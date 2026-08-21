import type { MediaCandidate, MediaKind, SiteMode } from "../shared/media-types";
import { StrictRevealGuard } from "./strict-guard";
import { protectionStyles } from "./styles";

export interface ProtectionHandle {
  reveal(): void;
  reprotect(): void;
  remove(): void;
  update(): void;
  setBlockedSubject(blocked: boolean): void;
  setDescriptionVisible(visible: boolean): void;
  isRevealed(): boolean;
}

export interface ProtectionOptions {
  description: string;
  blockedSubject?: boolean;
  mode: SiteMode;
  onReveal: () => void;
  onToggleDescriptions: () => void;
  descriptionsVisible: boolean;
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
  blockedSubject: boolean;
  host: HTMLElement;
  layer: HTMLDivElement;
  onReveal: () => void;
  onToggleDescriptions: () => void;
  onReprotect: () => void;
  descriptionVisible: boolean;
  pageDescriptionsVisible: boolean;
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
    const layer = this.document.createElement("div");
    layer.className = "eg-layer";
    shadow.append(layer);

    let record!: ProtectionRecord;
    const handle: ProtectionHandle = {
      reveal: () => this.reveal(record),
      reprotect: () => this.reprotect(record),
      remove: () => this.remove(record),
      update: () => this.scheduleRecordUpdate(record),
      setBlockedSubject: (blocked) => this.setRecordBlockedSubject(record, blocked),
      setDescriptionVisible: (visible) => this.setRecordDescriptionVisible(record, visible),
      isRevealed: () => record.revealed,
    };

    record = {
      candidate,
      description: options.description,
      blockedSubject: options.blockedSubject ?? false,
      host,
      layer,
      onReveal: options.onReveal,
      onToggleDescriptions: options.onToggleDescriptions,
      onReprotect: options.onReprotect,
      descriptionVisible: options.descriptionsVisible,
      pageDescriptionsVisible: options.descriptionsVisible,
      mode: options.mode,
      revealed: false,
      removed: false,
      stopStrictWatch: null,
      handle,
      onMouseEnter: () => layer.classList.add("eg-target-hover"),
      onMouseLeave: () => layer.classList.remove("eg-target-hover"),
    };

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

  debugLayerFor(element: HTMLElement): HTMLDivElement | null {
    return this.records.get(element)?.layer ?? null;
  }

  private createRoot(target: HTMLElement): { host: HTMLElement; shadow: ShadowRoot } {
    const { host, shadow } = this.createIsolatedHost();
    const anchor = target.closest(
      "a[href], button, input, select, textarea, summary, [role=button], [role=link], [tabindex], [contenteditable]:not([contenteditable=false])",
    ) ?? target.closest("picture") ?? target;
    anchor.parentNode?.insertBefore(host, anchor.nextSibling);
    if (!host.isConnected) this.document.documentElement.append(host);
    showInTopLayer(host);
    return { host, shadow };
  }

  private createIsolatedHost(): { host: HTMLElement; shadow: ShadowRoot } {
    const host = this.document.createElement("div");
    host.setAttribute("data-eclipse-goggles-root", "");
    host.setAttribute("popover", "manual");
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
    return { host, shadow };
  }

  private activate(record: ProtectionRecord, event: Event, action: "reveal" | "reprotect"): boolean {
    if (!this.trustedActivation(event) || record.removed) return false;
    event.preventDefault();
    event.stopPropagation();
    if (action === "reprotect") record.handle.reprotect();
    else record.handle.reveal();
    return true;
  }

  private reveal(record: ProtectionRecord): void {
    if (record.removed || record.revealed) return;
    const keepFocus = (record.layer.getRootNode() as ShadowRoot).activeElement ===
      record.layer.querySelector(".eg-reveal-surface");
    record.revealed = true;
    record.layer.className = "eg-layer eg-revealed";
    const reprotect = this.createIconButton("eg-reprotect", "Frost again", "undo");
    reprotect.addEventListener("click", (event) => this.activate(record, event, "reprotect"));
    record.layer.replaceChildren(reprotect);
    if (keepFocus) reprotect.focus();
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
    const keepFocus = (record.layer.getRootNode() as ShadowRoot).activeElement ===
      record.layer.querySelector(".eg-reprotect");
    record.revealed = false;
    record.stopStrictWatch?.();
    record.stopStrictWatch = null;
    this.renderProtected(record);
    if (keepFocus) record.layer.querySelector<HTMLButtonElement>(".eg-reveal-surface")?.focus();
    this.updateRecord(record);
    markProtected(record.candidate);
    record.onReprotect();
  }

  private renderProtected(record: ProtectionRecord, box?: DOMRect): void {
    const { layer, description } = record;
    layer.className = "eg-layer eg-frost";
    layer.removeAttribute("aria-label");
    const presentation = presentationFor(box ?? record.candidate.element.getBoundingClientRect());
    const compact = presentation.compact;
    layer.classList.toggle("eg-compact", compact);

    const revealSurface = this.createButton(
      "",
      "eg-reveal-surface",
      `${optionsLabel(record)}: ${description}`,
    );
    const showCue = this.document.createElement("span");
    showCue.className = "eg-show-cue";
    showCue.setAttribute("aria-hidden", "true");
    showCue.textContent = "Show";
    revealSurface.append(showCue);
    revealSurface.addEventListener("click", (event) => {
      this.activate(record, event, "reveal");
    });

    const children: HTMLElement[] = [revealSurface];
    const infoControl = this.document.createElement("div");
    infoControl.className = "eg-info-control";
    infoControl.hidden = !presentation.showInfo;
    const info = this.createButton("i", "eg-info-button", "Show description");
    info.setAttribute("aria-expanded", "false");
    info.setAttribute("aria-controls", "eg-info-panel");
    const characters = Array.from(description);
    const preview = characters.length > 50 ? `${characters.slice(0, 50).join("")}…` : description;
    const previewCopy = this.document.createElement("div");
    previewCopy.className = "eg-info-preview";
    previewCopy.textContent = preview;
    const panel = this.document.createElement("div");
    panel.id = "eg-info-panel";
    panel.className = "eg-info-panel";
    const fullCopy = this.document.createElement("div");
    fullCopy.className = "eg-info-description";
    fullCopy.textContent = description;
    const always = this.createButton(
      "Show descriptions by default on this site",
      "eg-info-always",
      "Show descriptions by default on this site",
    );
    info.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      record.descriptionVisible = !record.descriptionVisible;
      this.updateDescriptionState(record);
    });
    always.addEventListener("click", (event) => {
      if (!this.trustedActivation(event)) return;
      event.preventDefault();
      event.stopPropagation();
      record.onToggleDescriptions();
    });
    infoControl.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !record.descriptionVisible) return;
      event.preventDefault();
      record.descriptionVisible = false;
      this.updateDescriptionState(record);
      info.focus();
    });
    panel.append(fullCopy, always);
    infoControl.append(info, previewCopy, panel);
    children.push(infoControl);

    layer.replaceChildren(...children);
    this.updateDescriptionState(record);
  }

  private createButton(text: string, className: string, label: string): HTMLButtonElement {
    const button = this.document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    return button;
  }

  private createIconButton(
    className: string,
    label: string,
    icon: "undo",
  ): HTMLButtonElement {
    const button = this.createButton("", className, label);
    const svg = this.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<path d="M7 7H3V3M3.5 7A8 8 0 1 1 5 16"/>';
    button.append(svg);
    return button;
  }

  private updateDescriptionState(record: ProtectionRecord): void {
    const control = record.layer.querySelector<HTMLElement>(".eg-info-control");
    const info = record.layer.querySelector<HTMLButtonElement>(".eg-info-button");
    const always = record.layer.querySelector<HTMLButtonElement>(".eg-info-always");
    control?.classList.toggle("eg-info-pinned", record.descriptionVisible);
    info?.setAttribute("aria-expanded", String(record.descriptionVisible));
    info?.setAttribute("aria-label", record.descriptionVisible ? "Hide description" : "Show description");
    if (always) {
      always.textContent = record.pageDescriptionsVisible
        ? "Stop showing descriptions by default"
        : "Show descriptions by default on this site";
      always.setAttribute("aria-label", always.textContent);
    }
  }

  private setRecordDescriptionVisible(record: ProtectionRecord, visible: boolean): void {
    record.descriptionVisible = visible;
    record.pageDescriptionsVisible = visible;
    this.updateDescriptionState(record);
  }

  private setRecordBlockedSubject(record: ProtectionRecord, blocked: boolean): void {
    if (record.blockedSubject === blocked) return;
    record.blockedSubject = blocked;
    record.layer.querySelector(".eg-reveal-surface")?.setAttribute(
      "aria-label",
      `${optionsLabel(record)}: ${record.description}`,
    );
  }

  private isCompact(record: ProtectionRecord, currentBox?: DOMRect): boolean {
    const box = currentBox ?? record.candidate.element.getBoundingClientRect();
    return presentationFor(box).compact;
  }

  private updateRecord(record: ProtectionRecord, currentBox?: DOMRect): void {
    if (record.removed) return;
    const box = currentBox ?? record.candidate.element.getBoundingClientRect();
    const presentation = presentationFor(box);
    const { compact, controlSize, inset, blur, showInfo } = presentation;
    record.layer.style.setProperty("--eg-control-size", `${controlSize}px`);
    record.layer.style.setProperty("--eg-control-inset", `${inset}px`);
    record.layer.style.setProperty("--eg-frost-blur", `${blur}px`);
    const infoControl = record.layer.querySelector<HTMLElement>(".eg-info-control");
    if (infoControl) infoControl.hidden = !showInfo;
    if (record.revealed) {
      const width = Math.min(controlSize, box.width);
      const height = Math.min(controlSize, box.height);
      const visibleRight = Math.min(box.right, this.window.innerWidth);
      const topInset = topEdgeOcclusionInset(
        this.document,
        record.candidate.element,
        record.layer,
        box,
        this.window,
      );
      const visibleTop = Math.max(box.top + topInset, 0);
      Object.assign(record.layer.style, {
        left: `${Math.max(box.left, visibleRight - width - inset)}px`,
        top: `${Math.max(box.top, Math.min(box.bottom - height, visibleTop + inset))}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
      return;
    }
    if (!record.revealed && layerCompact(record.layer) !== compact) {
      this.renderProtected(record, box);
    }
    const topInset = topEdgeOcclusionInset(
      this.document,
      record.candidate.element,
      record.layer,
      box,
      this.window,
    );
    const clippedTop = box.top + topInset;
    Object.assign(record.layer.style, {
      left: `${box.left}px`,
      top: `${clippedTop}px`,
      width: `${box.width}px`,
      height: `${Math.max(0, box.height - topInset)}px`,
    });
    record.layer.style.setProperty("--eg-control-right", `${Math.max(inset, box.right - this.window.innerWidth + inset)}px`);
    record.layer.style.setProperty("--eg-control-top", `${Math.max(inset, inset - clippedTop)}px`);
    record.layer.style.setProperty("--eg-caption-left", `${Math.max(inset, inset - box.left)}px`);
    record.layer.style.setProperty("--eg-caption-bottom", `${inset}px`);
    record.layer.classList.toggle("eg-compact", compact);
    const coveredByIframe = isCoveredByIframe(
      this.document,
      record.candidate.element,
      record.layer,
      box,
      this.window,
    );
    record.layer.style.pointerEvents = coveredByIframe ? "none" : "";
    record.layer.style.visibility = coveredByIframe ? "hidden" : "";
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

    this.stopListeningIfIdle();
  }

  private stopListeningIfIdle(): void {
    if (this.records.size > 0) return;
    this.window.removeEventListener("scroll", this.scheduleAllUpdates, true);
    this.window.removeEventListener("resize", this.scheduleAllUpdates);
    this.listening = false;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
  }
}

function topEdgeOcclusionInset(
  document: Document,
  target: HTMLElement,
  layer: HTMLElement,
  box: DOMRect,
  window: Window,
): number {
  if (typeof document.elementFromPoint !== "function") return 0;
  const visibleLeft = Math.max(0, box.left);
  const visibleRight = Math.min(window.innerWidth, box.right);
  const visibleTop = Math.max(0, box.top);
  const visibleBottom = Math.min(window.innerHeight, box.bottom);
  if (visibleLeft >= visibleRight || visibleTop >= visibleBottom) return 0;

  const priorPointerEvents = layer.style.pointerEvents;
  let underlying: Element | null = null;
  try {
    layer.style.pointerEvents = "none";
    underlying = deepElementFromPoint(
      document,
      (visibleLeft + visibleRight) / 2,
      Math.min(visibleBottom - 1, visibleTop + 1),
    );
  } finally {
    layer.style.pointerEvents = priorPointerEvents;
  }

  let current = underlying instanceof HTMLElement ? underlying : underlying?.parentElement ?? null;
  while (current && current !== document.documentElement) {
    if (
      !isGogglesElement(current) &&
      current !== target &&
      !current.contains(target) &&
      !target.contains(current)
    ) {
      const position = window.getComputedStyle(current).position;
      if (position === "fixed" || position === "sticky") {
        const occluder = current.getBoundingClientRect();
        if (
          occluder.left <= visibleLeft + 1 &&
          occluder.right >= visibleRight - 1 &&
          occluder.top <= visibleTop + 1 &&
          occluder.bottom > visibleTop + 1 &&
          occluder.height <= Math.min(120, (visibleBottom - visibleTop) / 2)
        ) {
          return Math.min(box.height, Math.max(0, occluder.bottom - box.top));
        }
      }
    }
    current = composedParent(current);
  }
  return 0;
}

function deepElementFromPoint(document: Document, x: number, y: number): Element | null {
  let current = document.elementFromPoint(x, y);
  while (current?.shadowRoot) {
    const shadow = current.shadowRoot as ShadowRoot & {
      elementFromPoint?(x: number, y: number): Element | null;
    };
    const nested = shadow.elementFromPoint?.(x, y) ?? null;
    if (!nested || nested === current) break;
    current = nested;
  }
  return current;
}

function composedParent(element: HTMLElement): HTMLElement | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null;
}

function isGogglesElement(element: HTMLElement): boolean {
  if (element.closest("[data-eclipse-goggles-root]")) return true;
  const root = element.getRootNode();
  return root instanceof ShadowRoot &&
    root.host instanceof HTMLElement &&
    root.host.hasAttribute("data-eclipse-goggles-root");
}

function mediaLabel(kind: MediaKind): "image" | "video" {
  return kind === "native-video" || kind === "video-iframe" ? "video" : "image";
}

function optionsLabel(record: ProtectionRecord): string {
  return record.blockedSubject ? "Reveal blocked subject" : "Reveal protected media";
}

function layerCompact(layer: HTMLElement): boolean {
  return layer.classList.contains("eg-compact");
}

function presentationFor(box: Pick<DOMRect, "width" | "height">): {
  compact: boolean;
  controlSize: number;
  inset: number;
  blur: number;
  showInfo: boolean;
} {
  const shortEdge = Math.min(box.width, box.height);
  const showInfo = box.width >= 520 && box.height >= 320;
  if (box.width < 280 || box.height < 180) {
    return { compact: true, controlSize: 30, inset: 6, blur: 12, showInfo };
  }
  if (shortEdge < 360) {
    return { compact: false, controlSize: 36, inset: 8, blur: 18, showInfo };
  }
  return { compact: false, controlSize: 44, inset: 12, blur: 25, showInfo };
}

function markProtected(candidate: MediaCandidate): void {
  candidate.element.setAttribute(
    "data-eclipse-goggles-protected",
    mediaLabel(candidate.kind),
  );
}

function showInTopLayer(host: HTMLElement): void {
  if (typeof host.showPopover !== "function") {
    host.removeAttribute("popover");
    return;
  }
  try {
    host.showPopover();
  } catch {
    host.removeAttribute("popover");
  }
}

function isCoveredByIframe(
  document: Document,
  target: HTMLElement,
  layer: HTMLElement,
  box: DOMRect,
  window: Window,
): boolean {
  if (typeof document.elementFromPoint !== "function") return false;
  const visibleLeft = Math.max(0, box.left);
  const visibleRight = Math.min(window.innerWidth, box.right);
  const visibleTop = Math.max(0, box.top);
  const visibleBottom = Math.min(window.innerHeight, box.bottom);
  if (visibleLeft >= visibleRight || visibleTop >= visibleBottom) return false;

  const priorPointerEvents = layer.style.pointerEvents;
  layer.style.pointerEvents = "none";
  const underlying = document.elementFromPoint(
    (visibleLeft + visibleRight) / 2,
    (visibleTop + visibleBottom) / 2,
  );
  layer.style.pointerEvents = priorPointerEvents;
  if (underlying === target || underlying?.tagName !== "IFRAME") return false;
  const iframeBox = underlying.getBoundingClientRect();
  return (
    iframeBox.left <= visibleLeft &&
    iframeBox.right >= visibleRight &&
    iframeBox.top <= visibleTop &&
    iframeBox.bottom >= visibleBottom
  );
}
