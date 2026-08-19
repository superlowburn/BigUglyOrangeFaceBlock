export interface MutationObserverLike {
  observe(target: Node, options?: MutationObserverInit): void;
  disconnect(): void;
}

export interface ResizeObserverLike {
  observe(target: Element): void;
  unobserve?(target: Element): void;
  disconnect(): void;
}

export interface DocumentObserverEnvironment {
  document?: Document;
  createMutationObserver?: (callback: MutationCallback) => MutationObserverLike;
  createResizeObserver?: (callback: ResizeObserverCallback) => ResizeObserverLike;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

const relevantAttributes = [
  "src",
  "srcset",
  "poster",
  "style",
  "class",
  "alt",
  "title",
  "aria-label",
] as const;
const openShadowEvent = "eclipse-goggles-open-shadow";

export class DocumentObserver {
  private readonly document: Document;
  private readonly createMutationObserver: (
    callback: MutationCallback,
  ) => MutationObserverLike;
  private readonly createResizeObserver: (
    callback: ResizeObserverCallback,
  ) => ResizeObserverLike;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly pending = new Set<Element>();
  private observedRoots = new WeakSet<Node>();
  private observedForResize = new Set<Element>();
  private activeLayoutTargets = new WeakSet<Element>();
  private attributeChanges = new WeakSet<Element>();
  private mutationObserver: MutationObserverLike | null = null;
  private resizeObserver: ResizeObserverLike | null = null;
  private onCandidates: ((elements: readonly Element[]) => void) | null = null;
  private onLayoutChange: (() => void) | null = null;
  private layoutDirty = false;
  private frame: number | null = null;

  constructor(environment: DocumentObserverEnvironment = {}) {
    this.document = environment.document ?? document;
    this.createMutationObserver =
      environment.createMutationObserver ?? ((callback) => new MutationObserver(callback));
    this.createResizeObserver =
      environment.createResizeObserver ?? ((callback) => new ResizeObserver(callback));
    this.requestFrame =
      environment.requestAnimationFrame ??
      this.document.defaultView!.requestAnimationFrame.bind(this.document.defaultView);
    this.cancelFrame =
      environment.cancelAnimationFrame ??
      this.document.defaultView!.cancelAnimationFrame.bind(this.document.defaultView);
  }

  start(
    onCandidates: (elements: readonly Element[]) => void,
    onLayoutChange?: () => void,
  ): void {
    if (this.onCandidates) this.stop();
    this.onCandidates = onCandidates;
    this.onLayoutChange = onLayoutChange ?? null;
    this.resizeObserver = this.createResizeObserver((entries) => {
      for (const entry of entries) this.enqueue(entry.target);
    });
    this.mutationObserver = this.createMutationObserver((records) => {
      for (const record of records) this.processMutation(record);
    });
    this.document.addEventListener(openShadowEvent, this.onOpenShadow);
    this.observeRoot(this.document);
  }

