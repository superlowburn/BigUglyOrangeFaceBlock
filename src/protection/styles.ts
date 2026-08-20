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
  border: 0;
  padding: 0;
  color: inherit;
  background: transparent;
  text-align: initial;
  position: fixed;
  z-index: 2147483647;
  overflow: hidden;
  pointer-events: auto;
  cursor: default;
  font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.eg-frost {
  backdrop-filter: blur(25px);
  background: rgba(211, 211, 211, 0.10);
}

.eg-reveal-surface {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.eg-caption {
  position: absolute;
  left: var(--eg-caption-left, 12px);
  bottom: var(--eg-caption-bottom, 12px);
  z-index: 2;
  max-width: calc(100% - 80px);
  display: flex;
  align-items: stretch;
  overflow: hidden;
  color: #fff;
  background: rgba(31, 33, 35, 0.76);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 7px;
  font-size: 13px;
  pointer-events: auto;
  backdrop-filter: blur(8px);
}

.eg-description {
  display: -webkit-box;
  min-width: 0;
  max-width: 420px;
  padding: 7px 9px;
  overflow: hidden;
  opacity: 1;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  transition: max-width 160ms ease, padding 160ms ease, opacity 120ms ease, transform 160ms ease;
}

.eg-description-toggle {
  appearance: none;
  display: grid;
  flex: 0 0 44px;
  width: 44px;
  min-height: 44px;
  padding: 10px;
  place-items: center;
  color: #fff;
  border: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.16);
  background: transparent;
  cursor: pointer;
}

.eg-description-toggle:hover {
  background: rgba(255, 255, 255, 0.11);
}

.eg-description-toggle svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 160ms ease;
}

.eg-caption-collapsed .eg-description {
  max-width: 0;
  padding-right: 0;
  padding-left: 0;
  opacity: 0;
  transform: translateY(8px);
}

.eg-caption-collapsed .eg-description-toggle {
  border-left-color: transparent;
}

.eg-caption-collapsed .eg-description-toggle svg {
  transform: rotate(180deg);
}

.eg-goggles-control {
  position: absolute;
  top: var(--eg-control-top, 12px);
  right: var(--eg-control-right, 12px);
  z-index: 3;
}

.eg-goggles,
.eg-reprotect {
  appearance: none;
  display: grid;
  width: 44px;
  height: 44px;
  padding: 10px;
  place-items: center;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 50%;
  background: rgba(31, 33, 35, 0.78);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.17);
  backdrop-filter: blur(8px);
  cursor: pointer;
  font: inherit;
}

.eg-goggles:hover,
.eg-reprotect:hover {
  background: rgba(31, 33, 35, 0.90);
}

.eg-goggles svg,
.eg-reprotect svg {
  width: 24px;
  height: 24px;
  overflow: visible;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.eg-goggles svg {
  transform: scale(1.12);
}

.eg-menu {
  position: absolute;
  top: 42px;
  right: 0;
  z-index: 4;
  display: grid;
  width: 204px;
  padding: 4px;
  color: #fff;
  background: rgba(31, 33, 35, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px 0 10px 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
}

.eg-menu[hidden] {
  display: none;
}

.eg-menu button {
  min-height: 44px;
  padding: 9px 10px;
  color: #fff;
  border: 0;
  border-radius: 7px;
  text-align: left;
  background: transparent;
  cursor: pointer;
  font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.eg-menu button + button {
  color: #d8dadd;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0 0 7px 7px;
  font-weight: 500;
}

.eg-menu-brand {
  display: grid;
  gap: 1px;
  padding: 9px 10px 8px;
  color: #f5f6f7;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 12px;
  line-height: 1.25;
}

.eg-menu-brand strong {
  font-size: 13px;
  font-weight: 650;
}

.eg-menu-brand span {
  color: #bdc1c5;
}

.eg-menu button:hover {
  background: rgba(255, 255, 255, 0.11);
}

.eg-reveal-surface:focus-visible,
.eg-goggles:focus-visible,
.eg-description-toggle:focus-visible,
.eg-menu button:focus-visible,
.eg-reprotect:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(31, 33, 35, 0.72);
}

.eg-site-layer {
  top: 12px;
  right: 12px;
  left: auto;
  width: 44px;
  height: 44px;
  overflow: visible;
  pointer-events: none;
}

.eg-site-layer .eg-goggles-control {
  top: 0;
  right: 0;
  pointer-events: auto;
}

.eg-layer.eg-menu-open {
  overflow: visible;
}

.eg-layer.eg-revealed {
  overflow: visible;
  pointer-events: none;
  cursor: default;
}

.eg-reprotect {
  width: 100%;
  height: 100%;
  opacity: 0.78;
  pointer-events: auto;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.eg-target-hover .eg-reprotect,
.eg-reprotect:focus-visible {
  opacity: 1;
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
