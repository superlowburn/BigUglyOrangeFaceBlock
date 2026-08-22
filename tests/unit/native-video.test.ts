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

function trustedController(): {
  controller: NativeVideoController;
  trust: ReturnType<typeof vi.fn>;
} {
  const trust = vi.fn().mockReturnValue(true);
  return { controller: new NativeVideoController({ trustedActivation: trust }), trust };
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

  it("keeps autoplay blocked after reveal until a separate trusted player action", async () => {
    const { controller } = trustedController();
    const { video, pause, play } = nativeVideo();
    video.getBoundingClientRect = () => ({
      x: 10,
      y: 20,
      top: 20,
      right: 210,
      bottom: 120,
      left: 10,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });
    document.body.append(video);
    controller.secure(video);

    controller.release(video);
    expect(video.muted).toBe(true);
    await video.play();
    expect(play).not.toHaveBeenCalled();
    video.dispatchEvent(new Event("play"));
    expect(pause).toHaveBeenCalledTimes(3);
    video.dispatchEvent(new Event("playing"));
    expect(pause).toHaveBeenCalledTimes(4);

    video.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      composed: true,
      clientX: 100,
      clientY: 80,
    }));
    await video.play();
    expect(play).toHaveBeenCalledTimes(1);
    video.dispatchEvent(new Event("play"));
    video.dispatchEvent(new Event("playing"));
    expect(pause).toHaveBeenCalledTimes(4);

    video.muted = false;
    controller.reprotect(video);
    expect(video.muted).toBe(true);
    expect(pause).toHaveBeenCalledTimes(5);

    controller.release(video);
    video.dispatchEvent(new Event("playing"));
    expect(video.muted).toBe(true);
    expect(pause).toHaveBeenCalledTimes(6);
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
