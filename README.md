# Goggles

**The Goggles, they do something.**

Goggles protects your eyes and mind by hiding images and videos—think AI gore, jump scares, rage bait, the works. Click the frost to show an image or video.

Frost whole sites, whitelist sites, and block image subjects—like THE ORANGE ONE. /shudder

Less eye bleach for everyone!

## What it does

- Frosts meaningful images and videos on ordinary web pages.
- Reveals one item when you click its frosting.
- Lets you frost or show ordinary media separately for each website.
- Can keep likely images of selected subjects frosted even on sites where ordinary media is shown.
- Shows available image descriptions without revealing the image.
- Pauses and mutes protected native videos.
- Withholds recognized YouTube and Vimeo embeds until you reveal them.
- Stores settings locally and does not upload images, page text, or browsing activity.

Blocked-subject matching uses descriptions, filenames, captions, links, and nearby titles. It is deliberately a best-effort feature: Goggles may miss an image or frost an unrelated one.

## Author's statement

> I made Goggles because I hate exaggerated AI images, AI-manufactured attention-grabbing rage bait, and all the other nonsense I am exposed to the moment I open Reddit or another social network. I also hated seeing Trump's big, orange, dumb face everywhere. I wanted the choice to look instead of having every image forced on me.

## Install from GitHub

Goggles is not yet available in the Chrome Web Store. You can install it manually in Chrome.

### Download a packaged release

When a packaged release is available, download `goggles-<version>.zip` from the [Releases page](https://github.com/superlowburn/Goggles/releases), unzip it, and use the resulting folder in the Chrome steps below.

Do not use GitHub's automatically generated **Source code (zip)** as the extension package. It contains the source but not the built extension.

### Build from the repository

You need [Node.js 22 or newer](https://nodejs.org/).

Using Git:

```sh
git clone https://github.com/superlowburn/Goggles.git
cd Goggles
npm install
npm run build
```

Or choose **Code → Download ZIP** on GitHub, unzip the source, open that folder in Terminal, and run:

```sh
npm install
npm run build
```

### Load Goggles in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository's `dist` folder.
5. Pin Goggles from Chrome's Extensions menu if you want its site control to remain visible.

After pulling a newer version from GitHub, run `npm install` and `npm run build` again, then click **Reload** on the Goggles card in `chrome://extensions`.

## Using Goggles

- Click a frosted image or video to reveal that item.
- Click **Frost again** to cover a revealed item again.
- Click the Goggles toolbar icon to turn ordinary-media frosting on or off for the current website.
- Open **Settings** to configure blocked subjects and review sites where ordinary media is shown.
- Use the small information control on sufficiently large media to read its available description.

Turning frosting off for a website does not override enabled blocked subjects. A likely blocked-subject match stays frosted until you deliberately reveal that item.

## Privacy

Goggles works locally in your Chrome profile. It has no analytics or extension-owned server and does not upload images, page text, or usage events.

The extension stores only its local settings, including per-site media choices, description preferences, and blocked-subject words. Deliberately revealing a YouTube or Vimeo embed allows that selected frame to contact its original provider with autoplay disabled.

## Limitations

- Chrome desktop only for now.
- Subject matching is text-based, not facial recognition, so occasional misses are expected.
- Canvas, WebGL, inline SVG, browser interface elements, and visuals inside closed shadow roots are not protected.
- Small or ambiguous visuals may remain visible to avoid covering navigation, controls, badges, and avatars.
- YouTube and Vimeo are the only specially recognized embedded-video providers.
- Chrome internal pages and other restricted URLs do not allow extension content scripts.
- Goggles is a consent and attention tool, not tamper-resistant parental-control or security software.

## Development

```sh
npm install
npm run build
npm run verify
```

`npm run verify` runs TypeScript checks, unit tests, a production build, and the loaded-extension Playwright suite.

The production extension is built into `dist/`. Load that folder in Chrome while developing.
