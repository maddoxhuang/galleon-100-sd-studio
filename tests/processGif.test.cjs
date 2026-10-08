/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const { createCanvas, ImageData } = require('@napi-rs/canvas');
const GIFEncoder = require('gif-encoder-2');
const { parseGIF, decompressFrames } = require('gifuct-js');
const JSZip = require('jszip');

// Run the production TypeScript with real Canvas pixel operations in Node.
require.extensions['.ts'] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    });
    module._compile(outputText, filename);
};
global.ImageData = ImageData;
global.document = { createElement: tag => {
    assert.equal(tag, 'canvas');
    return createCanvas(1, 1);
} };
const { processGif } = require('../src/utils/processGif.ts');
const { createTilesZip } = require('../src/utils/createZip.ts');
const { exportStreamDeckProfile } = require('../src/utils/exportProfile.ts');
const { GALLEON_CANVAS, GALLEON_KEY_SIZE } = require('../src/lib/layouts.ts');
const screenPlayer = require('../src/lib/screenPlayer.json');

function makeGif(width, height, paint, delays = [120, 230]) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const encoder = new GIFEncoder(width, height);
    encoder.start();
    encoder.setRepeat(0);
    for (let i = 0; i < delays.length; i++) {
        paint(ctx, i);
        encoder.setDelay(delays[i]);
        encoder.addFrame(ctx.getImageData(0, 0, width, height).data);
    }
    encoder.finish();
    return new File([encoder.out.getData()], 'fixture.gif', { type: 'image/gif' });
}

function pixel(frame, x, y) {
    const offset = (y * frame.dims.width + x) * 4;
    return Array.from(frame.patch.slice(offset, offset + 3));
}

function near(actual, expected, label) {
    actual.forEach((value, channel) => assert.ok(Math.abs(value - expected[channel]) <= 8,
        `${label}: ${actual} should match ${expected}`));
}

function masterGif() {
    return makeGif(720, 1280, (ctx, frame) => {
        ctx.fillStyle = frame ? '#00ff00' : '#ff0000';
        ctx.fillRect(0, 0, 720, 384);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 383, 720, 1);
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(0, 384, 720, 48); // retained in the full keys output, absent from screen
        ctx.fillStyle = frame ? '#00ffff' : '#0000ff';
        ctx.fillRect(0, 432, 720, 848);
        ctx.fillStyle = '#ffff00';
        ctx.fillRect(0, 432, 720, 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 1279, 720, 1);
        ctx.fillStyle = '#000000';
        ctx.fillRect(719, 0, 1, 1280);
    });
}

test('GALLEON: screen crop and complete master retain boundaries, gaps, delays and ZIP entries', async () => {
    const file = masterGif();
    const inputFrames = decompressFrames(parseGIF(await file.arrayBuffer()), true);
    const outputs = (await processGif(file)).filter(tile => tile.row < 0);
    assert.deepEqual(outputs.map(({ name, width, height }) => ({ name, width, height })), [
        { name: 'screen', width: 720, height: 384 },
        { name: 'keys', width: 720, height: 1280 },
    ]);
    for (const [index, output] of outputs.entries()) {
        const parsed = parseGIF(output.buffer);
        assert.equal(parsed.lsd.width, 720);
        assert.equal(parsed.lsd.height, index === 0 ? 384 : 1280);
        const frames = decompressFrames(parsed, true);
        assert.deepEqual(frames.map(f => f.delay), [120, 230]);
        const sampleRows = index === 0 ? [0, 1, 192, 383] : [0, 1, 383, 384, 400, 431, 432, 448, 640, 1279];
        for (let frame = 0; frame < frames.length; frame++) {
            for (const y of sampleRows) {
                for (const x of [0, 360, 718, 719]) {
                    near(pixel(frames[frame], x, y), pixel(inputFrames[frame], x, y), `${output.name} frame ${frame} (${x},${y})`);
                }
            }
        }
    }
    const zip = await JSZip.loadAsync(await (await createTilesZip(outputs)).arrayBuffer());
    assert.deepEqual(Object.values(zip.files).filter(f => !f.dir).map(f => f.name).sort(), [
        'stream_deck_corsair_tiles/keys.gif', 'stream_deck_corsair_tiles/screen.gif',
    ]);
    for (const output of outputs) {
        const bytes = await zip.file(`stream_deck_corsair_tiles/${output.name}.gif`).async('uint8array');
        assert.deepEqual(bytes, new Uint8Array(output.buffer));
    }
});

