# Big Ugly Orange Face

Big Ugly Orange Face is a Chrome extension that frosts likely matches for subjects you choose. Ordinary images and videos remain visible.

The built-in preset targets Donald Trump using local page evidence such as descriptions, filenames, captions, links, nearby titles, and video posters. Matching is best effort: the extension can miss an image or frost an unrelated one. It does not perform face recognition or upload page content.

## What it does

- Frosts likely subject matches on every website.
- Reveals one frosted item when you click it.
- Lets you frost that item again.
- Applies subject toggles and matching-word edits to open pages.
- Pauses and mutes matched native videos.
- Withholds matched YouTube and Vimeo embeds until you reveal them.
- Stores settings locally.

## Install from source

You need Node.js 22 or newer.

```sh
npm ci
npm run build
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's `dist` folder.

## Use

1. Open the extension's Settings page.
2. Turn on **Donald Trump** under **Subjects to frost**.
3. Edit the matching words if needed.
4. Click a frosted item to reveal it; use **Frost again** to cover it again.

## Development

```sh
npm ci
npm run verify
```

The production extension is built into `dist/`.
