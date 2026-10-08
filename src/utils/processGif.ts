import { parseGIF, decompressFrames } from 'gifuct-js';
import { DEFAULT_CROP, type CropSettings } from '../lib/gifCrop';
import { MediaError } from '../lib/media';
import { createGifOutputs, type TileData } from './gifOutputs';

export type { TileData } from './gifOutputs';

/**
 * Decode and composite each animation frame before cropping the output regions.
 * GALLEON exports screen + keys backgrounds and the 12 key GIFs embedded in
 * the profile, all from the same cropped master.
 */
export const processGif = async (file: File, crop: CropSettings = DEFAULT_CROP): Promise<TileData[]> => {
    const gif = parseGIF(await file.arrayBuffer());
    const frames = decompressFrames(gif, true);
    if (frames.length === 0) throw new MediaError('gif-no-frames', 'The GIF has no usable frames.');

    const outputs = createGifOutputs({ width: gif.lsd.width, height: gif.lsd.height }, crop);

    const canvas = document.createElement('canvas');
    canvas.width = gif.lsd.width;
    canvas.height = gif.lsd.height;
    const ctx = canvas.getContext('2d')!;
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d')!;
    let restoreFrame: ImageData | null = null;

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const dims = frame.dims;
        if (dims.width !== tempCanvas.width || dims.height !== tempCanvas.height) {
            tempCanvas.width = dims.width;
            tempCanvas.height = dims.height;
        }
        tempCtx.putImageData(new ImageData(new Uint8ClampedArray(frame.patch), dims.width, dims.height), 0, 0);

        const prevFrame = i > 0 ? frames[i - 1] : null;
        if (prevFrame && prevFrame.disposalType === 2) {
            ctx.clearRect(prevFrame.dims.left, prevFrame.dims.top, prevFrame.dims.width, prevFrame.dims.height);
        } else if (prevFrame?.disposalType === 3 && restoreFrame) {
            ctx.putImageData(restoreFrame, 0, 0);
        }
        restoreFrame = frame.disposalType === 3 ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
        ctx.drawImage(tempCanvas, dims.left, dims.top);

        // Composite in source coordinates first; then apply exactly the preview transform.
        outputs.addFrame(canvas, frame.delay);
    }

    return outputs.finish();
};