test('GALLEON accepts small GIFs and valid GIFs above 2 MiB', async () => {
    const old = makeGif(288, 576, ctx => ctx.fillRect(0, 0, 288, 576), [100]);
    assert.deepEqual((await processGif(old)).filter(tile => tile.row < 0).map(({ width, height }) => [width, height]), [[720, 384], [720, 1280]]);

    const original = new Uint8Array(await masterGif().arrayBuffer());
    // Valid GIF comment extension before the trailer, not a mocked File.size.
    const blocks = Array.from({ length: 8300 }, () => Buffer.concat([Buffer.from([255]), Buffer.alloc(255, 65)]));
    const large = new File([original.slice(0, -1), Uint8Array.of(0x21, 0xfe), ...blocks, Uint8Array.of(0, 0x3b)], 'large.gif', { type: 'image/gif' });
    assert.ok(large.size > 2 * 1024 * 1024);
    assert.equal((await processGif(large)).length, 14);
});

test('GALLEON profile preserves twelve animated keys and provides a native dial to a functional page and back', async () => {
    const tiles = await processGif(masterGif());
    const zip = await JSZip.loadAsync(await (await exportStreamDeckProfile(tiles, 'GALLEON animation', '功能页')).arrayBuffer());
    const json = async name => JSON.parse(await zip.file(name).async('string'));
    const pack = await json('package.json');
    assert.equal(pack.DeviceModel, 'GRETSCH');
    assert.equal(pack.OSType, 'Windows');
    assert.deepEqual(pack.RequiredPlugins, [screenPlayer.pluginUUID, 'com.elgato.streamdeck.keys', 'com.elgato.streamdeck.page']);
    const rootPath = Object.keys(zip.files).find(path => /^Profiles\/[^/]+\.sdProfile\/manifest.json$/.test(path));
    const root = await json(rootPath);
    assert.equal(root.Device.Model, pack.DeviceModel);
    assert.equal(root.Name, 'GALLEON animation');
    assert.equal(root.Version, '3.0');
    assert.equal(root.Pages.Current, root.Pages.Pages[0]);
    const rootDir = rootPath.replace(/manifest.json$/, '');
    const pageDir = `${rootDir}Profiles/${root.Pages.Current.toUpperCase()}/`;
    const page = await json(`${pageDir}manifest.json`);
    assert.deepEqual(page.Controllers.map(c => c.Type), ['Keypad', 'Encoder']);
    for (const [index, name] of ['keys', 'screen'].entries()) {
        const controller = page.Controllers[index];
        assert.equal(controller.Background, `Images/${name}.gif`);
        const bytes = await zip.file(`${pageDir}${controller.Background}`).async('uint8array');
        assert.deepEqual(bytes, new Uint8Array(tiles.find(tile => tile.name === name).buffer));
        const parsed = parseGIF(bytes);
        assert.deepEqual([parsed.lsd.width, parsed.lsd.height], [720, name === 'keys' ? 1280 : 384]);
        assert.deepEqual(decompressFrames(parsed, true).map(frame => frame.delay), [120, 230]);
    }
    const keyActions = page.Controllers[0].Actions;
    assert.equal(Object.keys(keyActions).length, 12);
    for (const tile of tiles.filter(tile => tile.row >= 0)) {
        const action = keyActions[`${tile.col},${tile.row}`];
        assert.equal(action.UUID, screenPlayer.keyActionUUID);
        assert.equal(action.Plugin.Version, screenPlayer.version);
        assert.equal(action.Settings.key, tile.row * 3 + tile.col);
        assert.ok(action.Settings.animationId);
        assert.equal(action.States[0].ShowTitle, false);
        assert.equal(action.States[0].Image, undefined, 'no independent native GIF player');
        const bytes = await zip.file(`${pageDir}Images/key_${String(tile.row * 3 + tile.col + 1).padStart(2, '0')}.gif`).async('uint8array');
        assert.deepEqual(bytes, new Uint8Array(tile.buffer));
        assert.deepEqual(decompressFrames(parseGIF(bytes), true).map(frame => frame.delay), [120, 230]);
    }
    const checkNavigation = controller => {
        assert.deepEqual(Object.keys(controller.Actions), ['0,0']);
        const dial = controller.Actions['0,0'];
        assert.equal(dial.UUID, 'com.elgato.streamdeck.keys.adaptor');
        assert.equal(dial.Plugin.UUID, 'com.elgato.streamdeck.keys');
        assert.deepEqual(dial.Settings, {});
        assert.deepEqual(dial.Actions.map(a => a.UUID), ['previous', 'goto', 'next'].map(c => `com.elgato.streamdeck.page.${c}`));
        assert.deepEqual(dial.Actions.map(a => a.Settings), [{}, { PageIndex: 0 }, {}]);
        assert.ok(dial.Actions.every(a => a.Plugin.UUID === 'com.elgato.streamdeck.page'));
    };
    checkNavigation(page.Controllers[1]);
    assert.equal(root.Pages.Pages.length, 2);
    const controlPage = await json(`${rootDir}Profiles/${root.Pages.Pages[1].toUpperCase()}/manifest.json`);
    assert.equal(controlPage.Name, '功能页');
    assert.equal(controlPage.Controllers[0].Actions, null, 'all twelve functional keys are available');
    assert.equal(controlPage.Controllers[1].Background, undefined, 'animation cannot cover functional controls');
    checkNavigation(controlPage.Controllers[1]);
    assert.notEqual(page.Controllers[1].Actions['0,0'].ActionID, controlPage.Controllers[1].Actions['0,0'].ActionID);
    assert.equal(new Set(Object.values(keyActions).map(action => action.Settings.animationId)).size, 1);
    assert.equal(Object.values(keyActions).filter(action => action.Settings.masterGif).length, 1);
    assert.deepEqual(Buffer.from(keyActions['0,0'].Settings.masterGif, 'base64'), Buffer.from(tiles.find(tile => tile.name === 'keys').buffer));
    const defaults = await json(`${rootDir}Profiles/${root.Pages.Default.toUpperCase()}/manifest.json`);
    assert.deepEqual(defaults.Controllers[0], { Actions: null, Type: 'Keypad' });
    checkNavigation(defaults.Controllers[1]);
    assert.equal(Object.keys(zip.files).filter(path => /\.gif$/.test(path)).length, 14);
});

