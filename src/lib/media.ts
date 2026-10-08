export type MediaKind = 'gif' | 'webm';

export type MediaErrorCode = 'gif-no-frames' | 'webm-unreadable' | 'webm-timeout' | 'webm-duration';

/** A failure caused by the user's file; the interface shows localized text for its code. */
export class MediaError extends Error {
    readonly code: MediaErrorCode;
    constructor(code: MediaErrorCode, message: string) {
        super(message);
        this.name = 'MediaError';
        this.code = code;
    }
}

export function getMediaKind(file: Pick<File, 'name' | 'type'>): MediaKind | null {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const mime = file.type.split(';')[0].trim().toLowerCase();
    if (extension === 'gif' || mime === 'image/gif') return 'gif';
    if (extension === 'webm' || mime === 'video/webm') return 'webm';
    return null;
}

export const WEBM_FRAME_RATES = [10, 15, 20, 25, 30] as const;
export const DEFAULT_WEBM_FPS = 20;

/** GIF delays are centiseconds. Round boundaries, not each frame, to avoid drift. */
export function getVideoTimeline(duration: number, fps: number) {
    if (!Number.isFinite(duration) || duration <= 0 || !WEBM_FRAME_RATES.some(rate => rate === fps)) {
        throw new Error('Invalid video duration or frame rate.');
    }
    const totalTicks = Math.max(1, Math.round(duration * 100));
    const frameCount = Math.max(1, Math.ceil((totalTicks - 0.5) * fps / 100));
    return {
        frameCount,
        frame(index: number) {
            const start = Math.round(index * 100 / fps);
            const end = Math.min(totalTicks, Math.round((index + 1) * 100 / fps));
            return { time: Math.max(0, Math.min(index / fps, duration - 0.000001)), delay: (end - start) * 10 };
        },
    };
}
