import { describe, expect, it, vi } from "vitest";
import { NativeVideoController } from "../../src/media/native-video";

function nativeVideo(): {
  video: HTMLVideoElement;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
} {
  const video = document.createElement("video");
  const pause = vi.fn();
  const play = vi.fn().mockResolvedValue(undefined);
  video.muted = false;
  video.pause = pause;
  video.play = play;
  return { video, pause, play };
}

describe("NativeVideoController", () => {
  it("secures a video immediately and enforces protection on later play events", () => {
    const controller = new NativeVideoController();
    const { video, pause } = nativeVideo();

    controller.secure(video);
    expect(video.muted).toBe(true);
    expect(pause).toHaveBeenCalledTimes(1);

    controller.secure(video);
    expect(pause).toHaveBeenCalledTimes(1);

    video.muted = false;
    video.dispatchEvent(new Event("play"));
    expect(video.muted).toBe(true);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("stops enforcing while released and resumes enforcement when reprotected", () => {
    const controller = new NativeVideoController();
    const { video, pause } = nativeVideo();
    controller.secure(video);

    controller.release(video);
    expect(video.muted).toBe(true);
    video.dispatchEvent(new Event("play"));
    expect(pause).toHaveBeenCalledTimes(1);

    video.muted = false;
    controller.reprotect(video);
    expect(video.muted).toBe(true);
    expect(pause).toHaveBeenCalledTimes(2);

    video.muted = false;
    video.dispatchEvent(new Event("play"));
    expect(video.muted).toBe(true);
    expect(pause).toHaveBeenCalledTimes(3);
  });

  it("restores the original muted value, removes enforcement, and never starts playback", () => {
    const controller = new NativeVideoController();
    const { video, pause, play } = nativeVideo();
    controller.secure(video);

    controller.restore(video);
    expect(video.muted).toBe(false);
    expect(play).not.toHaveBeenCalled();

    video.dispatchEvent(new Event("play"));
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