test('profile export names the profile and functional page in English by default', async () => {
    const zip = await JSZip.loadAsync(await (await exportStreamDeckProfile(await processGif(masterGif()))).arrayBuffer());
    const manifests = await Promise.all(Object.keys(zip.files)
        .filter(path => /manifest\.json$/.test(path))
        .map(async path => JSON.parse(await zip.file(path).async('string'))));
    const names = manifests.map(manifest => manifest.Name).filter(Boolean).sort();
    assert.deepEqual(names, ['Functions', 'GALLEON 100 SD Background', 'GALLEON 100 SD Background']);
});

test('profile export rejects missing, duplicate or wrong-size GALLEON backgrounds and keys', async () => {
    const tiles = [
        { name: 'screen', row: -1, col: -1, width: 720, height: 384, buffer: Uint8Array.of(1) },
        { name: 'keys', row: -1, col: -1, width: 720, height: 1280, buffer: Uint8Array.of(2) },
    ];
    const keys = Array.from({ length: 12 }, (_, i) => ({ row: Math.floor(i / 3), col: i % 3, width: 160, height: 160, buffer: Uint8Array.of(1) }));
    for (const input of [[], [...tiles], [...keys, tiles[0]], [...keys, ...tiles, tiles[0]], [...keys, tiles[0], { ...tiles[1], height: 848 }], [...keys, tiles[0], { ...tiles[1], buffer: new Uint8Array() }], [...tiles, ...keys, keys[0]], [...tiles, ...keys.slice(1)], [...tiles, { ...keys[0], width: 96 }, ...keys.slice(1)]]) {
        await assert.rejects(exportStreamDeckProfile(input), /GALLEON profile requires/);
    }
});

