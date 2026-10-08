/* eslint-disable @typescript-eslint/no-require-imports */
// Renderer-side media checks, driven by tests/desktop.e2e.cjs against the built app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseGIF, decompressFrames } = require('gifuct-js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const JSZip = require('jszip');
const screenPlayer = require('../src/lib/screenPlayer.json');

function rgb(frame, x, y) {
    const offset = (y * frame.dims.width + x) * 4;
    return [...frame.patch.slice(offset, offset + 3)];
}
function near(actual, expected, message) {
    // Allow video YUV conversion and GIF palette quantization, while keeping
    // neighboring key colors distinguishable (48/72 steps).
    assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) <= 32), `${message}: ${actual} vs ${expected}`);
}
function decode(bytes, width, height) {
    const parsed = parseGIF(bytes);
    assert.deepEqual([parsed.lsd.width, parsed.lsd.height], [width, height]);
    const frames = decompressFrames(parsed, true);
    assert.ok(frames.length > 1, 'animated output');
    assert.ok(frames.every(f => f.delay >= 10));
    return frames;
}

async function browserDownload(page, action) {
    const event = page.waitForEvent('download', { timeout: 120000 });
    await action();
    return event;
}

// Results are listed, not auto-saved: wait for this generation's outputs to be current.
async function generate(page) {
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const state = await page.waitForFunction(
        () => document.querySelector('.status-chip.ok') ? 'ok' : document.querySelector('#error_message')?.textContent?.trim() || false,
        null, { timeout: 120000 });
    assert.equal(await state.jsonValue(), 'ok');
}

// Returns the profile's 12 key GIFs in key order (key_01 … key_12).
async function checkGalleonProfile(page, backgrounds, downloadFile = browserDownload, functionsPage = 'Functions') {
    const download = await downloadFile(page, () => page.locator('a[download="GALLEON_100_SD_Background.streamDeckProfile"]').click());
    assert.equal(download.suggestedFilename(), 'GALLEON_100_SD_Background.streamDeckProfile');
    const profile = await JSZip.loadAsync(fs.readFileSync(await download.path()));
    const pack = JSON.parse(await profile.file('package.json').async('string'));
    assert.equal(pack.DeviceModel, 'GRETSCH'); assert.deepEqual(pack.RequiredPlugins, [screenPlayer.pluginUUID, 'com.elgato.streamdeck.keys', 'com.elgato.streamdeck.page']);
    const rootPath = Object.keys(profile.files).find(path => /^Profiles\/[^/]+\.sdProfile\/manifest.json$/.test(path));
    const root = JSON.parse(await profile.file(rootPath).async('string'));
    const pageDir = rootPath.replace(/manifest.json$/, '') + `Profiles/${root.Pages.Current.toUpperCase()}/`;
    const content = JSON.parse(await profile.file(pageDir + 'manifest.json').async('string'));
    for (const [type, name, height] of [['Keypad','keys',1280],['Encoder','screen',384]]) {
        const controller = content.Controllers.find(c=>c.Type===type);
        if (type === 'Keypad') assert.equal(Object.keys(controller.Actions).length, 12);
        else {
            assert.deepEqual(Object.keys(controller.Actions), ['0,0']);
            const dial = controller.Actions['0,0'];
            assert.equal(dial.UUID, 'com.elgato.streamdeck.keys.adaptor');
            assert.deepEqual(dial.Actions.map(a => a.UUID), ['previous','goto','next'].map(c => `com.elgato.streamdeck.page.${c}`));
            assert.deepEqual(dial.Actions[1].Settings, { PageIndex: 0 });
        }
        const bytes = await profile.file(pageDir + controller.Background).async('uint8array');
        decode(bytes,720,height);
        assert.deepEqual(bytes,await backgrounds.file(`stream_deck_corsair_tiles/${name}.gif`).async('uint8array'));
    }
    const keyGifs = [];
    for (const action of Object.values(content.Controllers[0].Actions)) {
        assert.equal(action.UUID, screenPlayer.keyActionUUID);
        assert.equal(action.States[0].Image, undefined);
        keyGifs[action.Settings.key] = await profile.file(`${pageDir}Images/key_${String(action.Settings.key + 1).padStart(2, '0')}.gif`).async('uint8array');
        decode(keyGifs[action.Settings.key],160,160);
    }
    assert.equal(keyGifs.filter(Boolean).length, 12, 'one GIF per key');
    const master = await backgrounds.file('stream_deck_corsair_tiles/keys.gif').async('nodebuffer');
    assert.deepEqual(Buffer.from(content.Controllers[0].Actions['0,0'].Settings.masterGif, 'base64'), master);
    assert.equal(root.Pages.Pages.length, 2);
    const controls = JSON.parse(await profile.file(rootPath.replace(/manifest.json$/, '') + `Profiles/${root.Pages.Pages[1].toUpperCase()}/manifest.json`).async('string'));
    assert.equal(controls.Name, functionsPage);
    assert.equal(controls.Controllers[0].Actions, null);
    assert.deepEqual(controls.Controllers[1].Actions['0,0'].Actions.map(a => a.UUID), ['previous','goto','next'].map(c => `com.elgato.streamdeck.page.${c}`));
    const plugin = await downloadFile(page, () => page.locator(`a[download="${screenPlayer.filename}"]`).click());
    assert.equal(plugin.suggestedFilename(), screenPlayer.filename);
    const pluginBytes = fs.readFileSync(await plugin.path());
    assert.ok(pluginBytes.equals(fs.readFileSync('public' + screenPlayer.download)), `plugin ZIP must match (${pluginBytes.length} bytes received)`);
    const installerZip = await JSZip.loadAsync(pluginBytes);
    assert.deepEqual(await installerZip.file('com.sd100.screen-player.streamDeckPlugin').async('nodebuffer'),fs.readFileSync('public/plugins/com.sd100.screen-player.streamDeckPlugin'));
    assert.ok(installerZip.file('README.txt'));
    return keyGifs;
}

