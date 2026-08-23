# Big Ugly Orange Face working agreements

## Product invariant

- Ordinary images and videos remain visible.
- Only media that matches an enabled subject is frosted.
- A user can reveal and re-frost one matched item at a time.
- Subject setting changes apply to open pages without duplicate layers.

## Visual QA gate

Before returning a user-visible code change:

- Run fresh QA on Reddit, CNN, The New York Times, Fox News, The Washington Post, and The Wall Street Journal.
- Confirm ordinary media remains unobstructed and available matched media receives one aligned frost layer.
- Inspect reveal, re-frost, descriptions, duplicate overlays, videos, dynamic media, linked media, and control placement.
- Capture and inspect screenshots for reachable checks. Name login, paywall, anti-bot, or unavailable-match blockers instead of claiming those sites passed.

## Browser testing safety

- Automated browser QA must be truly headless and must never open, activate, or focus a visible browser window.
- Never focus, type in, or otherwise interact with the user's browser address bar.
- If a required extension check cannot run headlessly, do not run it without explicit permission. Report it as unverified.

## Push packaging

- Before every push, rebuild the extension and recreate `big-ugly-orange-face-<version>.zip` from the contents of `dist`.
- Verify the ZIP with `unzip -t` and include it in the same push.
- The ZIP must contain `manifest.json` at its root.