test('GALLEON key tiles use all 12 supplied master coordinates, also after upscaling', async () => {
    const coordinates = [
        [56, 448], [280, 448], [504, 448],
        [56, 672], [280, 672], [504, 672],
        [56, 896], [280, 896], [504, 896],
        [56, 1120], [280, 1120], [504, 1120],
    ];
    const names = Array.from({ length: 12 }, (_, i) => `key_${String(i + 1).padStart(2, '0')}`);
    for (const scale of [1, 0.5]) {
        const file = makeGif(720 * scale, 1280 * scale, (ctx, frame) => {
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.fillStyle = '#ff00ff';
            ctx.fillRect(0, 0, 720, 1280);
            coordinates.forEach(([x, y], i) => {
                ctx.fillStyle = `rgb(${48 + i % 3 * 72}, ${48 + Math.floor(i / 3) * 48}, ${frame ? 220 : 32})`;
                ctx.fillRect(x, y, 160, 160);
            });
        });
        const input = decompressFrames(parseGIF(await file.arrayBuffer()), true);
        const outputs = await processGif(file);
        assert.equal(outputs.length, 14);
        const keys = outputs.filter(tile => tile.row >= 0);
        assert.deepEqual(keys.map(tile => tile.name), names);
        keys.forEach((tile, i) => {
            assert.deepEqual([tile.row, tile.col, tile.width, tile.height], [Math.floor(i / 3), i % 3, 160, 160]);
            const parsed = parseGIF(tile.buffer);
            assert.deepEqual([parsed.lsd.width, parsed.lsd.height], [160, 160]);
            const frames = decompressFrames(parsed, true);
            assert.deepEqual(frames.map(frame => frame.delay), [120, 230]);
            const [x, y] = coordinates[i];
            for (let frame = 0; frame < 2; frame++) {
                for (const [px, py] of scale === 1 ? [[0, 0], [159, 0], [0, 159], [159, 159], [80, 80]] : [[8, 8], [151, 151], [80, 80]]) {
                    near(pixel(frames[frame], px, py), pixel(input[frame], Math.floor((x + px) * scale), Math.floor((y + py) * scale)), `${tile.name} scale ${scale} (${px},${py})`);
                }
            }
        });
    }
});

test('half-size portrait is enlarged for GALLEON screen and full master, preserving animation', async () => {
    const source = makeGif(360, 640, (ctx, frame) => {
        ctx.fillStyle = frame ? '#00ff00' : '#ff0000';
        ctx.fillRect(0, 0, 360, 192);
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(0, 192, 360, 24);
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(0, 216, 360, 424);
    });
    const outputs = await processGif(source);
    const screen = decompressFrames(parseGIF(outputs[0].buffer), true);
    const keys = decompressFrames(parseGIF(outputs[1].buffer), true);
    assert.deepEqual(screen.map(frame => frame.delay), [120, 230]);
    near(pixel(screen[0], 360, 100), [255, 0, 0], 'upscaled first frame');
    near(pixel(screen[1], 360, 100), [0, 255, 0], 'upscaled second frame');
    assert.deepEqual(keys.map(frame => frame.delay), [120, 230]);
    near(pixel(keys[0], 360, 10), [255, 0, 0], 'full master retains first screen frame');
    near(pixel(keys[1], 360, 10), [0, 255, 0], 'full master retains second screen frame');
    for (const frame of keys) {
        near(pixel(frame, 360, 400), [255, 0, 255], 'full master retains resized gap');
        near(pixel(frame, 360, 450), [0, 0, 255], 'keys keep their master coordinates');
    }
});

