import { DEFAULT_CROP, type CropSettings } from '../lib/gifCrop';
import { DEFAULT_WEBM_FPS, getVideoTimeline } from '../lib/media';
import { createGifOutputs, type TileData } from './gifOutputs';
import { loadVideo, seekVideo } from './videoSource';

export interface VideoProgress { completed: number; total: number }

export async function processWebm(file: File, crop: CropSettings = DEFAULT_CROP, options: {
    fps?: number;
    signal?: AbortSignal;
    onProgress?: (progress: VideoProgress) => void;
} = {}): Promise<TileData[]> {
    const url = URL.createObjectURL(file);
    let source: Awaited<ReturnType<typeof loadVideo>> | undefined;
    try {
        source = await loadVideo(url, options.signal);
        const timeline = getVideoTimeline(source.duration, options.fps ?? DEFAULT_WEBM_FPS);
        const outputs = createGifOutputs(source, crop);
        options.onProgress?.({ completed: 0, total: timeline.frameCount });
        for (let i = 0; i < timeline.frameCount; i++) {
            options.signal?.throwIfAborted();
            const frame = timeline.frame(i);
            await seekVideo(source.video, frame.time, options.signal);
            outputs.addFrame(source.video, frame.delay);
            options.onProgress?.({ completed: i + 1, total: timeline.frameCount });
            // Give the progress UI and cancel button time to respond between frames.
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        options.signal?.throwIfAborted();
        return outputs.finish();
    } finally {
        source?.dispose();
        URL.revokeObjectURL(url);
    }
}
