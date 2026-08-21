import { describe, expect, it } from "vitest";
import {
  candidateMatchesBlockedSubject,
  defaultTrumpKeywords,
  matchesBlockedSubject,
  parseBlockedSubjects,
} from "../../src/shared/blocked-subjects";

describe("blocked subjects", () => {
  it.each([
    "Donald Trump speaks at a podium",
    "President Trump addresses reporters",
    "A post from @realDonaldTrump",
    "The Donald returns to Washington",
  ])("matches Trump wording in image metadata: %s", (alt) => {
    const image = document.createElement("img");
    image.alt = alt;

    expect(matchesBlockedSubject(image, defaultTrumpKeywords)).toBe(true);
  });

  it("matches the nearest post title when the image has no description", () => {
    const article = document.createElement("shreddit-post");
    article.innerHTML = "<h2>Donald J. Trump holds a campaign event</h2><img>";

    expect(matchesBlockedSubject(article.querySelector("img")!, defaultTrumpKeywords)).toBe(true);
  });

  it("matches supported video candidates from local poster and title evidence", () => {
    const nativeVideo = document.createElement("video");
    nativeVideo.poster = "donald-trump-campaign.jpg";
    const providerFrame = document.createElement("iframe");
    providerFrame.title = "Donald Trump campaign video";
    const config = { enabled: true, keywords: ["Trump"] };

    expect(candidateMatchesBlockedSubject(
      { element: nativeVideo, kind: "native-video" },
      config,
    )).toBe(true);
    expect(candidateMatchesBlockedSubject(
      { element: providerFrame, kind: "video-iframe" },
      config,
    )).toBe(true);
  });

  it("does not use unrelated page text or broad political language", () => {
    document.body.innerHTML = `
      <h1>Latest Donald Trump coverage</h1>
      <article><h2>The president meets foreign leaders</h2><img alt="A diplomatic meeting"></article>`;

    expect(matchesBlockedSubject(document.querySelector("img")!, defaultTrumpKeywords)).toBe(false);
  });

  it("accepts a normalized editable keyword list and rejects malformed storage", () => {
    expect(parseBlockedSubjects({ enabled: true, keywords: ["  Trump  ", "", "Trump", "DJT"] }))
      .toEqual({ enabled: true, keywords: ["Trump", "DJT"] });
    expect(parseBlockedSubjects({ enabled: "yes", keywords: ["Trump"] }).enabled).toBe(false);
  });
});