async function makeWebm(page, codec) {
    const chunks = await page.evaluate(async codec => {
        const canvas = document.createElement('canvas');
        canvas.width = 180; canvas.height = 320;
        const ctx = canvas.getContext('2d');
        const paint = green => {
            ctx.fillStyle = green ? '#00ff00' : '#ff0000'; ctx.fillRect(0, 0, 180, 96);
            ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 96, 180, 12);
            ctx.fillStyle = '#0000ff'; ctx.fillRect(0, 108, 180, 212);
            [112, 168, 224, 280].forEach((y, row) => [14, 70, 126].forEach((x, col) => {
                ctx.fillStyle = `rgb(${48 + col * 72}, ${48 + row * 48}, ${green ? 220 : 32})`;
                ctx.fillRect(x, y, 40, 40);
            }));
        };
        const frames = [];
        const encoder = new VideoEncoder({ output: chunk => {
            const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
            frames.push({ bytes: [...bytes], timestamp: chunk.timestamp, key: chunk.type === 'key' });
        }, error: error => { throw error; } });
        encoder.configure({ codec: codec === 'vp8' ? 'vp8' : 'vp09.00.10.08', width: 180, height: 320, bitrate: 3000000, framerate: 10 });
        for (let i = 0; i < 8; i++) {
            paint(i >= 4);
            const frame = new VideoFrame(canvas, { timestamp: i * 100000, duration: 100000 });
            encoder.encode(frame, { keyFrame: i === 0 }); frame.close();
        }
        await encoder.flush(); encoder.close();
        return frames;
    }, codec);
    assert.equal(chunks.length, 8);
    // Minimal real WebM container around browser-encoded frames. VP8 intentionally
    // omits Duration/Cues, as recorder files do; VP9 has a declared duration.
    const size = n => n < 127 ? Buffer.from([0x80 | n]) : n < 16383 ? Buffer.from([0x40 | n >> 8, n & 255]) : Buffer.from([0x20 | n >> 16, n >> 8 & 255, n & 255]);
    const element = (id, data) => Buffer.concat([Buffer.from(id, 'hex'), size(data.length), data]);
    const uint = (id, value) => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return element(id, b); };
    const string = (id, value) => element(id, Buffer.from(value));
    const header = element('1a45dfa3', Buffer.concat([uint('4286',1),uint('42f7',1),uint('42f2',4),uint('42f3',8),string('4282','webm'),uint('4287',4),uint('4285',2)]));
    const duration = Buffer.alloc(8); duration.writeDoubleBE(800);
    const info = element('1549a966', Buffer.concat([uint('2ad7b1',1000000),string('4d80','test'),string('5741','test'),...(codec==='vp9'?[element('4489',duration)]:[])]));
    const track = element('1654ae6b',element('ae',Buffer.concat([uint('d7',1),uint('73c5',1),uint('83',1),string('86',codec==='vp8'?'V_VP8':'V_VP9'),uint('23e383',100000000),element('e0',Buffer.concat([uint('b0',180),uint('ba',320)]))])));
    const cluster = element('1f43b675',Buffer.concat([uint('e7',0),...chunks.map(chunk=>{
        const block=Buffer.alloc(4); block[0]=0x81; block.writeInt16BE(chunk.timestamp/1000,1); block[3]=chunk.key?0x80:0;
        return element('a3',Buffer.concat([block,Buffer.from(chunk.bytes)]));
    })]));
    return Buffer.concat([header,element('18538067',Buffer.concat([info,track,cluster]))]);
}

