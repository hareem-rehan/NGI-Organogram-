import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// With `globals: false` in vitest.config.mts, React Testing Library's
// automatic per-test DOM cleanup doesn't self-register — without this,
// each test's rendered output accumulates in the document body and
// later tests in the same file see duplicate elements from earlier ones.
afterEach(() => {
  cleanup();
});

// jsdom implements neither ResizeObserver nor the pointer-capture methods
// Radix UI's floating-positioned primitives (Popover, used by the
// Combobox component — components/ui/combobox.tsx) call internally. Without
// these, a real user-event click into a Combobox hangs/times out rather
// than throwing a clear error, since the missing APIs are called
// optionally/defensively inside Radix rather than causing an immediate
// crash. Dialog/Sheet (no floating positioning) don't need this.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
for (const method of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
  if (!(method in Element.prototype)) {
    Object.defineProperty(Element.prototype, method, { value: () => false, configurable: true });
  }
}
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
// jsdom has never implemented the PointerEvent constructor — Radix's
// dismissable-layer (used by Popover) listens for real "pointerdown"
// events to detect outside clicks/dismissal, and without this the
// listener setup can leave the component waiting on an event that never
// fires in a way userEvent recognizes, hanging the test rather than
// failing it cleanly.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId = 1;
    pointerType = "mouse";
    isPrimary = true;
    constructor(type: string, params: MouseEventInit = {}) {
      super(type, params);
    }
  }
  // @ts-expect-error jsdom's MouseEvent typing doesn't include the pointer-specific fields this polyfill adds
  globalThis.PointerEvent = PointerEventPolyfill;
}
