export const protectionStyles = `
:host {
  all: initial;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

.buof-layer {
  border: 0;
  padding: 0;
  color: inherit;
  background: transparent;
  text-align: initial;
  position: absolute;
  z-index: 2147483647;
  overflow: hidden;
  pointer-events: auto;
  cursor: default;
  font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.buof-frost {
  backdrop-filter: blur(var(--buof-frost-blur, 25px));
  background: rgba(211, 211, 211, 0.10);
}

.buof-reveal-surface {
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

.buof-show-cue {
  position: absolute;
  left: 50%;
  bottom: 12px;
  padding: 5px 9px;
  color: #fff;
  border-radius: 999px;
  background: rgba(31, 33, 35, 0.82);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
  opacity: 0;
  transform: translateX(-50%);
  transition: opacity 120ms ease;
  pointer-events: none;
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.buof-reveal-surface:hover .buof-show-cue,
.buof-reveal-surface:focus-visible .buof-show-cue {
  opacity: 1;
}

.buof-compact .buof-show-cue {
  bottom: 6px;
  padding: 4px 7px;
  font-size: 11px;
}

.buof-info-control {
  position: absolute;
  left: var(--buof-caption-left, 12px);
  bottom: var(--buof-caption-bottom, 12px);
  z-index: 3;
  width: calc(100% - var(--buof-caption-left, 12px) - var(--buof-control-right, 12px));
  min-height: var(--buof-info-size, 28px);
  pointer-events: none;
}

.buof-info-control[hidden] {
  display: none;
}

.buof-info-button {
  appearance: none;
  display: grid;
  width: var(--buof-info-size, 28px);
  height: var(--buof-info-size, 28px);
  padding: 0;
  place-items: center;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.52);
  border-radius: 50%;
  background: rgba(31, 33, 35, 0.78);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
  font: 700 17px/1 Georgia, serif;
  pointer-events: auto;
  backdrop-filter: blur(8px);
  cursor: pointer;
}

.buof-info-button:hover {
  background: rgba(31, 33, 35, 0.92);
}

.buof-info-preview,
.buof-info-panel {
  position: absolute;
  bottom: calc(var(--buof-info-size, 28px) + 6px);
  left: 0;
  display: none;
  width: min(320px, 100%);
  color: #fff;
  background: rgba(31, 33, 35, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
  pointer-events: auto;
}

.buof-info-preview {
  padding: 7px 9px;
  font-size: 12px;
  line-height: 1.35;
}

.buof-info-control:hover:not(.buof-info-pinned) .buof-info-preview,
.buof-info-button:focus-visible + .buof-info-preview {
  display: block;
}

.buof-info-control.buof-info-pinned .buof-info-preview {
  display: none;
}

.buof-info-pinned .buof-info-panel {
  display: grid;
}

.buof-info-description {
  max-height: 120px;
  padding: 9px 10px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.4;
}

.buof-info-always {
  min-height: 36px;
  padding: 8px 10px;
  color: #e4e7e9;
  border: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 0 0 7px 7px;
  text-align: left;
  background: transparent;
  cursor: pointer;
  font: 600 12px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.buof-info-always:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.10);
}

.buof-reprotect {
  appearance: none;
  display: grid;
  width: var(--buof-control-size, 44px);
  height: var(--buof-control-size, 44px);
  padding: 10px;
  place-items: center;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.26);
  background: rgba(31, 33, 35, 0.78);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.17);
  backdrop-filter: blur(8px);
  cursor: pointer;
  font: inherit;
}

.buof-reprotect {
  border-radius: 50%;
}

.buof-reprotect:hover {
  background: rgba(31, 33, 35, 0.90);
}

.buof-reprotect svg {
  display: block;
  overflow: visible;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.buof-reprotect svg {
  width: 28px;
  height: 28px;
}

.buof-compact .buof-reprotect {
  padding: 5px;
}

.buof-compact .buof-reprotect svg {
  width: 22px;
  height: 22px;
}

.buof-compact .buof-info-control {
  --buof-info-size: 24px;
}

.buof-compact .buof-info-button {
  font-size: 15px;
}

.buof-compact .buof-info-preview,
.buof-compact .buof-info-description {
  font-size: 11px;
}

.buof-reveal-surface:focus-visible,
.buof-info-button:focus-visible,
.buof-info-always:focus-visible,
.buof-reprotect:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(31, 33, 35, 0.72);
}

.buof-layer.buof-revealed {
  overflow: visible;
  pointer-events: none;
  cursor: default;
}

.buof-reprotect {
  width: 100%;
  height: 100%;
  opacity: 0.78;
  pointer-events: auto;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.buof-target-hover .buof-reprotect,
.buof-reprotect:focus-visible {
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
