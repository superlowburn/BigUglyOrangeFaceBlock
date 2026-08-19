const eventName = "eclipse-goggles-open-shadow";
const originalAttachShadow = Element.prototype.attachShadow;

function attachShadow(
  this: Element,
  init: ShadowRootInit,
): ShadowRoot {
  const root = originalAttachShadow.call(this, init);
  if (init.mode === "open") {
    this.dispatchEvent(new CustomEvent(eventName, { bubbles: true }));
  }
  return root;
}

Object.defineProperties(attachShadow, {
  name: { value: originalAttachShadow.name },
  length: { value: originalAttachShadow.length },
});
Element.prototype.attachShadow = attachShadow;
