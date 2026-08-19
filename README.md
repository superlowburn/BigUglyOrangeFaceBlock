# Eclipse Goggles

Eclipse Goggles is a Chrome extension for intentional viewing. It frosts meaningful images, native videos, and recognized YouTube and Vimeo embeds until you choose one item to reveal. It does not try to decide whether an image was made by AI.

**Tagline:** They actually do something.

## Build and verify

Requirements: Node.js 22 or newer and Chrome/Chromium.

```sh
npm install
npm run build
npm run verify
```

`npm run verify` runs TypeScript checks, unit tests, a production build, and the loaded-extension Playwright suite in a real headed Chromium profile. Playwright uses one worker and a fixture-only server bound to `127.0.0.1:4173`.

## Load the extension locally

1. Run `npm install` and `npm run build` in the project checkout.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**.
5. Select `/Users/REDACTED/Projects/Fader/dist`.

If developing from a worktree, build there for testing; the path above is the intended main-checkout install path after integration.

## Using Eclipse Goggles

The popup stores one mode for each site origin:

- **Trusted — Show normally.** All Eclipse Goggles layers are removed immediately and new media is left alone.
- **Protected — Frost individually.** This is the default. Reveal affects one item and lasts until the document is reloaded or replaced.
- **Strict — Always re-protect.** Reveal still works one item at a time, but an item is frosted again after it has been completely outside the viewport for two continuous seconds.

A protected item uses a 25px neutral blur with a 10% light-gray layer. Its bottom dock shows the page's plain-text description and a **Reveal** button. Click the surface or focus it and press Enter or Space. A revealed image stays revealed according to the current mode without changing its source or dimensions.

Native video is paused and muted when protected. Reveal removes the input-blocking layer but never plays or unmutes the video; playback, sound, and fullscreen remain separate actions in the site's player. Recognized YouTube and Vimeo iframe sources are temporarily withheld and restored exactly on reveal.

## Privacy and security

Classification, descriptions, policy, and reveal state stay on the device. Eclipse Goggles has no analytics or server and sends no page text, URL, image, or usage event anywhere. Site mode is the only persisted product state. Reveal state lasts only for the current document. Page descriptions are inserted as text, never as HTML, and page-generated synthetic clicks cannot reveal media.

The automated browser suite fulfills its fake YouTube and Vimeo destinations locally so acceptance tests never contact those providers. Ordinary image requests are not blocked in this first release; the extension controls presentation after Chrome loads page media.

## First-release limitations

- Chrome desktop only; Firefox, Safari, and mobile are not supported yet.
- YouTube and Vimeo are the only recognized embedded-video providers. Other iframes are deliberately left unchanged.
- Canvas, WebGL, inline SVG, browser chrome, and visuals inside closed shadow roots are not protected.
- Small or ambiguous visuals are left visible to preserve navigation, controls, badges, and avatars.
- CSS backgrounds are protected only on content-sized elements without visible text or interactive descendants.
- Sites can use unusual top-layer or browser-native UI that an extension overlay cannot cover. Automated tests verify overlay alignment at resize, 125% page scale, and device scale factor 2, but manual release checks should still exercise native fullscreen controls on the target Chrome version.
- Chrome internal pages and other restricted schemes do not permit this content script.
- Mode preferences are local to the Chrome profile; managed household installation is future work.

## Why a normal router cannot do this

A normal household router cannot add a per-image frost-and-reveal interface to HTTPS pages because encryption prevents it from reading and rewriting page structure. A decrypting proxy would require installing a trusted certificate on every device, would expose household browsing traffic, and would break some apps and certificate-pinned services. DNS filtering can block known media hosts, but it cannot preserve a page and place an accessible consent control over each image or video.
