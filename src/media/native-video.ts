interface NativeVideoState {
  originallyMuted: boolean;
  released: boolean;
  onPlay: () => void;
}

export class NativeVideoController {
  private readonly states = new WeakMap<HTMLVideoElement, NativeVideoState>();

  secure(video: HTMLVideoElement): void {
    if (this.states.has(video)) return;

    let state!: NativeVideoState;
    const onPlay = () => {
      if (!state.released) this.enforce(video);
    };
    state = {
      originallyMuted: video.muted,
      released: false,
      onPlay,
    };

    this.states.set(video, state);
    video.addEventListener("play", onPlay);
    this.enforce(video);
  }

  release(video: HTMLVideoElement): void {
    const state = this.states.get(video);
    if (state) state.released = true;
  }

  reprotect(video: HTMLVideoElement): void {
    const state = this.states.get(video);
    if (!state) return;

    state.released = false;
    this.enforce(video);
  }

  restore(video: HTMLVideoElement): void {
    const state = this.states.get(video);
    if (!state) return;

    video.removeEventListener("play", state.onPlay);
    video.muted = state.originallyMuted;
    this.states.delete(video);
  }

  private enforce(video: HTMLVideoElement): void {
    video.pause();
    video.muted = true;
  }
}
