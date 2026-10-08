/* eslint-disable @typescript-eslint/no-require-imports */
const { Animation } = require('./player.cjs');
const { HidOutput } = require('./hid-output.cjs');
const { keyActionUUID } = require('../src/lib/screenPlayer.json');

const REGIONS = [
    { left: 0, top: 0, width: 720, height: 384 },
    ...[448, 672, 896, 1120].flatMap(top => [56, 280, 504].map(left => ({ left, top, width: 160, height: 160 }))),
];

async function encodeFrame(pixels) {
    const sharp = require('sharp');
    return Promise.all(REGIONS.map(region => sharp(pixels, { raw: { width: 720, height: 1280, channels: 4 } })
        .extract(region).jpeg({ quality: 85, chromaSubsampling: '4:4:4', progressive: false }).toBuffer()));
}

class SyncPlayer {
    constructor(send, { now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout,
        open = () => HidOutput.open(), encode = encodeFrame } = {}) {
        Object.assign(this, { send, now, schedule, cancel, open, encode });
        this.groups = new Map();
        this.contexts = new Map();
        this.closing = Promise.resolve();
    }
    stop(group) {
        if (group.stopped) return;
        group.stopped = true;
        this.cancel(group.timer);
        for (const context of group.contexts.keys()) this.contexts.delete(context);
        group.contexts.clear();
        this.groups.delete(group.id);
        // Drain the in-flight operation before another profile opens the device.
        this.closing = Promise.allSettled([this.closing, group.running]).then(async () => {
            if (group.output) await group.output.close();
            group.cache.clear();
        }).catch(() => {});
    }
    detach(context) {
        const group = this.contexts.get(context);
        if (!group) return;
        this.contexts.delete(context);
        group.contexts.delete(context);
        if (group.owner === context || !group.contexts.size) this.stop(group);
    }
    failure(group, error) {
        if (group.stopped) return;
        for (const context of group.contexts.keys()) {
            this.send({ event: 'showAlert', context });
            this.send({ event: 'sendToPropertyInspector', context, payload: { error: error.message, code: error.code } });
        }
        this.send({ event: 'logMessage', payload: { message: `GALLEON synchronized player: ${error.message}` } });
        this.stop(group);
    }
    launch(group) {
        if (group.started || !group.animation || group.stopped) return;
        group.started = true;
        // Let willAppear finish delivering all twelve key contexts before drawing.
        group.timer = this.schedule(() => {
            group.running = (async () => {
                await this.closing;
                if (group.stopped) return;
                group.output = await this.open();
                if (group.stopped) return;
                group.nextAt = this.now();
                await this.tick(group);
            })().catch(error => this.failure(group, error));
        }, 200);
    }
    async tick(group) {
        if (group.stopped) return;
        const animation = group.animation;
        if (group.nextAt + animation.duration <= this.now()) {
            group.nextAt += Math.floor((this.now() - group.nextAt) / animation.duration) * animation.duration;
        }
        let count = 0;
        do { group.nextAt += animation.advance(); }
        while (group.nextAt <= this.now() && ++count < animation.frames.length);
        let images = group.cache.get(animation.index);
        if (!images) {
            images = await this.encode(animation.pixels);
            if (group.stopped) return;
            const size = images.reduce((sum, image) => sum + image.length, 0);
            group.cache.set(animation.index, images);
            group.cacheBytes += size;
            while (group.cacheBytes > 32 * 1024 * 1024 && group.cache.size > 1) {
                const key = group.cache.keys().next().value;
                group.cacheBytes -= group.cache.get(key).reduce((sum, image) => sum + image.length, 0);
                group.cache.delete(key);
            }
        }
        if (group.stopped) return;
        const keys = new Set(group.contexts.values());
        await group.output.writeFrame(images, keys, () => !group.stopped);
        if (group.stopped) return;
        // Update only the app preview. Hardware has already received this batch;
        // target 2 prevents the app from starting a second hardware image stream.
        for (const [context, key] of group.contexts) this.send({ event: 'setImage', context,
            payload: { image: `data:image/jpeg;base64,${images[key + 1].toString('base64')}`, target: 2 } });
        group.timer = this.schedule(() => {
            group.running = this.tick(group).catch(error => this.failure(group, error));
        }, Math.max(1, group.nextAt - this.now()));
    }
    handle(message) {
        if (message.event === 'deviceDidDisconnect') {
            for (const group of [...this.groups.values()]) if (group.device === message.device) this.stop(group);
            return;
        }
        if (message.action !== keyActionUUID) return;
        const { context, event, payload = {} } = message;
        if (event === 'willDisappear') return this.detach(context);
        if (event === 'sendToPlugin' && payload.command === 'resync') {
            const group = this.contexts.get(context);
            if (group) this.restart(group);
            return;
        }
        if (event !== 'willAppear' && event !== 'didReceiveSettings') return;
        if (event === 'didReceiveSettings' && !this.contexts.has(context)) return;
        const settings = payload.settings || {};
        const key = settings.key;
        if (payload.controller !== 'Keypad' || !Number.isInteger(key) || key < 0 || key >= 12 || typeof settings.animationId !== 'string') return;
        const id = `${message.device}:${settings.animationId}`;
        const existing = this.contexts.get(context);
        if (existing?.id === id) {
            existing.contexts.set(context, key);
            if (settings.masterGif && settings.masterGif !== existing.masterGif) {
                existing.masterGif = settings.masterGif;
                this.restart(existing);
            }
            return;
        }
        this.detach(context);
        let group = this.groups.get(id);
        if (!group) {
            // Only one GALLEON may be painted per plugin instance at a time.
            for (const old of [...this.groups.values()]) if (old.device === message.device) this.stop(old);
            group = { id, device: message.device, contexts: new Map(), cache: new Map(), cacheBytes: 0,
                started: false, stopped: false, running: Promise.resolve(), timer: null, owner: null };
            this.groups.set(id, group);
        }
        this.contexts.set(context, group);
        group.contexts.set(context, key);
        if (settings.masterGif) {
            try {
                group.animation = new Animation(settings.masterGif, { width: 720, height: 1280 });
                group.masterGif = settings.masterGif;
                group.owner = context;
            } catch (error) { this.failure(group, Object.assign(error, { code: 'invalid-animation' })); return; }
        }
        this.launch(group);
    }
    restart(group) {
        // A new generation prevents late encodes/writes from the previous run.
        const saved = [...group.contexts.entries()];
        const { device, masterGif, owner } = group;
        const animationId = group.id.slice(device.length + 1);
        this.stop(group);
        for (const [context, key] of saved) this.handle({ event: 'willAppear', action: keyActionUUID,
            device, context, payload: { controller: 'Keypad', settings: { animationId, key, ...(context === owner ? { masterGif } : {}) } } });
    }
    async close() {
        for (const group of [...this.groups.values()]) this.stop(group);
        await this.closing;
    }
}

module.exports = { SyncPlayer, encodeFrame, REGIONS };
