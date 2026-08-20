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
  onOpenSettings: () => void;
  onToggleDescriptions: () => void;
  descriptionsVisible: boolean;
  onReprotect: () => void;
}

export interface SiteAllowedControlOptions {
  onProtectSite: () => void;
  onOpenSettings?: () => void;
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
  onOpenSettings: () => void;
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
      onOpenSettings: options.onOpenSettings,
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
    menu.append(protectSite, this.createMenuBrand(options.onOpenSettings ?? (() => undefined)));
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
      if (open) this.placeMenu(layer, goggles, menu);
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

  private activate(record: ProtectionRecord, event: Event, action: "reveal" | "reveal-all" | "reprotect"): boolean {
    if (!this.trustedActivation(event) || record.removed) return false;
    event.preventDefault();
    event.stopPropagation();
    if (action === "reprotect") record.handle.reprotect();
    else if (action === "reveal-all") record.onRevealAll();
    else record.handle.reveal();
    return true;
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
    const presentation = presentationFor(box ?? record.candidate.element.getBoundingClientRect());
    const compact = presentation.compact;
    layer.classList.toggle("eg-compact", compact);

    const revealSurface = this.createButton(
      "",
      "eg-reveal-surface",
      `Reveal protected media: ${description}`,
    );
    revealSurface.addEventListener("click", (event) => {
      const linkedMedia = record.candidate.element.closest<HTMLElement>("a[href], [role=link]");
      if (this.activate(record, event, "reveal")) linkedMedia?.click();
    });

    const children: HTMLElement[] = [revealSurface];
    const infoControl = this.document.createElement("div");
    infoControl.className = "eg-info-control";
    infoControl.hidden = !presentation.showInfo;
    const info = this.createButton("i", "eg-info-button", "Show image description");
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
      "Always show descriptions on this site",
      "eg-info-always",
      "Always show descriptions on this site",
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
    reveal.addEventListener("click", (event) => this.activate(record, event, "reveal"));
    revealAll.addEventListener("click", (event) => this.activate(record, event, "reveal-all"));
    allowSite.addEventListener("click", (event) => {
      if (!this.trustedActivation(event) || record.removed) return;
      event.preventDefault();
      event.stopPropagation();
      record.onAllowSite();
    });
    menu.append(reveal, revealAll, allowSite, this.createMenuBrand(record.onOpenSettings));
    gogglesControl.append(goggles, menu);
    goggles.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = menu.hidden === true;
      this.closeAllMenus();
      menu.hidden = !open;
      goggles.setAttribute("aria-expanded", String(open));
      layer.classList.toggle("eg-menu-open", open);
      if (open) this.placeMenu(layer, goggles, menu);
    });
    gogglesControl.addEventListener("mouseleave", () => this.closeMenu(record));
    layer.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || menu.hidden) return;
      this.closeMenu(record);
      goggles.focus();
    });
    children.push(gogglesControl);
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
    icon: "goggles" | "undo",
  ): HTMLButtonElement {
    const button = this.createButton("", className, label);
    const svg = this.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", icon === "goggles" ? "0 0 28 20" : "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = icon === "goggles"
      ? '<path d="M2 6 5 2h7l1.5 4v8L11 18H5l-3-4V6Zm24 0-3-4h-7l-1.5 4v8l2.5 4h6l3-4V6Z"/><circle cx="8" cy="10" r="4"/><circle cx="20" cy="10" r="4"/><path d="M12 8.5c1.3-1 2.7-1 4 0M2 8 .5 7m25.5 1 1.5-1"/>'
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

  private placeMenu(layer: HTMLElement, trigger: HTMLElement, menu: HTMLElement): void {
    const margin = 8;
    const layerBox = layer.getBoundingClientRect();
    const containingBox = menu.parentElement?.getBoundingClientRect() ?? layerBox;
    const triggerBox = trigger.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    const menuWidth = menuBox.width || 204;
    const menuHeight = menuBox.height;
    const maxLeft = Math.max(margin, this.window.innerWidth - menuWidth - margin);
    const viewportLeft = Math.min(maxLeft, Math.max(margin, triggerBox.right - menuWidth));
    const maxTop = Math.max(margin, this.window.innerHeight - menuHeight - margin);
    const preferredTop = triggerBox.bottom + menuHeight <= this.window.innerHeight - margin
      ? triggerBox.bottom
      : triggerBox.top - menuHeight;
    const viewportTop = Math.min(maxTop, Math.max(margin, preferredTop));
    Object.assign(menu.style, {
      left: `${viewportLeft - containingBox.left}px`,
      top: `${viewportTop - containingBox.top}px`,
      right: "auto",
    });
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

  private createMenuBrand(onOpenSettings: () => void): HTMLButtonElement {
    const brand = this.createButton("", "eg-menu-brand", "Open Goggles settings");
    brand.className = "eg-menu-brand";
    const name = this.document.createElement("strong");
    name.textContent = "Goggles";
    const tagline = this.document.createElement("span");
    tagline.textContent = "No disturbing surprises.";
    brand.append(name, tagline);
    brand.addEventListener("click", (event) => {
      if (!this.trustedActivation(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenSettings();
    });
    return brand;
  }

  private updateDescriptionState(record: ProtectionRecord): void {
    const control = record.layer.querySelector<HTMLElement>(".eg-info-control");
    const info = record.layer.querySelector<HTMLButtonElement>(".eg-info-button");
    const always = record.layer.querySelector<HTMLButtonElement>(".eg-info-always");
    control?.classList.toggle("eg-info-pinned", record.descriptionVisible);
    info?.setAttribute("aria-expanded", String(record.descriptionVisible));
    info?.setAttribute("aria-label", record.descriptionVisible ? "Hide image description" : "Show image description");
    if (always) {
      always.textContent = record.pageDescriptionsVisible
        ? "Stop always showing descriptions"
        : "Always show descriptions on this site";
      always.setAttribute("aria-label", always.textContent);
    }
  }

  private setRecordDescriptionVisible(record: ProtectionRecord, visible: boolean): void {
    record.descriptionVisible = visible;
    record.pageDescriptionsVisible = visible;
    this.updateDescriptionState(record);
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
      const visibleTop = Math.max(box.top, 0);
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
    Object.assign(record.layer.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    record.layer.style.setProperty("--eg-control-right", `${Math.max(inset, box.right - this.window.innerWidth + inset)}px`);
    record.layer.style.setProperty("--eg-control-top", `${Math.max(inset, inset - box.top)}px`);
    record.layer.style.setProperty("--eg-caption-left", `${Math.max(inset, inset - box.left)}px`);
    record.layer.style.setProperty("--eg-caption-bottom", `${Math.max(inset, box.bottom - this.window.innerHeight + inset)}px`);
    record.layer.classList.toggle("eg-compact", compact);
    const menu = record.layer.querySelector<HTMLElement>(".eg-menu:not([hidden])");
    const goggles = record.layer.querySelector<HTMLElement>(".eg-goggles");
    if (menu && goggles) this.placeMenu(record.layer, goggles, menu);
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
