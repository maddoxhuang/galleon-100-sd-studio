/* eslint-disable @typescript-eslint/no-require-imports */
const { createCanvas } = require('@napi-rs/canvas');
const GIFEncoder = require('gif-encoder-2');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

// Diagnostic artwork: screen, hardware keys and gaps on the full master export.
const canvas = createCanvas(720, 1280);
const ctx = canvas.getContext('2d');
const encoder = new GIFEncoder(720, 1280);
encoder.start();
encoder.setRepeat(0);
encoder.setDelay(250);
for (let frame = 0; frame < 4; frame++) {
    ctx.fillStyle = '#211532';
    ctx.fillRect(0, 0, 720, 1280);
    ctx.fillStyle = '#69429e';
    ctx.fillRect(0, 0, 720, 384);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 46px sans-serif';
    ctx.fillText('INFO DISPLAY', 360, 145);
    ctx.font = '30px sans-serif';
    ctx.fillText('720 x 384', 360, 200);
    ctx.fillStyle = '#f5c45e';
    ctx.fillRect(48 + frame * 156, 282, 120, 34);
    ctx.fillStyle = '#d15673';
    ctx.fillRect(0, 384, 720, 48);
    ctx.fillStyle = '#ffffff';
    ctx.font = '22px sans-serif';
    ctx.fillText('48 px gap - retained in full keys.gif', 360, 417);
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
            const x = 56 + col * 224;
            const y = 448 + row * 224;
            ctx.fillStyle = row === frame ? '#f5c45e' : '#8763be';
            ctx.fillRect(x, y, 160, 160);
            ctx.fillStyle = '#211532';
            ctx.font = 'bold 30px sans-serif';
            ctx.fillText(`${row * 3 + col + 1}`, x + 80, y + 94);
        }
    }
    encoder.addFrame(ctx.getImageData(0, 0, 720, 1280).data);
}
encoder.finish();
const output = resolve(__dirname, '../public/sample/sample_720x1280.gif');
writeFileSync(output, encoder.out.getData());
console.log(`Generated ${output}`);
