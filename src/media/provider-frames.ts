const supportedProviders = [
  { host: "www.youtube.com", path: /^\/embed\/[^/]+$/ },
  { host: "www.youtube-nocookie.com", path: /^\/embed\/[^/]+$/ },
  { host: "player.vimeo.com", path: /^\/video\/[^/]+$/ },
] as const;

export function isSupportedVideoFrame(element: Element): element is HTMLIFrameElement {
  if (!(element instanceof HTMLIFrameElement)) return false;

  const source = element.getAttribute("src");
  if (!source) return false;

  try {
    const url = new URL(source, document.baseURI);
    return (
      url.protocol === "https:" &&
      supportedProviders.some(
        ({ host, path }) => url.hostname === host && path.test(url.pathname),
      )
    );
  } catch {
    return false;
  }
}
