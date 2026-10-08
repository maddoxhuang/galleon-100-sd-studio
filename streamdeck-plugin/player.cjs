/* eslint-disable @typescript-eslint/no-require-imports */
const { parseGIF, decompressFrame } = require('gifuct-js');
const { PNG } = require('pngjs');
const { createHash } = require('node:crypto');
const { actionUUID } = require('../src/lib/screenPlayer.json');

const WIDTH = 720, HEIGHT = 384, HALF_WIDTH = 360, HALF_HEIGHT = 192;

// Decode one frame at a time: memory does not grow by 720*384*4 per frame.
class Animation {
    constructor(base64, { width = WIDTH, height = HEIGHT } = {}) {
        if (typeof base64 !== 'string' || !base64.length) throw new Error('Re-export and import an SD100 animation profile.');
        const bytes = Buffer.from(base64, 'base64');
        if (!/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) throw new Error('Invalid screen GIF.');
        this.gif = parseGIF(bytes);
        if (this.gif.lsd.width !== width || this.gif.lsd.height !== height) throw new Error(`GIF must be ${width} x ${height}.`);
        this.width = width;
        this.height = height;
        this.frames = this.gif.frames.filter(frame => frame.image);
        if (!this.frames.length) throw new Error('Screen GIF has no frames.');
        this.duration = this.frames.reduce((sum, frame) => sum + Math.max(10, (frame.gce?.delay || 10) * 10), 0);
        for (const frame of this.frames) {
            const d = frame.image.descriptor;
            if (!d.width || !d.height || d.left + d.width > width || d.top + d.height > height) throw new Error('Invalid GIF frame bounds.');
        }
        this.pixels = Buffer.alloc(width * height * 4);
        this.clear(0, 0, width, height);
        this.index = -1;
        this.previous = null;
        this.restore = null;
    }
    clear(x, y, width, height) {
        for (let row = y; row < y + height; row++) {
            for (let col = x; col < x + width; col++) {
                const offset = (row * this.width + col) * 4;
                this.pixels.fill(0, offset, offset + 3);
                this.pixels[offset + 3] = 255;
            }
        }
    }
    advance() {
        const next = (this.index + 1) % this.frames.length;
        if (next === 0) {
            this.clear(0, 0, this.width, this.height);
        } else if (this.previous?.disposalType === 2) {
            const d = this.previous.dims;
            this.clear(d.left, d.top, d.width, d.height);
        } else if (this.previous?.disposalType === 3 && this.restore) {
            this.restore.copy(this.pixels);
        }
        const frame = decompressFrame(this.frames[next], this.gif.gct, true);
        this.restore = frame.disposalType === 3 ? Buffer.from(this.pixels) : null;
        const d = frame.dims;
        for (let y = 0; y < d.height; y++) {
            for (let x = 0; x < d.width; x++) {
                const from = (y * d.width + x) * 4;
                if (!frame.patch[from + 3]) continue;
                const to = ((d.top + y) * this.width + d.left + x) * 4;
                this.pixels.set(frame.patch.subarray(from, from + 4), to);
            }
        }
        this.index = next;
        this.previous = { dims: d, disposalType: frame.disposalType };
        return Math.max(10, frame.delay || 100);
    }
    images() {
        const result = [];
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 2; col++) {
                const data = Buffer.alloc(HALF_WIDTH * HALF_HEIGHT * 4);
                for (let y = 0; y < HALF_HEIGHT; y++) {
                    const start = ((row * HALF_HEIGHT + y) * WIDTH + col * HALF_WIDTH) * 4;
                    this.pixels.copy(data, y * HALF_WIDTH * 4, start, start + HALF_WIDTH * 4);
                }
                const png = PNG.sync.write({ width: HALF_WIDTH, height: HALF_HEIGHT, data }, { colorType: 2, deflateLevel: 1 });
                // Fit the physical 360x192 quadrant to the SDK's 200x100 logical
                // canvas without letterboxing. Keep the original bitmap pixels.
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="100" viewBox="0 0 360 192" preserveAspectRatio="none"><image width="360" height="192" xlink:href="data:image/png;base64,${png.toString('base64')}"/></svg>`;
                result.push(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
            }
        }
        return result;
    }
}

class ScreenPlayer {
    constructor(send, { now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout, ready = () => true } = {}) {
        this.send = send;
        this.now = now;
        this.schedule = schedule;
        this.cancel = cancel;
        this.ready = ready;
        this.groups = new Map();
        this.contexts = new Map();
    }
    detach(context) {
        const key = this.contexts.get(context);
        this.contexts.delete(context);
        const group = this.groups.get(key);
        if (!group) return;
        group.contexts.delete(context);
        if (!group.contexts.size) {
            this.cancel(group.timer);
            this.groups.delete(key);
        }
    }
    display(group) {
        if (!this.ready()) return; // Drop stale frames when the socket is backed up.
        group.images = group.animation.images();
        for (const [context, quadrant] of group.contexts) {
            this.send({ event: 'setFeedback', context, payload: { canvas: group.images[quadrant] } });
        }
    }
    tick(key) {
        const group = this.groups.get(key);
        if (!group) return;
        try {
            // Keep all four regions on a single timeline, including after slow sends.
            // Skip whole expired cycles after sleep instead of bursting stale frames.
            if (group.started && group.nextAt + group.animation.duration <= this.now()) {
                group.nextAt += Math.floor((this.now() - group.nextAt) / group.animation.duration) * group.animation.duration;
            }
            let count = 0;
            do {
                group.nextAt += group.animation.advance();
            } while (group.nextAt <= this.now() && ++count < group.animation.frames.length);
            this.display(group);
            if (group.animation.frames.length > 1 || !group.images) {
                group.timer = this.schedule(() => this.tick(key), Math.max(1, group.nextAt - this.now()));
            }
        } catch (error) {
            for (const context of [...group.contexts.keys()]) {
                this.detach(context);
                this.send({ event: 'showAlert', context });
            }
            this.send({ event: 'logMessage', payload: { message: `GALLEON Screen Player: ${error.message}` } });
        }
    }
    handle(message) {
        if (message.event === 'deviceDidDisconnect') {
            for (const group of [...this.groups.values()]) {
                if (group.device === message.device) for (const context of [...group.contexts.keys()]) this.detach(context);
            }
            return;
        }
        if (message.action !== actionUUID) return;
        const { context, event, payload = {} } = message;
        if (event === 'willDisappear') return this.detach(context);
        if (event !== 'willAppear' && event !== 'didReceiveSettings') return;
        // Settings events for hidden actions must not start a background player.
        if (event === 'didReceiveSettings' && !this.contexts.has(context)) return;
        this.detach(context);
        try {
            const { screenGif, column, row } = payload.settings || {};
            if (payload.controller !== 'Encoder' || ![0, 1].includes(column) || ![0, 1].includes(row)) throw new Error('Import the four screen regions from an SD100 profile.');
            if (typeof screenGif !== 'string' || !screenGif.length) throw new Error('Re-export and import an SD100 animation profile.');
            const key = `${message.device}:${createHash('sha256').update(screenGif).digest('hex')}`;
            let group = this.groups.get(key);
            if (!group) {
                group = { animation: new Animation(screenGif), device: message.device, contexts: new Map(), nextAt: this.now(), images: null, timer: null, started: false };
                this.groups.set(key, group);
            }
            this.contexts.set(context, key);
            group.contexts.set(context, row * 2 + column);
            this.send({ event: 'setFeedbackLayout', context, payload: { layout: 'screen-layout.json' } });
            if (group.images) {
                this.send({ event: 'setFeedback', context, payload: { canvas: group.images[row * 2 + column] } });
            } else if (!group.started) {
                group.started = true;
                this.tick(key);
            }
        } catch (error) {
            this.detach(context);
            this.send({ event: 'showAlert', context });
            this.send({ event: 'logMessage', payload: { message: `GALLEON Screen Player: ${error.message}` } });
        }
    }
    close() {
        for (const context of [...this.contexts.keys()]) this.detach(context);
    }
}

module.exports = { Animation, ScreenPlayer };
