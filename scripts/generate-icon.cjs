/* eslint-disable @typescript-eslint/no-require-imports */
const { createCanvas } = require('@napi-rs/canvas');
const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

// desktop/icon.ico (window, taskbar and EXE): the GALLEON 100 SD face, an upper screen
// above a 3×4 key grid, in white on the studio accent. Small sizes are pixel-fitted by
// hand; larger ones are drawn from a 32-unit grid with the device outline.
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// [x, y, width, height] in pixels.
const PIXEL_LAYOUTS = {
    16: { radius: 3.5, screen: [3, 3, 10, 3], cols: [3, 7, 11], keyW: 2, rows: [7, 9, 11, 13], keyH: 1 },
    24: { radius: 5, screen: [5, 4, 14, 5], cols: [5, 10, 15], keyW: 4, rows: [10, 13, 16, 19], keyH: 2 },
    32: { radius: 7, screen: [7, 5, 18, 6], cols: [7, 14, 21], keyW: 4, rows: [13, 17, 21, 25], keyH: 3 },
};

function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

function draw(size) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const pixel = PIXEL_LAYOUTS[size];
    const u = size / 32;
    const tile = ctx.createLinearGradient(0, 0, 0, size);
    tile.addColorStop(0, '#8a72ff');
    tile.addColorStop(1, '#5638dc');
    ctx.fillStyle = tile;
    roundedRect(ctx, 0, 0, size, size, pixel ? pixel.radius : 7 * u);
    ctx.fill();
    ctx.fillStyle = '#ffffff';

    if (pixel) {
        ctx.fillRect(...pixel.screen);
        ctx.globalAlpha = 0.82;
        for (const y of pixel.rows) for (const x of pixel.cols) ctx.fillRect(x, y, pixel.keyW, pixel.keyH);
        return canvas;
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = 1.4 * u;
    roundedRect(ctx, 8 * u, 2.6 * u, 16 * u, 26.8 * u, 2.6 * u);
    ctx.stroke();
    roundedRect(ctx, 10.6 * u, 4.8 * u, 10.8 * u, 6 * u, 0.7 * u);
    ctx.fill();
    ctx.globalAlpha = 0.82;
    const key = 2.9 * u, pitch = 3.95 * u;
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
            roundedRect(ctx, 10.6 * u + col * pitch, 12.4 * u + row * pitch, key, key, 0.45 * u);
            ctx.fill();
        }
    }
    return canvas;
}

// ICO container with PNG-compressed entries (Windows Vista+); 0 in a size byte means 256.
const images = SIZES.map(size => ({ size, png: draw(size).toBuffer('image/png') }));
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length + 16 * images.length;
const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
});
const output = resolve(__dirname, '..', 'desktop', 'icon.ico');
writeFileSync(output, Buffer.concat([header, ...entries, ...images.map(image => image.png)]));
console.log(`Icon written: ${output} (${SIZES.join(', ')} px)`);

// The README logo is the same 256 px artwork.
const logo = resolve(__dirname, '..', 'docs', 'logo.png');
mkdirSync(dirname(logo), { recursive: true });
writeFileSync(logo, images.at(-1).png);
console.log(`Logo written: ${logo}`);
