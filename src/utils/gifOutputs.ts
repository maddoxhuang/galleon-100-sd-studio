import GIFEncoder from 'gif-encoder-2';
import { GALLEON_CANVAS, GALLEON_OUTPUT_REGIONS } from '../lib/layouts';
import { getCropTransform, type CropSettings, type ImageSize } from '../lib/gifCrop';

export interface TileData {
    row: number;
    col: number;
    width: number;
    height: number;
    buffer: Uint8Array;
    name: string;
}

/** Both GIF and WebM frames share the preview transform and output regions. */
export function createGifOutputs(source: ImageSize, crop: CropSettings) {
    const expected = GALLEON_CANVAS;
    const transform = getCropTransform(source, expected, crop);
    const outputs = GALLEON_OUTPUT_REGIONS.map(region => {
        const encoder = new GIFEncoder(region.width, region.height);
        encoder.start();
        encoder.setRepeat(0);
        encoder.setQuality(10);
        return { region, encoder };
    });
    const master = document.createElement('canvas');
    master.width = expected.width;
    master.height = expected.height;
    const ctx = master.getContext('2d')!;
    ctx.imageSmoothingEnabled = transform.scale !== 1;
    ctx.imageSmoothingQuality = 'high';
    return {
        addFrame(frame: CanvasImageSource, delay: number) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, expected.width, expected.height);
            ctx.drawImage(frame, transform.x, transform.y, transform.width, transform.height);
            for (const { region, encoder } of outputs) {
                encoder.setDelay(delay);
                encoder.addFrame(ctx.getImageData(region.x, region.y, region.width, region.height).data);
            }
        },
        finish(): TileData[] {
            return outputs.map(({ region, encoder }) => {
                encoder.finish();
                return { row: region.row, col: region.col, width: region.width, height: region.height, name: region.name, buffer: encoder.out.getData() };
            });
        },
    };
}
