import type { MediaCandidate, MediaKind, SiteMode } from "../shared/media-types";
import { StrictRevealGuard } from "./strict-guard";
import { protectionStyles } from "./styles";

export interface ProtectionHandle {
  reveal(): void;
  reprotect(): void;
  remove(): void;
  update(): void;
  setDescriptionVisible(visible: boolean): void;
  isRevealed(): boolean;
}

export interface ProtectionOptions {
  description: string;
  mode: SiteMode;
  onReveal: () => void;
  onRevealAll: () => void;
  onAllowSite: () => void;
  onToggleDescriptions: () => void;
  descriptionsVisible: boolean;
  onReprotect: () => void;
}

export interface SiteAllowedControlOptions {
  onProtectSite: () => void;
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
  onAllowSite: () => void;
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

interface SiteControlRecord {
  host: HTMLElement;
  layer: HTMLDivElement;
  goggles: HTMLButtonElement;
  menu: HTMLElement;
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
  private siteControl: SiteControlRecord | null = null;
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
      setDescriptionVisible: (visible) => this.setRecordDescriptionVisible(record, visible),
      isRevealed: () => record.revealed,
    };

    record = {
      candidate,
      description: options.description,
      host,
      layer,
      onReveal: options.onReveal,
      onRevealAll: options.onRevealAll,
      onAllowSite: options.onAllowSite,
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

  debugSiteLayer(): HTMLDivElement | null {
    return this.siteControl?.layer ?? null;
  }

