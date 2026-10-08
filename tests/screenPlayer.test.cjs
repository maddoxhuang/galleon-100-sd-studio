/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: wait } = require('node:timers/promises');
const { createCanvas } = require('@napi-rs/canvas');
const GIFEncoder = require('gif-encoder-2');
const { PNG } = require('pngjs');
const { WebSocketServer } = require('ws');
const { Animation, ScreenPlayer } = require('../streamdeck-plugin/player.cjs');
const config = require('../src/lib/screenPlayer.json');

const colors = [
    [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]],
    [[0, 255, 255], [255, 0, 255], [255, 255, 255], [128, 128, 128]],
];
function gif() {
    const canvas = createCanvas(720, 384);
    const ctx = canvas.getContext('2d');
    const encoder = new GIFEncoder(720, 384);
    encoder.start(); encoder.setRepeat(0);
    for (let frame = 0; frame < 2; frame++) {
        colors[frame].forEach((color, quadrant) => {
            ctx.fillStyle = `rgb(${color.join(',')})`;
            ctx.fillRect(quadrant % 2 * 360, Math.floor(quadrant / 2) * 192, 360, 192);
        });
        encoder.setDelay(frame === 0 ? 120 : 230);
        encoder.addFrame(ctx.getImageData(0, 0, 720, 384).data);
    }
    encoder.finish();
    return encoder.out.getData().toString('base64');
}
function pixel(image) {
    assert.match(image, /^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(image.split(',')[1], 'base64').toString();
    assert.match(svg, /width="200" height="100"/);
    assert.match(svg, /viewBox="0 0 360 192" preserveAspectRatio="none"/);
    const png = PNG.sync.read(Buffer.from(svg.match(/data:image\/png;base64,([^"]+)/)[1], 'base64'));
    assert.deepEqual([png.width, png.height], [360, 192]);
    const middle = (96 * 360 + 180) * 4;
    return [...png.data.subarray(middle, middle + 3)];
}
function near(actual, expected) {
    assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) < 8), `${actual} vs ${expected}`);
}
function appear(context, quadrant, screenGif, device = 'galleon') {
    return { event: 'willAppear', action: config.actionUUID, context, device,
        payload: { controller: 'Encoder', settings: { screenGif, column: quadrant % 2, row: Math.floor(quadrant / 2) } } };
}
function clock() {
    let time = 0, id = 0;
    const jobs = new Map();
    return {
        now: () => time,
        schedule: (fn, delay) => { jobs.set(++id, { fn, at: time + delay }); return id; },
        cancel: id => jobs.delete(id),
        jobs,
        resumeAfter: delta => {
            time += delta;
            const next = [...jobs.entries()].sort((a, b) => a[1].at - b[1].at)[0];
            if (next && next[1].at <= time) { jobs.delete(next[0]); next[1].fn(); }
        },
        advance: delta => {
            const target = time + delta;
            for (;;) {
                const next = [...jobs.entries()].sort((a, b) => a[1].at - b[1].at)[0];
                if (!next || next[1].at > target) break;
                jobs.delete(next[0]); time = next[1].at; next[1].fn();
            }
            time = target;
        },
    };
}

test('screen decoder preserves four physical quadrants, frame timing and repeat', () => {
    const animation = new Animation(gif());
    for (let index = 0; index < 4; index++) {
        assert.equal(animation.advance(), index % 2 === 0 ? 120 : 230);
        animation.images().forEach((image, quadrant) => near(pixel(image), colors[index % 2][quadrant]));
    }
    assert.throws(() => new Animation(''), /Re-export/);
    assert.throws(() => new Animation(Buffer.from('not a GIF').toString('base64')), /Invalid screen GIF/);
});

test('four screen actions share one timer and frame; disappearance, settings, reconnect release and reload correctly', () => {
    const timer = clock(), messages = [], screenGif = gif();
    const player = new ScreenPlayer(message => messages.push(message), timer);
    for (let q = 0; q < 4; q++) player.handle(appear(`q${q}`, q, screenGif));
    assert.equal(player.groups.size, 1);
    assert.equal(timer.jobs.size, 1);
    let feedback = messages.filter(m => m.event === 'setFeedback');
    assert.equal(feedback.length, 4);
    feedback.forEach((m, q) => near(pixel(m.payload.canvas), colors[0][q]));
    timer.advance(119);
    assert.equal(messages.filter(m => m.event === 'setFeedback').length, 4);
    timer.advance(1);
    feedback = messages.filter(m => m.event === 'setFeedback').slice(-4);
    feedback.forEach((m, q) => near(pixel(m.payload.canvas), colors[1][q]));
    timer.advance(230);
    messages.filter(m => m.event === 'setFeedback').slice(-4).forEach((m, q) => near(pixel(m.payload.canvas), colors[0][q]));
    const hidden = { ...appear('hidden', 0, screenGif), event: 'didReceiveSettings' };
    player.handle(hidden);
    assert.equal(player.contexts.has('hidden'), false);
    const update = { ...appear('q0', 3, screenGif), event: 'didReceiveSettings' };
    player.handle(update);
    assert.equal(timer.jobs.size, 1);
    near(pixel(messages.at(-1).payload.canvas), colors[0][3]);
    for (let q = 0; q < 4; q++) player.handle({ ...appear(`q${q}`, q, screenGif), event: 'willDisappear' });
    assert.equal(timer.jobs.size, 0);
    assert.equal(player.groups.size, 0);
    const count = messages.length;
    timer.advance(1000);
    assert.equal(messages.length, count);
    player.handle(appear('return', 0, screenGif));
    near(pixel(messages.at(-1).payload.canvas), colors[0][0]);
    player.handle(appear('other-device', 0, screenGif, 'second'));
    assert.equal(player.groups.size, 2);
    player.handle({ event: 'deviceDidDisconnect', device: 'galleon' });
    assert.deepEqual([...player.contexts.keys()], ['other-device']);
    player.close();
    assert.equal(player.groups.size, 0);
    assert.equal(timer.jobs.size, 0);
});

test('backpressure drops frames without duplicate timers and invalid settings do not poison other actions', () => {
    const timer = clock(), messages = [], screenGif = gif();
    let ready = false;
    const player = new ScreenPlayer(m => messages.push(m), { ...timer, ready: () => ready });
    for (let q = 0; q < 4; q++) player.handle(appear(`q${q}`, q, screenGif));
    assert.equal(timer.jobs.size, 1);
    assert.equal(messages.filter(m => m.event === 'setFeedback').length, 0);
    timer.advance(120);
    ready = true;
    timer.advance(230);
    assert.equal(messages.filter(m => m.event === 'setFeedback').length, 4);
    player.handle({ ...appear('bad', 0, ''), payload: { controller: 'Encoder', settings: { column: 0, row: 0 } } });
    assert.ok(messages.some(m => m.event === 'showAlert' && m.context === 'bad'));
    assert.equal(player.contexts.size, 4);
    assert.equal(timer.jobs.size, 1);
    player.close();
});

test('resuming after sleep skips expired loops and sends only the current frame', () => {
    const timer = clock(), messages = [];
    const player = new ScreenPlayer(m => messages.push(m), timer);
    player.handle(appear('q0', 0, gif()));
    timer.resumeAfter(350 * 10000 + 120);
    const frames = messages.filter(m => m.event === 'setFeedback');
    assert.equal(frames.length, 2);
    near(pixel(frames[1].payload.canvas), colors[1][0]);
    assert.equal(timer.jobs.size, 1);
    assert.equal([...timer.jobs.values()][0].at - timer.now(), 230);
    player.close();
});

test('packaged Node plugin registers over a real local WebSocket, animates, and exits when disconnected', { timeout: 15000 }, async () => {
    const pluginPath = path.resolve('build', `${config.pluginUUID}.sdPlugin`, 'bin/plugin.js');
    assert.ok(fs.existsSync(pluginPath), 'run npm run plugin:build first');
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const connection = once(server, 'connection');
    const child = spawn(process.execPath, [pluginPath, '-port', String(server.address().port), '-pluginUUID', 'test-registration', '-registerEvent', 'registerPlugin', '-info', '{}'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const exit = once(child, 'exit');
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    try {
        const [socket] = await connection;
        const messages = [];
        socket.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
        const deadline = Date.now() + 5000;
        while (!messages.some(m => m.event === 'registerPlugin') && Date.now() < deadline) await wait(10);
        assert.deepEqual(messages[0], { event: 'registerPlugin', uuid: 'test-registration' });
        const screenGif = gif();
        for (let q = 0; q < 4; q++) socket.send(JSON.stringify(appear(`q${q}`, q, screenGif)));
        while (messages.filter(m => m.event === 'setFeedback').length < 12 && Date.now() < deadline) await wait(20);
        for (let q = 0; q < 4; q++) {
            const frames = messages.filter(m => m.event === 'setFeedback' && m.context === `q${q}`);
            assert.ok(frames.length >= 3, `three frames received for q${q}; ${stderr}`);
            frames.slice(0, 3).forEach((frame, i) => near(pixel(frame.payload.canvas), colors[i % 2][q]));
        }
        assert.equal(messages.some(m => m.event === 'showAlert'), false);
        socket.close();
        const [code] = await exit;
        assert.equal(code, 0, stderr);
    } finally {
        child.kill();
        for (const socket of server.clients) socket.terminate();
        await new Promise(resolve => server.close(resolve));
    }
});
