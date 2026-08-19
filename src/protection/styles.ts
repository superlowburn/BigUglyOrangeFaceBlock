export const protectionStyles = `
:host {
  all: initial;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.eg-layer {
  appearance: none;
  border: 0;
  padding: 0;
  color: inherit;
  background: transparent;
  text-align: initial;
  position: fixed;
  z-index: 2147483647;
  overflow: hidden;
  pointer-events: auto;
  cursor: pointer;
  font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.eg-frost {
  backdrop-filter: blur(25px);
  background: rgba(211, 211, 211, 0.10);
}
.eg-caption {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 13px 15px;
  color: #26292c;
  background: rgba(250, 250, 250, 0.94);
  border-radius: 9px;
}

.eg-description {
  min-width: 0;
  overflow-wrap: anywhere;
}

.eg-action {
  flex: none;
  border: 1px solid rgba(38, 41, 44, 0.32);
  border-radius: 7px;
  padding: 7px 10px;
  color: #26292c;
  background: #fff;
  cursor: pointer;
  font: inherit;
}

.eg-layer:focus-visible {
  outline: 3px solid #1664d7;
  outline-offset: 2px;
}

.eg-compact .eg-caption {
  inset: 0;
  justify-content: center;
  padding: 6px;
  background: rgba(250, 250, 250, 0.94);
}

.eg-layer.eg-revealed {
  overflow: visible;
  pointer-events: none;
  cursor: default;
}

.eg-reprotect {
  border: 1px solid rgba(38, 41, 44, 0.32);
  border-radius: 7px;
  padding: 7px 10px;
  color: #26292c;
  background: #fff;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.eg-target-hover.eg-reprotect,
.eg-reprotect:focus,
.eg-reprotect:focus-visible {
  opacity: 1;
  pointer-events: auto;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition: none !important;
    animation: none !important;
  }
}
`;