  showSiteAllowedControl(options: SiteAllowedControlOptions): void {
    if (this.siteControl) return;

    const { host, shadow } = this.createIsolatedHost();
    const layer = this.document.createElement("div");
    layer.className = "eg-layer eg-site-layer";
    const gogglesControl = this.document.createElement("div");
    gogglesControl.className = "eg-goggles-control";
    const goggles = this.createIconButton("eg-goggles", "Goggles site options", "goggles");
    goggles.setAttribute("aria-expanded", "false");
    goggles.setAttribute("aria-controls", "eg-site-menu");
    const menu = this.document.createElement("div");
    menu.id = "eg-site-menu";
    menu.className = "eg-menu";
    menu.hidden = true;
    const protectSite = this.createButton(
      "Frost this site again",
      "eg-site-protect",
      "Frost images on this site again",
    );
    protectSite.addEventListener("click", (event) => {
      if (!this.trustedActivation(event)) return;
      event.preventDefault();
      event.stopPropagation();
      options.onProtectSite();
    });
    menu.append(protectSite, this.createMenuBrand());
    gogglesControl.append(goggles, menu);
    layer.append(gogglesControl);
    shadow.append(layer);
    this.document.documentElement.append(host);

    this.siteControl = { host, layer, goggles, menu };
    goggles.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = menu.hidden === true;
      this.closeAllMenus();
      menu.hidden = !open;
      goggles.setAttribute("aria-expanded", String(open));
      layer.classList.toggle("eg-menu-open", open);
    });
    gogglesControl.addEventListener("mouseleave", () => this.closeSiteMenu());
    layer.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || menu.hidden) return;
      this.closeSiteMenu();
      goggles.focus();
    });
    this.startListening();
  }

  hideSiteAllowedControl(): void {
    if (!this.siteControl) return;
    this.siteControl.host.remove();
    this.siteControl = null;
    this.stopListeningIfIdle();
  }

  private createRoot(target: HTMLElement): { host: HTMLElement; shadow: ShadowRoot } {
    const { host, shadow } = this.createIsolatedHost();
    const anchor = target.closest(
      "a[href], button, input, select, textarea, summary, [role=button], [role=link], [tabindex], [contenteditable]:not([contenteditable=false])",
    ) ?? target.closest("picture") ?? target;
    anchor.parentNode?.insertBefore(host, anchor.nextSibling);
    if (!host.isConnected) this.document.documentElement.append(host);
    return { host, shadow };
  }

  private createIsolatedHost(): { host: HTMLElement; shadow: ShadowRoot } {
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
      copy.id = "eg-description";
      copy.className = "eg-description";
      copy.textContent = description;
      const toggle = this.createIconButton(
        "eg-description-toggle",
        "Hide description",
        "chevron",
      );
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-controls", copy.id);
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        record.descriptionVisible = caption.classList.contains("eg-caption-collapsed");
        this.setCaptionCollapsed(caption, toggle, !record.descriptionVisible);
      });
      toggle.addEventListener("keydown", (event) => {
        if (event.key === "Escape") this.setCaptionCollapsed(caption, toggle, true);
      });
      copy.title = description;
      this.setCaptionCollapsed(caption, toggle, !record.descriptionVisible);
      caption.append(copy, toggle);
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
    const allowSite = this.createButton(
      "Always show on this site",
      "eg-allow-site",
      "Always show visual media on this site",
    );
    const toggleDescriptions = this.createButton(
      record.pageDescriptionsVisible ? "Hide descriptions on page" : "Show descriptions on page",
      "eg-toggle-descriptions",
      record.pageDescriptionsVisible ? "Hide descriptions on this page" : "Show descriptions on this page",
    );
    reveal.addEventListener("click", (event) => this.activate(record, event, "reveal"));
    revealAll.addEventListener("click", (event) => this.activate(record, event, "reveal-all"));
    allowSite.addEventListener("click", (event) => {
      if (!this.trustedActivation(event) || record.removed) return;
      event.preventDefault();
      event.stopPropagation();
      record.onAllowSite();
    });
    toggleDescriptions.addEventListener("click", (event) => {
      if (!this.trustedActivation(event) || record.removed) return;
      event.preventDefault();
      event.stopPropagation();
      record.onToggleDescriptions();
    });
    menu.append(reveal, revealAll, toggleDescriptions, allowSite, this.createMenuBrand());
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

  private createIconButton(
    className: string,
    label: string,
    icon: "goggles" | "undo" | "chevron",
  ): HTMLButtonElement {
    const button = this.createButton("", className, label);
    const svg = this.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = icon === "goggles"
      ? '<circle cx="7" cy="12" r="3.5"/><circle cx="17" cy="12" r="3.5"/><path d="M10.5 12h3M1.5 10.5l2 1M22.5 10.5l-2 1"/>'
      : icon === "undo"
      ? '<path d="M7 7H3V3M3.5 7A8 8 0 1 1 5 16"/>'
      : '<path d="m8 10 4 4 4-4"/>';
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

  private closeSiteMenu(): void {
    if (!this.siteControl) return;
    this.siteControl.menu.hidden = true;
    this.siteControl.goggles.setAttribute("aria-expanded", "false");
    this.siteControl.layer.classList.remove("eg-menu-open");
  }

  private closeAllMenus(): void {
    for (const record of this.records.values()) this.closeMenu(record);
    this.closeSiteMenu();
  }

  private createMenuBrand(): HTMLDivElement {
    const brand = this.document.createElement("div");
    brand.className = "eg-menu-brand";
    const name = this.document.createElement("strong");
    name.textContent = "Goggles";
    const tagline = this.document.createElement("span");
    tagline.textContent = "Choose what you see.";
    brand.append(name, tagline);
    return brand;
  }

  private setCaptionCollapsed(
    caption: HTMLElement,
    toggle: HTMLButtonElement,
    collapsed: boolean,
  ): void {
    caption.classList.toggle("eg-caption-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Show description" : "Hide description");
  }

  private setRecordDescriptionVisible(record: ProtectionRecord, visible: boolean): void {
    record.descriptionVisible = visible;
    record.pageDescriptionsVisible = visible;
    const caption = record.layer.querySelector<HTMLElement>(".eg-caption");
    const toggle = record.layer.querySelector<HTMLButtonElement>(".eg-description-toggle");
    if (caption && toggle) this.setCaptionCollapsed(caption, toggle, !visible);
    const pageToggle = record.layer.querySelector<HTMLButtonElement>(".eg-toggle-descriptions");
    if (!pageToggle) return;
    pageToggle.textContent = visible ? "Hide descriptions on page" : "Show descriptions on page";
    pageToggle.setAttribute(
      "aria-label",
      visible ? "Hide descriptions on this page" : "Show descriptions on this page",
    );
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

    this.stopListeningIfIdle();
  }

  private stopListeningIfIdle(): void {
    if (this.records.size > 0 || this.siteControl) return;
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
