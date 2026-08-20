# Goggles

Goggles is a Chrome extension for intentional viewing. It frosts meaningful images, native videos, and recognized YouTube and Vimeo embeds until you choose one item to reveal. It does not try to decide whether an image was made by AI.

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
5. Select `/Users/REDACTED/Projects/Fader`.

The root manifest loads the production files from `dist`, so run `npm run build` again after changing the extension. Selecting `dist` directly also remains supported.

## Using Goggles

The popup stores one mode for each site origin:

- **Trusted — Show normally.** All Goggles layers are removed immediately and new media is left alone.
- **Protected — Frost individually.** This is the default. Reveal one item or all currently protected media; newly loaded media remains frosted.
- **Strict — Always re-protect.** Reveal one or all, but each item is frosted again after it has been completely outside the viewport for two continuous seconds.

A protected item uses a 25px neutral blur with a 10% light-gray layer. Click the frost to reveal that item, or open the small goggles menu for **Reveal image**, **Reveal all on page**, **Hide descriptions on page**, and **Always show on this site**. The bottom description drawer shows at most two lines, slides closed without revealing the media, and remains available as a 44px toggle. The page description choice also applies to media loaded later, while any individual description can still be reopened. Trusted sites keep a small Goggles control with **Frost this site again**, while the top-right undo control re-frosts an individually revealed item. Every action works with a mouse or keyboard. A revealed image stays revealed according to the current mode without changing its source or dimensions.

Native video is paused and muted when protected. Reveal removes the input-blocking layer but never plays or unmutes the video; playback, sound, and fullscreen remain separate actions in the site's player. Recognized YouTube and Vimeo embed navigations are redirected to an inert packaged document before any provider request. Revealing one frame installs a temporary, tab-scoped browser allow rule, sets only that iframe to its unique selected URL, forces `autoplay=0`, and leaves matching sibling embeds withheld.

## Privacy and security

Classification, descriptions, policy, and reveal state stay on the device. Goggles has no analytics or server and sends no page text, image, or usage event to an extension-owned service. Site mode is the only persisted product state. Reveal state lasts only for the current document. Page descriptions are inserted as text, never as HTML, and page-generated synthetic clicks cannot reveal media. A deliberately revealed YouTube or Vimeo frame navigates to that provider, as the original page intended, with autoplay disabled.

The manifest requests `declarativeNetRequestWithHostAccess` plus host access only for `www.youtube.com`, `www.youtube-nocookie.com`, and `player.vimeo.com`. Those permissions are used solely to redirect recognized embed paths before network and install a temporary browser allow rule for one selected embed. The `webNavigation` permission is used to remove temporary allow rules before top-level navigation; Goggles ignores the event URL and does not keep browsing history. The extension does not inspect request bodies. The inert redirect document is web-accessible because Chrome requires that for a subframe redirect, but it contains no script or data.

Goggles is a best-effort attention and consent tool, not a security boundary against a page script deliberately tampering with extension-managed DOM. The selected provider iframe's unique URL is visible in its `src` attribute while the temporary allow rule exists; a hostile script that intentionally copies that URL is outside this first release's threat model. Allow rules expire after 10 seconds and are also removed on re-protection, page teardown, tab close, top-level navigation, and extension-worker startup.

The automated browser suite fulfills its fake YouTube and Vimeo destinations locally so acceptance tests never contact those providers. Ordinary image requests are not blocked in this first release; the extension controls presentation after Chrome loads page media.

## First-release limitations

- Chrome desktop only; Firefox, Safari, and mobile are not supported yet.
- YouTube and Vimeo are the only recognized embedded-video providers. Other iframes are deliberately left unchanged.
- Canvas, WebGL, inline SVG, browser chrome, and visuals inside closed shadow roots are not protected. Media inside discovered open shadow roots, including roots attached after their host connects, is protected.
- Small or ambiguous visuals are left visible to preserve navigation, controls, badges, and avatars.
- CSS backgrounds are protected only on content-sized elements without visible text or interactive descendants.
- Sites can use unusual top-layer or browser-native UI that an extension overlay cannot cover. Automated tests verify overlay alignment at resize, 125% page scale, and device scale factor 2, but manual release checks should still exercise native fullscreen controls on the target Chrome version.
- Chrome internal pages and other restricted schemes do not permit this content script.
- Mode preferences are local to the Chrome profile; managed household installation is future work.

## Why a normal router cannot do this

A normal household router cannot add a per-image frost-and-reveal interface to HTTPS pages because encryption prevents it from reading and rewriting page structure. A decrypting proxy would require installing a trusted certificate on every device, would expose household browsing traffic, and would break some apps and certificate-pinned services. DNS filtering can block known media hosts, but it cannot preserve a page and place an accessible consent control over each image or video.
