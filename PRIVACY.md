# Big Ugly Orange Face Privacy Policy

**Effective date: August 23, 2026**

Big Ugly Orange Face is a Chrome extension that frosts likely matches for subjects you choose. It works locally in your browser.

## What the extension processes

The extension reads media elements and nearby page information such as descriptions, filenames, captions, links, titles, and video posters. It uses this information only to identify likely subject matches, frost matched media, and show available descriptions. It does not analyze faces, pixels, or video frames.

## Information stored on your device

Chrome local storage saves whether subject frosting is enabled, the matching words you configure, and whether descriptions are shown by default on a website. These settings remain in your Chrome profile until you change them, clear the extension's data, or uninstall it.

## Data collection and sharing

Big Ugly Orange Face does not transmit page content, images, browsing activity, or settings to the developer. It has no analytics, advertising, tracking pixels, or developer-operated server and does not download or execute remote code.

## Embedded videos

The extension can withhold recognized YouTube and Vimeo embeds while it determines whether they match an enabled subject. Unmatched embeds are released automatically. When you reveal a matched embed, your browser contacts the video provider as the page intended. Temporary allow rules expire after 10 seconds and are removed when the item is re-frosted, the page changes, the tab closes, or the extension restarts.

## Permissions

- **storage** saves local preferences.
- **host access** lets the extension inspect media on web pages and gate recognized YouTube and Vimeo embeds.
- **declarativeNetRequestWithHostAccess** withholds recognized embeds until they are classified or revealed.
- **webNavigation** removes temporary video rules when a tab navigates.
