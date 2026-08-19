export interface MutationObserverLike {
  observe(target: Node, options?: MutationObserverInit): void;
  disconnect(): void;
}

export interface ResizeObserverLike {
  observe(target: Element): void;
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
  private observedForResize = new WeakSet<Element>();
  private attributeChanges = new WeakSet<Element>();
  private mutationObserver: MutationObserverLike | null = null;
  private resizeObserver: ResizeObserverLike | null = null;
  private onCandidates: ((elements: readonly Element[]) => void) | null = null;
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

  start(onCandidates: (elements: readonly Element[]) => void): void {
    if (this.onCandidates) this.stop();
    this.onCandidates = onCandidates;
    this.resizeObserver = this.createResizeObserver((entries) => {
      for (const entry of entries) this.enqueue(entry.target);
    });
    this.mutationObserver = this.createMutationObserver((records) => {
      for (const record of records) this.processMutation(record);
    });
    this.mutationObserver.observe(this.document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...relevantAttributes],
    });
  }

  scan(root: ParentNode): void {
    if (root instanceof HTMLElement) this.track(root);

    const walker = this.document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (node instanceof HTMLElement) this.track(node);
      node = walker.nextNode();
    }
  }

  hadRelevantAttributeChange(element: Element): boolean {
    return this.attributeChanges.has(element);
  }

  stop(): void {
    this.mutationObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.mutationObserver = null;
    this.resizeObserver = null;
    this.onCandidates = null;
    this.pending.clear();
    this.observedForResize = new WeakSet<Element>();
    this.attributeChanges = new WeakSet<Element>();
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
  }

  private processMutation(record: MutationRecord): void {
    if (record.type === "attributes") {
      if (record.target instanceof Element) this.trackTree(record.target, true);
      return;
    }

    for (const node of record.addedNodes) {
      if (node instanceof Element) this.trackTree(node, false);
    }
    for (const node of record.removedNodes) {
      if (node instanceof Element) this.enqueueTree(node);
    }
  }

  private trackTree(root: Element, attributeChange: boolean): void {
    if (root instanceof HTMLElement) this.track(root, attributeChange);
    const walker = this.document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (node instanceof HTMLElement) this.track(node, attributeChange);
      node = walker.nextNode();
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

  private track(element: Element, attributeChange = false): void {
    if (!this.observedForResize.has(element)) {
      this.observedForResize.add(element);
      this.resizeObserver?.observe(element);
    }
    if (attributeChange) this.attributeChanges.add(element);
    this.enqueue(element);
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
    if (elements.length === 0 || !this.onCandidates) return;

    try {
      this.onCandidates(elements);
    } finally {
      for (const element of elements) this.attributeChanges.delete(element);
    }
  }
}
