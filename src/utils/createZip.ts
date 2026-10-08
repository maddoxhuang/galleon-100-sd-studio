import JSZip from 'jszip';
import type { TileData } from './gifOutputs';

/** Folder name inside every exported ZIP; unchanged so existing workflows keep working. */
export const ZIP_FOLDER = 'stream_deck_corsair_tiles';

/**
 * Package GIF outputs into a simple ZIP file.
 */
export const createTilesZip = async (tiles: TileData[]): Promise<Blob> => {
    const zip = new JSZip();
    const folder = zip.folder(ZIP_FOLDER);
    for (const tile of tiles) folder?.file(`${tile.name}.gif`, tile.buffer, { binary: true });
    return zip.generateAsync({ type: 'blob' });
};
