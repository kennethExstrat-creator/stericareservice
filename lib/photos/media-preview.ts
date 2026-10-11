// What Auto-Sort shows the AI of a photo or video (Source Documents' Media):
// a small JPEG made in the browser from the file on this device, so the AI
// sees each one without loading it back from storage. A video gives a frame
// at about one second. Browser only.
import { browserCodec, drawableImage } from "./browser-codec";
import type { DecodedImage, Surface } from "./process";
import { downscaleSteps, fitWithin, planDraw, type Size } from "./sizing";

/** The preview's long edge: enough for the AI to tell a carton from a glove, small enough to send twelve at once. */
export const PREVIEW_MAX_EDGE = 1024;
/** A little below the photos' 0.8: twelve previews go in one request, and a request may be 5 MB. */
const PREVIEW_QUALITY = 0.7;

/** A video that has not shown a frame by then is left out. */
const VIDEO_TIMEOUT_MS = 15_000;

/**
 * A JPEG of the photo, or of a frame of the video, at most 1024 px on its
 * long edge: base64, without the "data:" prefix. Null when this browser
 * cannot draw it (a HEIC in Chrome, a video type it cannot play).
 */
export async function mediaPreview(source: Blob, kind: "photo" | "video"): Promise<string | null> {
  try {
    const jpeg = kind === "photo" ? await photoPreview(source) : await videoPreview(source);
    return jpeg ? await base64(jpeg) : null;
  } catch {
    return null;
  }
}

async function photoPreview(source: Blob): Promise<Blob | null> {
  const codec = browserCodec();
  const image = await codec.decode(source);
  if (!image) return null;
  try {
    return await shrink(image);
  } finally {
    image.close();
  }
}

/** Draws through halving steps, as photo processing does, then encodes. */
async function shrink(image: DecodedImage): Promise<Blob> {
  const codec = browserCodec();
  const surfaces: Surface[] = [];
  try {
    const from: Size = { width: image.width, height: image.height };
    let current: DecodedImage | Surface = image;
    for (const step of downscaleSteps(from, fitWithin(from, PREVIEW_MAX_EDGE))) {
      current = codec.draw(current, planDraw(step, null));
      surfaces.push(current);
    }
    return await codec.encodeJpeg(current as Surface, PREVIEW_QUALITY);
  } finally {
    for (const surface of surfaces) surface.release();
  }
}

async function videoPreview(source: Blob): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await frameReady(video);
    // About one second in, past a fade from black; the middle of a shorter clip.
    const at = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(1, video.duration / 2) : 0;
    if (at > 0) {
      const seeked = once(video, "seeked");
      video.currentTime = at;
      await seeked;
    }
    if (!video.videoWidth || !video.videoHeight) return null;
    return await shrink(drawableImage(video, video.videoWidth, video.videoHeight));
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Waits for the video's first frame. iPadOS may not load a video nobody has
 * played: after a moment it is played muted (allowed without a tap) and
 * stopped again.
 */
async function frameReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const loaded = once(video, "loadeddata");
  const nudge = setTimeout(() => {
    void video
      .play()
      .then(() => video.pause())
      .catch(() => undefined);
  }, 2_000);
  try {
    await loaded;
  } finally {
    clearTimeout(nudge);
  }
  video.pause();
}

/** The event, or a rejection on the element's error or after the timeout. */
function once(video: HTMLVideoElement, event: "loadeddata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (settle: () => void) => () => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
      settle();
    };
    const onEvent = done(resolve);
    const onError = done(() => reject(new Error("The video could not be read.")));
    const timer = setTimeout(done(() => reject(new Error("The video did not load in time."))), VIDEO_TIMEOUT_MS);
    video.addEventListener(event, onEvent);
    video.addEventListener("error", onError);
  });
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // In slices: String.fromCharCode takes its arguments on the stack.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}
