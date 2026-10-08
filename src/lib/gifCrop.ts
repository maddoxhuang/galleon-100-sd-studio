export interface ImageSize { width: number; height: number }

export interface CropSettings {
    fit: 'cover' | 'contain';
    zoom: number;
    panX: number;
    panY: number;
}

export const DEFAULT_CROP: CropSettings = { fit: 'cover', zoom: 1, panX: 0, panY: 0 };

/** Shared by the animated preview and every exported frame. Pan is -1..1. */
export function getCropTransform(source: ImageSize, target: ImageSize, crop: CropSettings = DEFAULT_CROP) {
    if (![source.width, source.height, target.width, target.height].every(n => Number.isFinite(n) && n > 0)
        || ![crop.zoom, crop.panX, crop.panY].every(Number.isFinite)
        || !['cover', 'contain'].includes(crop.fit)) {
        throw new Error('Invalid image dimensions or crop settings.');
    }
    const ratios = [target.width / source.width, target.height / source.height];
    const base = crop.fit === 'contain' ? Math.min(...ratios) : Math.max(...ratios);
    const scale = base * Math.max(1, Math.min(4, crop.zoom));
    const width = source.width * scale;
    const height = source.height * scale;
    const rangeX = Math.abs(target.width - width) / 2;
    const rangeY = Math.abs(target.height - height) / 2;
    return {
        width, height, scale, rangeX, rangeY,
        x: (target.width - width) / 2 + Math.max(-1, Math.min(1, crop.panX)) * rangeX,
        y: (target.height - height) / 2 + Math.max(-1, Math.min(1, crop.panY)) * rangeY,
    };
}
