/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } });
    module._compile(outputText, filename);
};
const { getMediaKind, getVideoTimeline, WEBM_FRAME_RATES } = require('../src/lib/media.ts');

test('GIF/WebM recognition supports file pickers and empty MIME types from drag/drop', () => {
    for (const file of [{ name: 'clip.WEBM', type: '' }, { name: 'clip', type: 'video/webm;codecs=vp9' }, { name: 'clip.webm', type: 'application/octet-stream' }]) {
        assert.equal(getMediaKind(file), 'webm');
    }
    assert.equal(getMediaKind({ name: 'image.GIF', type: '' }), 'gif');
    assert.equal(getMediaKind({ name: 'image', type: 'image/gif' }), 'gif');
    for (const name of ['clip.mp4', 'image.png', 'clip.webm.txt']) assert.equal(getMediaKind({ name, type: '' }), null);
});

test('video sampling retains full duration without centisecond rounding drift or zero-delay tails', () => {
    for (const fps of WEBM_FRAME_RATES) {
        for (const duration of [0.001, 0.01, 0.04, 0.07, 0.105, 0.999, 1, 1.234, 15.017, 3600.001]) {
            const timeline = getVideoTimeline(duration, fps);
            let totalDelay = 0, previous = -1;
            for (let i = 0; i < timeline.frameCount; i++) {
                const { time, delay } = timeline.frame(i);
                assert.ok(time >= 0 && time < duration && time > previous, `${fps} fps, ${duration}s, frame ${i}`);
                assert.ok(delay >= 10 && delay % 10 === 0, 'valid GIF delay');
                totalDelay += delay; previous = time;
            }
            assert.equal(totalDelay, Math.max(10, Math.round(duration * 100) * 10));
            assert.equal(timeline.frame(0).time, 0);
        }
    }
});

test('invalid video metadata or unsupported sampling rates are rejected', () => {
    for (const duration of [0, -1, NaN, Infinity]) assert.throws(() => getVideoTimeline(duration, 20));
    for (const fps of [0, -1, NaN, Infinity, 60]) assert.throws(() => getVideoTimeline(1, fps));
});
