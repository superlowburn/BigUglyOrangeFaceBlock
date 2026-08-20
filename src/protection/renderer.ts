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
  onRevealAll: () => void;
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
  layer: HTMLDivElement;
  onReveal: () => void;
  onRevealAll: () => void;
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

  private closeMenusForPointer = (event: PointerEvent): void => {
    const insideGoggles = event.composedPath().some((node) =>
      node instanceof Element && node.classList.contains("eg-goggles-control"));
    if (!insideGoggles) this.closeAllMenus();
  };

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
      isRevealed: () => record.revealed,
    };

    record = {
      candidate,
      description: options.description,
      host,
      layer,
      onReveal: options.onReveal,
      onRevealAll: options.onRevealAll,
      onReprotect: options.onReprotect,
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
    const anchor = target.closest(
      "a[href], button, input, select, textarea, summary, [role=button], [role=link], [tabindex], [contenteditable]:not([contenteditable=false])",
    ) ?? target.closest("picture") ?? target;
    anchor.parentNode?.insertBefore(host, anchor.nextSibling);
    if (!host.isConnected) this.document.documentElement.append(host);
    return { host, shadow };
  }

  private activate(record: ProtectionRecord, event: Event, action: "reveal" | "reveal-all" | "reprotect"): void {
    if (!this.trustedActivation(event) || record.removed) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "reprotect") record.handle.reprotect();
    else if (action === "reveal-all") record.onRevealAll();
    else record.handle.reveal();
  }

  private reveal(record: ProtectionRecord): void {
    if (record.removed || record.revealed) return;
    record.revealed = true;
    record.layer.className = "eg-layer eg-revealed";
    const reprotect = this.createIconButton("eg-reprotect", "Protect again", "undo");
    reprotect.addEventListener("click", (event) => this.activate(record, event, "reprotect"));
    record.layer.replaceChildren(reprotect);
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
    layer.removeAttribute("aria-label");
    const compact = this.isCompact(record, box);
    layer.classList.toggle("eg-compact", compact);

    const revealSurface = this.createButton(
      "",
      "eg-reveal-surface",
      `Reveal protected media: ${description}`,
    );
    revealSurface.addEventListener("click", (event) => this.activate(record, event, "reveal"));

    const children: HTMLElement[] = [revealSurface];
    if (!compact) {
      const caption = this.document.createElement("div");
      caption.className = "eg-caption";
      const copy = this.document.createElement("span");
      copy.className = "eg-description";
      copy.textContent = description;
      caption.append(copy);
      children.push(caption);
    }

    const gogglesControl = this.document.createElement("div");
    gogglesControl.className = "eg-goggles-control";
    const goggles = this.createIconButton("eg-goggles", "Goggles reveal options", "goggles");
    goggles.setAttribute("aria-expanded", "false");
    goggles.setAttribute("aria-controls", "eg-reveal-menu");
    const menu = this.document.createElement("div");
    menu.id = "eg-reveal-menu";
    menu.className = "eg-menu";
    menu.hidden = true;
    const reveal = this.createButton(
      "Reveal image",
      "eg-menu-reveal",
      `Reveal protected media: ${description}`,
    );
    const revealAll = this.createButton(
      "Reveal all on page",
      "eg-reveal-all",
      "Reveal all protected media on this page",
    );
    reveal.addEventListener("click", (event) => this.activate(record, event, "reveal"));
    revealAll.addEventListener("click", (event) => this.activate(record, event, "reveal-all"));
    menu.append(reveal, revealAll);
    gogglesControl.append(goggles, menu);
    goggles.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = menu.hidden === true;
      this.closeAllMenus();
      menu.hidden = !open;
      goggles.setAttribute("aria-expanded", String(open));
      layer.classList.toggle("eg-menu-open", open);
    });
    gogglesControl.addEventListener("mouseleave", () => this.closeMenu(record));
    layer.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || menu.hidden) return;
      this.closeMenu(record);
      goggles.focus();
    });
    children.push(gogglesControl);
    layer.replaceChildren(...children);
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

  private createIconButton(className: string, label: string, icon: "goggles" | "undo"): HTMLButtonElement {
    const button = this.createButton("", className, label);
    const svg = this.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = icon === "goggles"
      ? '<circle cx="7" cy="12" r="3.5"/><circle cx="17" cy="12" r="3.5"/><path d="M10.5 12h3M1.5 10.5l2 1M22.5 10.5l-2 1"/>'
      : '<path d="M7 7H3V3M3.5 7A8 8 0 1 1 5 16"/>';
    button.append(svg);
    return button;
  }

  private closeMenu(record: ProtectionRecord): void {
    const menu = record.layer.querySelector<HTMLElement>(".eg-menu");
    const goggles = record.layer.querySelector<HTMLElement>(".eg-goggles");
    if (menu) menu.hidden = true;
    goggles?.setAttribute("aria-expanded", "false");
    record.layer.classList.remove("eg-menu-open");
  }

  private closeAllMenus(): void {
    for (const record of this.records.values()) this.closeMenu(record);
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
      const width = Math.min(44, box.width);
      const height = Math.min(44, box.height);
      const visibleRight = Math.min(box.right, this.window.innerWidth);
      const visibleTop = Math.max(box.top, 0);
      Object.assign(record.layer.style, {
        left: `${Math.max(box.left, visibleRight - width - 12)}px`,
        top: `${Math.max(box.top, Math.min(box.bottom - height, visibleTop + 12))}px`,
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
    record.layer.style.setProperty("--eg-control-right", `${Math.max(12, box.right - this.window.innerWidth + 12)}px`);
    record.layer.style.setProperty("--eg-control-top", `${Math.max(12, 12 - box.top)}px`);
    record.layer.style.setProperty("--eg-caption-left", `${Math.max(12, 12 - box.left)}px`);
    record.layer.style.setProperty("--eg-caption-bottom", `${Math.max(12, box.bottom - this.window.innerHeight + 12)}px`);
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
    this.document.addEventListener("pointerdown", this.closeMenusForPointer, true);
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
    this.document.removeEventListener("pointerdown", this.closeMenusForPointer, true);
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