async function runMediaChecks({ page, base, qaDir, downloadFile = browserDownload }) {
        fs.mkdirSync(qaDir, { recursive: true });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.goto(base, { waitUntil: 'networkidle' });
        const vp8 = await makeWebm(page, 'vp8'), vp9 = await makeWebm(page, 'vp9');
        fs.writeFileSync(path.join(qaDir, 'qa-vp8.webm'), vp8);
        fs.writeFileSync(path.join(qaDir, 'qa-vp9.webm'), vp9);
        const generateButton = page.getByRole('button', { name: 'Generate', exact: true });
        const upload = page.locator('input[type=file]');
        assert.match(await upload.getAttribute('accept'), /\.webm/);
        await upload.setInputFiles({ name: 'broken.webm', mimeType: 'video/webm', buffer: Buffer.from('not a video') });
        await page.getByText(/WebM video could not be read/).waitFor();
        assert.equal(await generateButton.isDisabled(), true);
        // Dismissing the load error returns to the empty state instead of a loading spinner.
        await page.getByRole('button', { name: 'Dismiss' }).click();
        await page.locator('#drop_zone').waitFor();
        assert.equal(await page.locator('.canvas-loading').count(), 0, 'a failed load is not shown as loading');
        // Empty MIME and uppercase extension exercise drop validation; files can land anywhere in the window.
        await page.evaluate(bytes => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([new Uint8Array(bytes)], 'small.WEBM', { type: '' }));
            document.querySelector('.canvas-stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        }, [...vp8]);
        await page.locator('.crop-preview video').waitFor({ timeout: 45000 }).catch(async error => {
            throw new Error(`${error.message}\nApp error: ${await page.locator('#error_message').textContent()}`);
        });
        assert.equal(await page.locator('.source-name').innerText(), 'small.WEBM');
        const previewVideo = page.locator('.crop-preview video');
        await page.waitForFunction(() => document.querySelector('.crop-preview video').videoWidth > 0);
        assert.deepEqual(await previewVideo.evaluate(v => [v.videoWidth, v.videoHeight]), [180, 320]);
        await page.getByRole('button', { name: 'Pause preview' }).click();
        assert.equal(await previewVideo.evaluate(v => v.paused), true);
        await page.getByRole('button', { name: 'Play preview' }).click();
        await page.waitForFunction(() => !document.querySelector('.crop-preview video').paused);
        await page.getByRole('checkbox', { name: 'Show screen and keys only' }).check();
        const image = await loadImage(await page.locator('.crop-preview').screenshot());
        assert.ok(Math.abs(image.width / image.height - 720 / 1280) < 0.01, `preview keeps 9:16 (${image.width}x${image.height})`);
        const c = createCanvas(image.width, image.height), cx = c.getContext('2d'); cx.drawImage(image, 0, 0);
        const pixel = (x,y) => [...cx.getImageData(Math.floor(x/720*image.width),Math.floor(y/1280*image.height),1,1).data].slice(0,3);
        for (const [x,y] of [[20,600],[240,500],[360,410],[360,640]]) near(pixel(x,y), [0,0,0], 'preview masks gaps');
        assert.ok(pixel(360,200).some(v=>v>200), 'screen remains visible');
        // Cancellation must leave a usable preview and allow a second attempt.
        await generateButton.click();
        const processingState = await page.waitForFunction(() => {
            const progressed = document.querySelector('progress')?.value > 0;
            const error = document.querySelector('#error_message')?.textContent?.trim();
            return progressed || error ? { progressed, error } : false;
        });
        const processing = await processingState.jsonValue();
        assert.ok(processing.progressed, processing.error || 'video processing must advance');
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByText('Processing cancelled. Adjust the settings and try again.').waitFor();
        assert.equal(await generateButton.isEnabled(), true);
        assert.equal(await page.locator('.output-list').count(), 0, 'a cancelled run lists no outputs');
        await page.locator('#webm-fps').selectOption('15');
        const duration = Number((await page.locator('#source-duration').innerText()).match(/([\d.]+) s/)[1]);
        await generate(page);
        const downloaded = await downloadFile(page, () => page.locator('a[download="stream_deck_gifs.zip"]').click());
        const zip = await JSZip.loadAsync(fs.readFileSync(await downloaded.path()));
        const names = Object.values(zip.files).filter(f=>!f.dir).map(f=>f.name).sort();
        assert.deepEqual(names,['stream_deck_corsair_tiles/keys.gif','stream_deck_corsair_tiles/screen.gif']);
        const screen = decode(await zip.file(names[1]).async('uint8array'),720,384);
        const master = decode(await zip.file(names[0]).async('uint8array'),720,1280);
        assert.deepEqual(screen.map(f=>f.delay),master.map(f=>f.delay));
        assert.ok(Math.abs(master.reduce((sum,f)=>sum+f.delay,0)-duration*1000)<=10,'preserve total video duration');
        near(rgb(screen[0],360,100),[255,0,0],'first frame');
        near(rgb(screen.at(-1),360,100),[0,255,0],'last frame');
        near(rgb(master[0],360,100),[255,0,0],'full master contains screen');
        near(rgb(master[0],360,410),[255,0,255],'full master retains gap, without mask');
        near(rgb(master.at(-1),20,1270),[0,0,255],'full master retains bottom/side margin');
        // The 12 key GIFs are only delivered inside the profile, never as a separate download.
        assert.equal(await page.locator('a[download$=".zip"]').count(), 2, 'background ZIP and plugin only');
        const keyGifs = await checkGalleonProfile(page, zip, downloadFile);
        for (let i=0;i<12;i++) {
            const frames = decode(keyGifs[i],160,160);
            assert.deepEqual(frames.map(f=>f.delay),master.map(f=>f.delay));
            near(rgb(frames[0],80,80),[48+i%3*72,48+Math.floor(i/3)*48,32],`key ${i+1} first frame`);
            near(rgb(frames.at(-1),80,80),[48+i%3*72,48+Math.floor(i/3)*48,220],`key ${i+1} last frame`);
        }
        // A rejected drop must keep the loaded source and the unsaved outputs (and their Blob URLs).
        await page.evaluate(() => {
            const transfer = new DataTransfer();
            transfer.items.add(new File(['not media'], 'clip.mp4', { type: 'video/mp4' }));
            document.querySelector('.canvas-stage').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        });
        await page.getByText('Choose a GIF or WebM file.').waitFor();
        assert.equal(await page.locator('.source-name').innerText(), 'small.WEBM');
        assert.equal(await page.locator('.crop-preview video').count(), 1, 'preview survives a rejected drop');
        assert.equal(await page.locator('.status-chip.ok').count(), 1, 'outputs stay current after a rejected drop');
        const zipAgain = await downloadFile(page, () => page.locator('a[download="stream_deck_gifs.zip"]').click());
        assert.deepEqual(fs.readFileSync(await zipAgain.path()), fs.readFileSync(await downloaded.path()), 'output Blob URLs stay valid');
        // Any crop change marks the listed outputs as out of date until the next generation.
        await page.locator('#crop-zoom').fill('1.5');
        await page.locator('.status-chip.warn').waitFor();
        console.log('PASS VP8: small WebM with recorder-style missing duration, dismissible load error, window drop, rejected drop keeps work, animated preview and mask, cancel/retry, full master + screen + all 12 profile key GIFs, timing, pixel coordinates and stale outputs.');

        await page.goto(base,{waitUntil:'networkidle'});
        await upload.setInputFiles({name:'vp9.webm',mimeType:'video/webm',buffer:vp9});
        await page.locator('#webm-fps').waitFor();
        const contain = page.getByRole('button',{name:'Fit (letterbox)'});
        await contain.click();
        assert.equal(await contain.getAttribute('aria-pressed'), 'true');
        await page.locator('#webm-fps').selectOption('10');
        await page.locator('#crop-zoom').fill('2');
        await generate(page);
        const vp9Download = await downloadFile(page, () => page.locator('a[download="stream_deck_gifs.zip"]').click());
        const vp9Zip = await JSZip.loadAsync(fs.readFileSync(await vp9Download.path()));
        // The clip is exactly 9:16, so fit alone cannot change the master; the 200 % zoom proves the
        // UI crop reaches the export. Scale 8, offset (-360,-640): master (360,864) is clip (90,188),
        // the centre of key column 2, row 2, where the default crop would show the blue band.
        const vp9Master = decode(await vp9Zip.file('stream_deck_corsair_tiles/keys.gif').async('uint8array'),720,1280);
        near(rgb(vp9Master[0],360,40),[255,0,0],'VP9 first frame');
        near(rgb(vp9Master.at(-1),360,40),[0,255,0],'VP9 last frame');
        near(rgb(vp9Master[0],360,864),[120,96,32],'VP9 zoom reaches the export (first frame)');
        near(rgb(vp9Master.at(-1),360,864),[120,96,220],'VP9 zoom reaches the export (last frame)');
        console.log('PASS VP9: conversion with declared duration, contain fit, UI zoom applied to the export, 10 fps output.');

        await page.goto(base,{waitUntil:'networkidle'});
        await upload.setInputFiles({name:'vp8.webm',mimeType:'video/webm',buffer:vp8});
        await page.locator('#webm-fps').waitFor();
        await page.setViewportSize({width:960,height:620});
        await page.locator('.studio').screenshot({path:path.join(qaDir, 'qa-webm-min-window.png')});
        const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight);
        assert.ok(await fits(), 'no overflow at the minimum window size');
        await upload.setInputFiles('public/sample/sample_720x1280.gif');
        await page.locator('.crop-preview img').waitFor();
        assert.equal(await page.locator('.crop-preview video').count(),0);
        assert.equal(await page.locator('#webm-fps').count(),0);
        await generate(page);
        const gifDownload = await downloadFile(page, () => page.locator('a[download="stream_deck_gifs.zip"]').click());
        const gifBackgrounds=await JSZip.loadAsync(fs.readFileSync(await gifDownload.path()));
        await checkGalleonProfile(page,gifBackgrounds, downloadFile);
        await page.locator('.export-panel').screenshot({path:path.join(qaDir, 'qa-galleon-outputs-min-window.png')});
        assert.ok(await fits(), 'output list fits the minimum window size');
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.output-name, .output-meta')]
            .filter(element => element.scrollWidth > element.clientWidth).map(element => element.textContent)), [], 'output titles and details are not cut off at the minimum window size');
        assert.deepEqual(errors,[]);
        console.log('PASS: GIF and WebM produce GALLEON profiles with twelve animated keys, native dial navigation on both pages, a free functional page and the plugin installer.');
        console.log('PASS: corrupt input error, switching back to GIF, minimum window layout and no renderer exceptions.');
        return { gifBackgrounds, vp8, vp9 };
}

module.exports = { makeWebm, checkGalleonProfile, generate, runMediaChecks, decode, near, rgb };
