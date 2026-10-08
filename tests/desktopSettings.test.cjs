/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSettings, writeSettings } = require('../desktop/settings.cjs');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sd100-settings-'));
const failure = code => Object.assign(new Error(code), { code });
// Real file system, with rename failing a given number of times first.
function lockedRename(failures, code = 'EPERM') {
    let calls = 0;
    return {
        calls: () => calls,
        fs: { ...fs.promises, rename: async (...args) => (++calls <= failures ? Promise.reject(failure(code)) : fs.promises.rename(...args)) },
    };
}

test('settings round-trip through a new directory, leaving no temporary file', async () => {
    const file = path.join(tempDir(), 'nested', 'settings.json');
    await writeSettings(file, { language: 'zh' });
    assert.deepEqual(await readSettings(file), { language: 'zh' });
    await writeSettings(file, { language: 'en' });
    assert.deepEqual(await readSettings(file), { language: 'en' });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('missing, damaged or non-object settings read as empty', async () => {
    const dir = tempDir();
    assert.deepEqual(await readSettings(path.join(dir, 'missing.json')), {});
    for (const contents of ['{ not json', 'null', '[]', '"en"', '']) {
        fs.writeFileSync(path.join(dir, 'settings.json'), contents);
        assert.deepEqual(await readSettings(path.join(dir, 'settings.json')), {}, contents);
    }
});

test('a briefly locked settings file is replaced after retrying', async () => {
    const file = path.join(tempDir(), 'settings.json');
    fs.writeFileSync(file, '{"language":"en"}');
    const waits = [];
    const locked = lockedRename(3, 'EBUSY');
    await writeSettings(file, { language: 'zh' }, { fs: locked.fs, wait: async ms => { waits.push(ms); } });
    assert.equal(locked.calls(), 4);
    assert.deepEqual(waits, [50, 100, 200]);
    assert.deepEqual(await readSettings(file), { language: 'zh' });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('a file that stays locked against replacement is written in place', async () => {
    const file = path.join(tempDir(), 'settings.json');
    fs.writeFileSync(file, '{"language":"en"}');
    const locked = lockedRename(Infinity);
    await writeSettings(file, { language: 'zh' }, { fs: locked.fs, wait: async () => {}, retries: 2 });
    assert.equal(locked.calls(), 3);
    assert.deepEqual(await readSettings(file), { language: 'zh' });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
});

test('errors that retrying cannot fix are reported', async () => {
    const file = path.join(tempDir(), 'settings.json');
    const locked = lockedRename(Infinity, 'ENOSPC');
    await assert.rejects(writeSettings(file, { language: 'zh' }, { fs: locked.fs, wait: async () => {} }), { code: 'ENOSPC' });
    assert.equal(locked.calls(), 1);
});
