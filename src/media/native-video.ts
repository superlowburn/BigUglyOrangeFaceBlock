interface NativeVideoState {
  hadOwnPlay: boolean;
  originalPlay: HTMLVideoElement["play"];
  originallyMuted: boolean;
  released: boolean;
  playbackAllowed: boolean;
  onPlay: () => void;
  onPointerDown: (event: PointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

interface NativeVideoEnvironment {
  trustedActivation?: (event: Event) => boolean;
}

export class NativeVideoController {
  private readonly states = new WeakMap<HTMLVideoElement, NativeVideoState>();
  private readonly trustedActivation: (event: Event) => boolean;

  constructor(environment: NativeVideoEnvironment = {}) {
    this.trustedActivation = environment.trustedActivation ?? ((event) => event.isTrusted);
  }

  secure(video: HTMLVideoElement): void {
    if (this.states.has(video)) return;

    let state!: NativeVideoState;
    const onPlay = () => {
      if (!state.released || !state.playbackAllowed) this.enforce(video);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!state.released || !this.trustedActivation(event)) return;
      if (event.composedPath().includes(video)) state.playbackAllowed = true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        state.released &&
        event.target === video &&
        (event.key === "Enter" || event.key === " ") &&
        this.trustedActivation(event)
      ) {
        state.playbackAllowed = true;
      }
    };
    state = {
      hadOwnPlay: Object.prototype.hasOwnProperty.call(video, "play"),
      originalPlay: video.play,
      originallyMuted: video.muted,
      released: false,
      playbackAllowed: false,
      onPlay,
      onPointerDown,
      onKeyDown,
    };

    this.states.set(video, state);
    video.play = () => {
      if (!state.released || !state.playbackAllowed) {
        this.enforce(video);
        return Promise.resolve();
      }
      return state.originalPlay.call(video);
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("playing", onPlay);
    video.ownerDocument.addEventListener("pointerdown", onPointerDown, true);
    video.addEventListener("keydown", onKeyDown, true);
    this.enforce(video);
  }

  release(video: HTMLVideoElement): void {
    const state = this.states.get(video);
    if (!state) return;
    state.released = true;
    state.playbackAllowed = false;
  }

  reprotect(video: HTMLVideoElement): void {
    const state = this.states.get(video);
    if (!state) return;

    state.released = false;
    state.playbackAllowed = false;
    this.enforce(video);
  }

  restore(video: HTMLVideoElement): void {
    const state = this.states.get(video);
    if (!state) return;

    video.removeEventListener("play", state.onPlay);
    video.removeEventListener("playing", state.onPlay);
    video.ownerDocument.removeEventListener("pointerdown", state.onPointerDown, true);
    video.removeEventListener("keydown", state.onKeyDown, true);
    if (state.hadOwnPlay) video.play = state.originalPlay;
    else Reflect.deleteProperty(video, "play");
    video.muted = state.originallyMuted;
    this.states.delete(video);
  }

  private enforce(video: HTMLVideoElement): void {
    video.pause();
    video.muted = true;
  }
}