test('landscape panning selects left/right content without stretching, and contain adds black borders', async () => {
    const source = makeGif(144, 128, ctx => {
        ['#ff0000', '#00ff00', '#0000ff'].forEach((color, column) => {
            ctx.fillStyle = color;
            ctx.fillRect(column * 48, 0, 48, 128);
        });
    }, [100]);
    const exportFrames = async crop => (await processGif(source, crop)).map(tile => decompressFrames(parseGIF(tile.buffer), true)[0]);
    const left = await exportFrames({ fit: 'cover', zoom: 1, panX: 1, panY: 0 });
    const right = await exportFrames({ fit: 'cover', zoom: 1, panX: -1, panY: 0 });
    near(pixel(left[0], 100, 100), [255, 0, 0], 'left crop');
    near(pixel(right[0], 600, 100), [0, 0, 255], 'right crop');
    near(pixel(right[0], 100, 100), [0, 255, 0], 'right crop begins in middle stripe');
    const contained = await exportFrames({ fit: 'contain', zoom: 1, panX: 0, panY: 0 });
    near(pixel(contained[0], 100, 100), [0, 0, 0], 'top padding');
    near(pixel(contained[0], 100, 350), [255, 0, 0], 'image retains left stripe');
    near(pixel(contained[1], 600, 532), [0, 0, 255], 'image retains right stripe');
    near(pixel(contained[1], 360, 1232), [0, 0, 0], 'bottom padding');
    const zoomed = await exportFrames({ fit: 'cover', zoom: 2, panX: 0, panY: 0 });
    near(pixel(zoomed[0], 10, 100), [0, 255, 0], 'zoom crops both outer stripes');
    near(pixel(zoomed[1], 710, 700), [0, 255, 0], 'zoom applied equally to keys');
});

// Compose actual GIF image blocks with partial-frame offsets and disposal modes.
async function partialAnimation(disposal) {
    const base = new Uint8Array(await makeGif(40, 40, ctx => { ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 40, 40); }, [100]).arrayBuffer());
    const headerEnd = 13 + 3 * (1 << ((base[10] & 7) + 1));
    const parts = [base.slice(0, headerEnd)];
    for (const [width, color, offset, mode, delay] of [[40, '#ff0000', 0, 1, 10], [10, '#00ff00', 10, disposal, 20], [10, '#0000ff', 20, 1, 30]]) {
        const bytes = new Uint8Array(await makeGif(width, width, ctx => { ctx.fillStyle = color; ctx.fillRect(0, 0, width, width); }, [delay * 10]).arrayBuffer());
        const paletteEnd = 13 + 3 * (1 << ((bytes[10] & 7) + 1));
        let position = paletteEnd;
        while (bytes[position] === 0x21) {
            position += 2;
            while (bytes[position]) position += bytes[position] + 1;
            position++;
        }
        assert.equal(bytes[position], 0x2c);
        const descriptor = bytes.slice(position, position + 10);
        descriptor[1] = descriptor[3] = offset;
        descriptor[9] = 0x80 | (bytes[10] & 7);
        parts.push(Uint8Array.of(0x21, 0xf9, 4, mode << 2, delay, 0, 0, 0), descriptor, bytes.slice(13, paletteEnd), bytes.slice(position + 10, -1));
    }
    parts.push(Uint8Array.of(0x3b));
    return new File(parts, 'partial.gif', { type: 'image/gif' });
}

for (const disposal of [2, 3]) {
    test(`partial GIF frames are composited before resize (disposal ${disposal})`, async () => {
        const tiles = await processGif(await partialAnimation(disposal));
        // 40x40 covers 720x1280 at 32x, centred: source (15,15) lands on master (200,480).
        const frames = decompressFrames(parseGIF(tiles.find(tile => tile.name === 'keys').buffer), true);
        assert.deepEqual(frames.map(frame => frame.delay), [100, 200, 300]);
        near(pixel(frames[0], 200, 480), [255, 0, 0], 'base frame');
        near(pixel(frames[1], 200, 480), [0, 255, 0], 'offset partial patch');
        near(pixel(frames[2], 200, 480), disposal === 2 ? [0, 0, 0] : [255, 0, 0], 'disposed partial patch');
    });
}

test('GALLEON layout and bundled sample match the production layout', () => {
    assert.deepEqual(GALLEON_CANVAS, { width: 720, height: 1280 });
    assert.equal(GALLEON_KEY_SIZE, 160);
    const gif = parseGIF(fs.readFileSync('public/sample/sample_720x1280.gif'));
    assert.deepEqual([gif.lsd.width, gif.lsd.height], [720, 1280]);
    assert.ok(decompressFrames(gif, true).length > 1);
});
