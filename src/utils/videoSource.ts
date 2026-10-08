import { MediaError } from '../lib/media';

const unreadable = () => new MediaError('webm-unreadable', 'The WebM video could not be decoded.');

/** Wait for decoding/accurate seeking, with cleanup on error, cancellation or timeout. */
function videoEvent(video: HTMLVideoElement, event: string, action: () => void, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            video.removeEventListener(event, ready);
            video.removeEventListener('error', failed);
            signal?.removeEventListener('abort', aborted);
        };
        const ready = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(unreadable()); };
        const aborted = () => { cleanup(); reject(new DOMException('Processing cancelled.', 'AbortError')); };
        const timer = setTimeout(() => {
            cleanup();
            reject(new MediaError('webm-timeout', 'Timed out while reading the WebM video.'));
        }, 30000);
        video.addEventListener(event, ready, { once: true });
        video.addEventListener('error', failed, { once: true });
        signal?.addEventListener('abort', aborted, { once: true });
        if (signal?.aborted) { aborted(); return; }
        try { action(); } catch (error) { cleanup(); reject(error); }
    });
}

export async function seekVideo(video: HTMLVideoElement, time: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (video.currentTime === time && video.readyState >= 2 && !video.seeking) return;
    await videoEvent(video, 'seeked', () => { video.currentTime = time; }, signal);
    if (video.readyState < 2) throw unreadable();
}

/** The caller owns the blob URL; this helper owns and releases its decoder. */
export async function loadVideo(url: string, signal?: AbortSignal) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const dispose = () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
    };
    try {
        await videoEvent(video, 'loadeddata', () => { video.src = url; video.load(); }, signal);
        if (!video.videoWidth || !video.videoHeight) throw unreadable();
        // Recorder-produced WebM may omit duration. Seeking to the end lets the
        // browser scan the local file and discover the actual duration.
        if (!Number.isFinite(video.duration)) {
            await seekVideo(video, Number.MAX_SAFE_INTEGER, signal);
        }
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) throw new MediaError('webm-duration', 'The WebM duration could not be determined.');
        await seekVideo(video, 0, signal);
        return { video, width: video.videoWidth, height: video.videoHeight, duration, dispose };
    } catch (error) {
        dispose();
        throw error;
    }
}
