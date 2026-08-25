<p align="center">
  <img src="public/icons/icon.svg" width="128" height="128" alt="Big Ugly Orange Face logo">
</p>

# Big Ugly Orange Face

> Frosts over pictures of the Orange One so you don't see that Big Ugly Orange Face everywhere.

Big Ugly Orange Face is a Chrome extension that frosts likely pictures of Donald Trump while leaving ordinary images and videos visible. It works locally using descriptions, filenames, captions, links, nearby titles, and video posters. It does not perform face recognition or upload page content.

Repository: [github.com/superlowburn/BigUglyOrangeFaceBlock](https://github.com/superlowburn/BigUglyOrangeFaceBlock)

## What it does

- Frosts likely subject matches on every website.
- Reveals one frosted item when you click it.
- Lets you frost that item again.
- Applies subject toggles and matching-word edits to open pages.
- Pauses and mutes matched native videos.
- Withholds matched YouTube and Vimeo embeds until you reveal them.
- Stores settings locally.

## Install the ZIP

Chrome cannot load the ZIP directly. Download and extract it first.

1. Download [big-ugly-orange-face-0.1.0.zip](big-ugly-orange-face-0.1.0.zip).
2. Double-click the ZIP to extract it.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `big-ugly-orange-face-0.1.0` folder. It should contain `manifest.json` at its top level.

## Install from source

You need Node.js 22 or newer.

```sh
npm ci
npm run build
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's `dist` folder.

## Use

1. Open the extension's Settings page.
2. Turn on **Donald Trump** under **Subjects to frost**. It is off until you enable it.
3. Edit the matching words if needed.
4. Click a frosted item to reveal it; use **Frost again** to cover it again.

## Development

```sh
npm ci
npm run verify
```

The production extension is built into `dist/`.