  private observeRoot(root: Node): void {
    if (this.observedRoots.has(root)) return;
    this.observedRoots.add(root);
    this.mutationObserver?.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: [...relevantAttributes],
    });
  }

  scan(root: ParentNode): void {
    this.scanTree(root, false);
  }

  trackLayout(element: Element): void {
    this.activeLayoutTargets.add(element);
    this.observeResize(element);
  }

  untrackLayout(element: Element): void {
    this.activeLayoutTargets.delete(element);
    this.syncResizeObservation(element);
  }

  hadRelevantAttributeChange(element: Element): boolean {
    return this.attributeChanges.has(element);
  }

  stop(): void {
    this.document.removeEventListener(openShadowEvent, this.onOpenShadow);
    this.mutationObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.mutationObserver = null;
    this.resizeObserver = null;
    this.onCandidates = null;
    this.onLayoutChange = null;
    this.pending.clear();
    this.observedForResize.clear();
    this.observedRoots = new WeakSet<Node>();
    this.activeLayoutTargets = new WeakSet<Element>();
    this.attributeChanges = new WeakSet<Element>();
    this.layoutDirty = false;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
  }

  private readonly onOpenShadow = (event: Event): void => {
    const host = event.target;
    if (!(host instanceof HTMLElement) || isExtensionOwned(host) || !host.shadowRoot) return;
    this.observeRoot(host.shadowRoot);
    this.scanTree(host.shadowRoot, false);
  };

  private processMutation(record: MutationRecord): void {
    if (record.type === "characterData") {
      this.layoutDirty = true;
      if (this.frame === null) this.frame = this.requestFrame(() => this.flush());
      return;
    }
    if (record.type === "attributes") {
      if (record.target instanceof Element && !isExtensionOwned(record.target)) {
        this.layoutDirty = true;
        this.trackTree(record.target, true);
      }
      return;
    }

    let affectsLayout = false;
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) {
        affectsLayout = true;
        continue;
      }
      if (node instanceof Element && !isExtensionOwned(node)) {
        affectsLayout = true;
        this.trackTree(node, false);
      }
    }
    for (const node of record.removedNodes) {
      if (!(node instanceof Element)) {
        affectsLayout = true;
        continue;
      }
      if (node instanceof Element && !isExtensionOwned(node)) {
        affectsLayout = true;
        this.enqueueTree(node);
        this.unobserveTree(node);
      }
    }
    if (affectsLayout) this.layoutDirty = true;
    if (affectsLayout && this.frame === null) {
      this.frame = this.requestFrame(() => this.flush());
    }
  }

  private trackTree(root: Element, attributeChange: boolean): void {
    this.scanTree(root, attributeChange);
  }

  private scanTree(root: ParentNode, attributeChange: boolean): void {
    if (root instanceof HTMLElement) this.track(root, attributeChange);
    const walker = this.document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (node instanceof HTMLElement && !isExtensionOwned(node)) {
        this.track(node, attributeChange);
      }
      node = walker.nextNode();
    }

    const elements = root instanceof Element
      ? [root, ...Array.from(root.querySelectorAll("*"))]
      : Array.from(root.querySelectorAll("*"));
    for (const element of elements) {
      if (!(element instanceof HTMLElement) || isExtensionOwned(element)) continue;
      const shadow = element.shadowRoot;
      if (!shadow) continue;
      this.observeRoot(shadow);
      this.scanTree(shadow, attributeChange);
    }
  }

  private enqueueTree(root: Element): void {
    if (root instanceof HTMLElement) this.enqueue(root);
    const walker = this.document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (node instanceof HTMLElement) this.enqueue(node);
      node = walker.nextNode();
    }
  }

  private unobserveTree(root: Element): void {
    this.unobserveResize(root);
    for (const element of root.querySelectorAll("*")) this.unobserveResize(element);
    if (root.shadowRoot) {
      for (const element of root.shadowRoot.querySelectorAll("*")) this.unobserveResize(element);
    }
  }

  private track(element: Element, attributeChange = false): void {
    this.syncResizeObservation(element);
    if (attributeChange) this.attributeChanges.add(element);
    this.enqueue(element);
  }

  private syncResizeObservation(element: Element): void {
    const shouldObserve = element.isConnected &&
      (this.activeLayoutTargets.has(element) || isPlausibleResizeCandidate(element));
    if (shouldObserve) this.observeResize(element);
    else this.unobserveResize(element);
  }

  private observeResize(element: Element): void {
    if (this.observedForResize.has(element)) return;
    this.observedForResize.add(element);
    this.resizeObserver?.observe(element);
  }

  private unobserveResize(element: Element): void {
    if (!this.observedForResize.delete(element)) return;
    this.resizeObserver?.unobserve?.(element);
  }

  private enqueue(element: Element): void {
    if (!this.onCandidates) return;
    this.pending.add(element);
    if (this.frame !== null) return;
    this.frame = this.requestFrame(() => this.flush());
  }

  private flush(): void {
    this.frame = null;
    const elements = [...this.pending];
    this.pending.clear();
    if (!this.onCandidates) return;

    try {
      if (elements.length > 0) this.onCandidates(elements);
    } finally {
      for (const element of elements) this.attributeChanges.delete(element);
      if (this.layoutDirty) {
        this.layoutDirty = false;
        this.onLayoutChange?.();
      }
    }
  }
}

function isPlausibleResizeCandidate(element: Element): boolean {
  if (
    element instanceof HTMLImageElement ||
    element instanceof HTMLVideoElement ||
    element instanceof HTMLIFrameElement ||
    (element instanceof HTMLInputElement && element.type.toLowerCase() === "image")
  ) {
    return true;
  }
  if (!(element instanceof HTMLElement)) return false;
  const style = element.getAttribute("style") ?? "";
  return /background(?:-image)?\s*:/iu.test(style) ||
    ((element.id !== "" || element.classList.length > 0) && !element.textContent?.trim());
}

function isExtensionOwned(element: Element): boolean {
  return element.hasAttribute("data-eclipse-goggles-root") ||
    element.closest("[data-eclipse-goggles-root]") !== null;
}
