export interface OutputRegion {
    x: number;
    y: number;
    width: number;
    height: number;
    row: number;
    col: number;
    name: string;
}

/** Master canvas every GALLEON 100 SD export is cropped from. */
export const GALLEON_CANVAS = { width: 720, height: 1280 } as const;

/** Physical key size on the master canvas. */
export const GALLEON_KEY_SIZE = 160;

// User-supplied key coordinates on the 720 x 1280 master, in row-major order.
export const GALLEON_KEY_REGIONS: OutputRegion[] = [448, 672, 896, 1120].flatMap((y, row) =>
    [56, 280, 504].map((x, col) => ({
        name: `key_${String(row * 3 + col + 1).padStart(2, '0')}`,
        x, y, width: GALLEON_KEY_SIZE, height: GALLEON_KEY_SIZE, row, col,
    }))
);

export const GALLEON_SCREEN_REGION: OutputRegion = { name: 'screen', x: 0, y: 0, width: 720, height: 384, row: -1, col: -1 };

/** Non-displaying band between the screen and the first key row. */
export const GALLEON_GAP = { y: 384, height: 48 } as const;

// Hardware-visible regions are separate from the full master background export.
export const GALLEON_VISIBLE_REGIONS: OutputRegion[] = [GALLEON_SCREEN_REGION, ...GALLEON_KEY_REGIONS];

/** screen.gif, keys.gif (the complete master) and the twelve individual key GIFs. */
export const GALLEON_OUTPUT_REGIONS: OutputRegion[] = [
    GALLEON_SCREEN_REGION,
    { name: 'keys', x: 0, y: 0, width: GALLEON_CANVAS.width, height: GALLEON_CANVAS.height, row: -1, col: -1 },
    ...GALLEON_KEY_REGIONS,
];
