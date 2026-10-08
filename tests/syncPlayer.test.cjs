/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const GIFEncoder = require('gif-encoder-2');
const sharp = require('sharp');
const { SyncPlayer, encodeFrame, REGIONS } = require('../streamdeck-plugin/sync-player.cjs');
const { HidOutput, imageReports } = require('../streamdeck-plugin/hid-output.cjs');
const { keyActionUUID } = require('../src/lib/screenPlayer.json');

function fixture() {
    const encoder = new GIFEncoder(720, 1280);
    encoder.start(); encoder.setRepeat(0);
    for (const [red, delay] of [[220, 120], [30, 230]]) {
        const data = Buffer.alloc(720 * 1280 * 4);
        for (let offset = 0; offset < data.length; offset += 4) data.set([red, 60, 100, 255], offset);
        encoder.setDelay(delay); encoder.addFrame(data);
    }
    encoder.finish();
    return encoder.out.getData().toString('base64');
}
const masterGif = fixture();
const appear = (key, overrides = {}) => ({ event: 'willAppear', action: keyActionUUID, device: 'galleon',
    context: `key-${key}`, payload: { controller: 'Keypad', settings: { animationId: 'master', key,
        ...(key === 0 ? { masterGif } : {}), ...overrides } } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness(options = {}) {
    let time = 0, next = 0, opens = 0, closes = 0, encodes = 0;
    const jobs = new Map(), frames = [], messages = [];
    const output = { writeFrame: async (images, keys, current) => {
        assert.ok(current()); frames.push({ at: time, images, keys: [...keys] });
    }, close: async () => { closes++; } };
    const player = new SyncPlayer(message => messages.push(message), {
        now: () => time,
        schedule: (fn, delay) => { jobs.set(++next, { fn, at: time + delay }); return next; },
        cancel: id => jobs.delete(id),
        open: async () => { opens++; return output; },
        encode: async pixels => { encodes++; return REGIONS.map((_, i) => Buffer.from([pixels[0], i])); },
        ...options,
    });
    return { player, frames, messages, jobs, output, setTime: t => { time = t; },
        stats: () => ({ opens, closes, encodes }),
        async run(at) {
            const entry = [...jobs.entries()].sort((a, b) => a[1].at - b[1].at)[0];
            assert.ok(entry, 'scheduled frame exists');
            jobs.delete(entry[0]); time = at ?? entry[1].at; entry[1].fn();
            await flush();
        },
    };
}

test('one 720x384 JPEG covers quadrant boundaries; twelve key JPEGs use exact master coordinates', async () => {
    const pixels = Buffer.alloc(720 * 1280 * 4);
    for (let y = 0; y < 1280; y++) for (let x = 0; x < 720; x++) {
        pixels.set([Math.floor(x / 4), Math.floor(y / 6), 110, 255], (y * 720 + x) * 4);
    }
    const images = await encodeFrame(pixels);
    assert.equal(images.length, 13);
    for (const [i, image] of images.entries()) {
        const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
        const region = REGIONS[i];
        assert.deepEqual([info.width, info.height], [region.width, region.height]);
        const points = i === 0 ? [[359,191],[360,191],[359,192],[360,192],[710,374]] : [[8,8],[80,80],[151,151]];
        for (const [x,y] of points) {
            const actual = data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3);
            const expected = pixels.subarray(((y + region.top) * 720 + x + region.left) * 4, ((y + region.top) * 720 + x + region.left) * 4 + 3);
            assert.ok([...actual].every((v,c) => Math.abs(v - expected[c]) <= 5), `region ${i} pixel ${x},${y}`);
        }
    }
});

test('HID reports reconstruct complete screen/key JPEGs using image commands only', async () => {
    const jpeg = Buffer.alloc(2531, 97); jpeg.set([255,216]); jpeg.set([255,217], jpeg.length - 2);
    for (const key of [null,0,11]) {
        const reports = [...imageReports(jpeg, key)], parts = [];
        reports.forEach((report, i) => {
            assert.equal(report.length, 1024); assert.equal(report[0], 2);
            assert.equal(report[1], key === null ? 12 : 7);
            if (key === null) {
                assert.deepEqual([report.readUInt16LE(2),report.readUInt16LE(4),report.readUInt16LE(6),report.readUInt16LE(8)], [0,0,720,384]);
                assert.equal(report[10], +(i === reports.length - 1)); assert.equal(report.readUInt16LE(11), i);
                parts.push(report.subarray(16,16 + report.readUInt16LE(13)));
            } else {
                assert.equal(report[2], key); assert.equal(report[3], +(i === reports.length - 1));
                assert.equal(report.readUInt16LE(6), i);
                parts.push(report.subarray(8,8 + report.readUInt16LE(4)));
            }
        });
        assert.deepEqual(Buffer.concat(parts), jpeg);
    }
    let active = true;
    const writes = [];
    const output = new HidOutput({ write: async bytes => { writes.push(bytes); if (writes.length === 4) active = false; return bytes.length; } });
    await output.writeFrame(Array(13).fill(jpeg), new Set([11,0]), () => active);
    assert.deepEqual(writes.map(bytes => [bytes[1],bytes[2]]), [[12,0],[12,0],[12,0],[7,0]]);
    await assert.rejects(new HidOutput({ write: async () => 0 }).writeFrame([jpeg], new Set(), () => true), { code: 'transfer-incomplete', message: /transfer was incomplete/ });
    assert.throws(() => [...imageReports(jpeg,12)], /Invalid key/);
});

test('all surfaces share frame indices/delays; late master, long sleep and repeated loops retain one clock', async () => {
    const h = harness();
    for (let key = 11; key >= 1; key--) h.player.handle(appear(key));
    assert.equal(h.jobs.size, 0);
    h.player.handle(appear(0));
    await h.run(); await h.run(); await h.run();
    assert.deepEqual(h.frames.map(frame => frame.at), [200,320,550]);
    assert.deepEqual(h.frames.map(frame => frame.images[0][0]), [220,30,220]);
    assert.equal(h.stats().encodes, 2, 'decoded JPEGs reused on later loops');
    await h.run(7200 + 150); // 20 cycles plus 150 ms after playback start: second frame.
    assert.equal(h.frames.at(-1).images[0][0], 30);
    assert.equal([...h.jobs.values()][0].at, 7550);
    for (const frame of h.frames) {
        assert.equal(frame.keys.length,12);
        assert.ok(frame.images.every(image => image[0] === frame.images[0][0]));
    }
    assert.ok(h.messages.filter(m => m.event === 'setImage').every(m => m.payload.target === 2));
    h.player.handle({ event: 'deviceDidDisconnect', device: 'galleon' });
    await h.player.close();
    assert.equal(h.jobs.size,0); assert.equal(h.stats().closes,1);
});

test('resync/settings retain every active key and restart from frame zero; removed keys stop receiving frames', async () => {
    const h = harness();
    for (let key = 0; key < 12; key++) h.player.handle(appear(key));
    await h.run(); await h.run();
    h.player.handle({ ...appear(0), event: 'didReceiveSettings' });
    assert.equal(h.player.contexts.size,12); assert.equal(h.jobs.size,1);
    h.player.handle({ event: 'willDisappear', action: keyActionUUID, context: 'key-5' });
    h.player.handle({ event: 'sendToPlugin', action: keyActionUUID, context: 'key-3', payload: { command: 'resync' } });
    await h.run();
    assert.equal(h.frames.at(-1).images[0][0],220);
    assert.equal(h.frames.at(-1).keys.length,11); assert.ok(!h.frames.at(-1).keys.includes(5));
    h.player.handle({ event: 'willDisappear', action: keyActionUUID, context: 'key-0' });
    await h.player.close();
    assert.equal(h.player.contexts.size,0); assert.equal(h.stats().closes,2);
    h.player.handle({ ...appear(0), event: 'didReceiveSettings' });
    assert.equal(h.jobs.size,0, 'hidden settings do not reopen hardware');
});

test('a slow encode cannot overlap frame writes or revive a hidden profile', async () => {
    const pending = deferred(); let writes = 0, closed = 0;
    const h = harness({ encode: () => pending.promise, open: async () => ({
        writeFrame: async () => { writes++; }, close: async () => { closed++; },
    }) });
    h.player.handle(appear(0)); await h.run();
    assert.equal(h.jobs.size,0, 'no timer is queued while encoding');
    h.player.handle({ event: 'willDisappear', action: keyActionUUID, context: 'key-0' });
    pending.resolve(Array(13).fill(Buffer.from([1])));
    await h.player.close();
    assert.equal(writes,0); assert.equal(closed,1); assert.equal(h.jobs.size,0);
});

test('restart drains in-flight USB writes before reopening; delayed transmission does not add drift', async () => {
    const pending = deferred(); let opening = 0, writing = 0, closing = 0;
    const h = harness({ open: async () => {
        opening++;
        if (opening === 2) assert.equal(closing,1);
        return { writeFrame: async () => { writing++; if (writing === 1) await pending.promise; }, close: async () => { closing++; } };
    } });
    h.player.handle(appear(0)); await h.run();
    assert.equal(h.jobs.size,0);
    h.player.handle({ event: 'sendToPlugin', action: keyActionUUID, context: 'key-0', payload: { command:'resync' } });
    await h.run(); assert.equal(opening,1);
    pending.resolve(); await flush(); await flush();
    assert.equal(opening,2); assert.equal(writing,2);
    await h.run(1000); // Epoch 400; at +600 ms frame 1 is current (120/230).
    assert.equal(h.player.contexts.get('key-0').animation.index,1);
    assert.equal([...h.jobs.values()][0].at,1100);
    await h.player.close(); assert.equal(closing,2);
});

test('opening failures alert the affected actions and leave no timer or group running', async () => {
    const h = harness({ open: async () => { throw new Error('USB unavailable'); } });
    h.player.handle(appear(0)); h.player.handle(appear(1)); await h.run();
    await h.player.close();
    assert.equal(h.messages.filter(m => m.event === 'showAlert').length,2);
    assert.equal(h.player.groups.size,0); assert.equal(h.jobs.size,0);
});

test('device and profile failures reach every property inspector with a stable code', async () => {
    const hid = devices => ({ devicesAsync: async () => devices, HIDAsync: { open: async device => ({ path: device }) } });
    await assert.rejects(HidOutput.open(hid([{ interface: 1, path: 'input' }])), { code: 'display-not-found' });
    await assert.rejects(HidOutput.open(hid([{ interface: 0, path: 'a' }, { interface: 0, path: 'b' }])), { code: 'multiple-devices' });
    assert.equal((await HidOutput.open(hid([{ interface: 1, path: 'input' }, { interface: 0, path: 'display' }]))).device.path, 'display');
    const h = harness({ open: () => HidOutput.open(hid([])) });
    h.player.handle(appear(0)); h.player.handle(appear(1)); await h.run();
    const reports = h.messages.filter(m => m.event === 'sendToPropertyInspector');
    assert.deepEqual(reports.map(m => [m.context, m.payload.code]), [['key-0','display-not-found'],['key-1','display-not-found']]);
    assert.match(reports[0].payload.error, /^GALLEON display interface not found/);
    const broken = harness();
    broken.player.handle(appear(0, { masterGif: Buffer.from('not a GIF').toString('base64') }));
    assert.deepEqual(broken.messages.find(m => m.event === 'sendToPropertyInspector').payload, { error: 'Invalid screen GIF.', code: 'invalid-animation' });
    await h.player.close(); await broken.player.close();
});

test('property inspector starts in English, follows the Stream Deck language and localizes coded errors', () => {
    const html = fs.readFileSync(path.join(__dirname, '../streamdeck-plugin/inspector.html'), 'utf8');
    function inspector(language) {
        const nodes = [...html.matchAll(/<(?:h3|p|button) ([^>]*)>/g)].map(([, attributes]) => ({ textContent: '', disabled: true,
            id: attributes.match(/id="([\w-]+)"/)?.[1], dataset: { text: attributes.match(/data-text="([\w-]+)"/)?.[1] } }));
        const sockets = [];
        const context = vm.createContext({
            document: { documentElement: { lang: 'en' }, getElementById: id => nodes.find(node => node.id === id),
                querySelectorAll: () => nodes.filter(node => node.dataset.text) },
            WebSocket: class { constructor() { this.sent = []; sockets.push(this); } send(data) { this.sent.push(JSON.parse(data)); } },
        });
        vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], context);
        const pi = { context, sockets, lang: () => context.document.documentElement.lang,
            text: key => nodes.find(node => node.dataset.text === key).textContent,
            status: () => nodes.find(node => node.id === 'status').textContent,
            error: (code, error) => sockets[0].onmessage({ data: JSON.stringify({ event: 'sendToPropertyInspector', payload: { error, code } }) }),
            resync: () => nodes.find(node => node.id === 'resync').onclick() };
        // Text renders before Stream Deck connects and reports its language.
        assert.equal(pi.lang(), 'en');
        assert.equal(pi.text('resync'), 'Restart synced playback');
        assert.ok(nodes.filter(node => node.dataset.text).every(node => node.textContent.length));
        context.connectElgatoStreamDeckSocket(28196, 'pi', 'registerPropertyInspector',
            JSON.stringify({ application: { language } }), JSON.stringify({ context: 'key-0', action: keyActionUUID }));
        sockets[0].onopen();
        assert.deepEqual(sockets[0].sent, [{ event: 'registerPropertyInspector', uuid: 'pi' }]);
        assert.equal(nodes.find(node => node.id === 'resync').disabled, false);
        return pi;
    }
    const zh = inspector('zh_CN');
    assert.equal(zh.lang(), 'zh-CN');
    assert.equal(zh.text('resync'), '从头重新同步播放');
    zh.error('transfer-incomplete', 'GALLEON image transfer was incomplete. Reconnect the device.');
    assert.equal(zh.status(), 'GALLEON 图像传输不完整，请重新连接设备。');
    zh.error('EIO', 'USB unavailable');
    assert.equal(zh.status(), 'USB unavailable', 'unknown codes fall back to the plugin message');
    zh.resync();
    assert.equal(zh.status(), '已请求全部区域从头播放。');
    assert.deepEqual(zh.sockets[0].sent.at(-1), { event: 'sendToPlugin', action: keyActionUUID, context: 'key-0', payload: { command: 'resync' } });
    assert.equal(inspector('zh_TW').lang(), 'zh-CN');
    const en = inspector('en');
    assert.equal(en.lang(), 'en');
    en.error('display-not-found', 'GALLEON display interface not found. Check the USB connection.');
    assert.equal(en.status(), 'GALLEON display not found. Check the USB connection.');
    en.resync();
    assert.equal(en.status(), 'Requested all surfaces to restart from the beginning.');
    const text = vm.runInContext('TEXT', en.context);
    const codes = ['display-not-found', 'invalid-animation', 'multiple-devices', 'transfer-incomplete'];
    for (const language of ['en', 'zh']) assert.deepEqual(Object.keys(text[language].errors).sort(), codes);
    assert.deepEqual(Object.keys(text.zh).sort(), Object.keys(text.en).sort());
});

test('native dial navigation leaves all animation keys available; functional page stays idle and returning restarts together', async () => {
    const h = harness();
    const dial = { event: 'willAppear', action: 'com.elgato.streamdeck.keys.adaptor', device: 'galleon', context: 'dial', payload: { controller: 'Encoder' } };
    h.player.handle(dial);
    for (let key = 0; key < 12; key++) h.player.handle(appear(key));
    await h.run(); await h.run();
    assert.equal(h.frames.at(-1).keys.length,12);
    // Stream Deck processes the native next-page action and hides the old page.
    for (let key = 11; key >= 0; key--) h.player.handle({ ...appear(key), event:'willDisappear' });
    await h.player.closing;
    h.player.handle(dial);
    assert.equal(h.jobs.size,0);
    assert.equal(h.player.groups.size,0);
    assert.equal(h.stats().closes,1);
    const count = h.frames.length;
    h.setTime(5000);
    assert.equal(h.frames.length,count, 'no animation overwrites the functional page');
    for (let key = 0; key < 12; key++) h.player.handle(appear(key));
    await h.run();
    assert.equal(h.frames.at(-1).images[0][0],220);
    assert.equal(h.frames.at(-1).keys.length,12);
    await h.player.close();
});
