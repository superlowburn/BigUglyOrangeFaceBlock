# Goggles working agreements

## Visual QA gate

Before returning any user-visible code change:

- Run fresh visual QA on Reddit, CNN, The New York Times, Fox News, The Washington Post, and The Wall Street Journal.
- Inspect protected images and videos, reveal behavior, description and goggles menus, duplicate overlays, and control placement.
- Double-check every frost/unfrost transition: individual reveal, reveal-all, site allow and re-frost, Strict mode, Blocked Subjects on allowed sites, reload/navigation, dynamic media, and image/video/link isolation.
- Capture and inspect screenshots from every site.
- If login, a paywall, or anti-bot protection blocks a site, name the blocker and do not claim that site passed.

## Browser testing safety — hard rule

- Automated browser QA must be truly headless and must never open, activate, or focus a visible browser window.
- Never focus, type in, or otherwise interact with the user's browser address bar.
- Offscreen coordinates and small headed windows are not acceptable substitutes for headless execution because macOS may still surface or focus them.
- If a required extension test cannot run headlessly, do not run it without the user's explicit permission. Report the unverified check instead.
