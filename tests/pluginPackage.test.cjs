/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const JSZip = require('jszip');
const config = require('../src/lib/screenPlayer.json');

test('the versioned download holds the installer and one bilingual README', async () => {
    const tag = `GALLEON_Screen_Player_v${config.version.split('.').slice(0, 3).join('_')}`;
    assert.deepEqual([config.filename, config.download, config.data], [`${tag}.zip`, `/plugins/${tag}.zip`, `/plugins/${tag}.json`]);
    const bytes = await fs.readFile(`public${config.download}`);
    const data = JSON.parse(await fs.readFile(`public${config.data}`, 'utf8'));
    assert.equal(data.size, bytes.length); assert.ok(Buffer.from(data.base64, 'base64').equals(bytes));
    const download = await JSZip.loadAsync(bytes);
    const installer = `${config.pluginUUID}.streamDeckPlugin`;
    assert.deepEqual(Object.keys(download.files).sort(), ['README.txt', installer]);
    assert.ok((await download.file(installer).async('nodebuffer')).equals(await fs.readFile(`public/plugins/${installer}`)));
    const readme = await download.file('README.txt').async('nodebuffer');
    assert.deepEqual([...readme.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM');
    const text = readme.toString('utf8', 3);
    assert.ok(text.endsWith('\r\n') && !/(?<!\r)\n/.test(text), 'CRLF line endings');
    const english = text.indexOf('"Restart synced playback"'), chinese = text.indexOf('「从头重新同步播放」');
    assert.ok(english > 0 && chinese > english, 'English section comes first');
    assert.match(text, /Functions page/); assert.match(text, /「功能页」/);
    // Simplified Chinese Stream Deck shows localized action names and tooltips.
    const plugin = await JSZip.loadAsync(await download.file(installer).async('nodebuffer'));
    const read = async name => JSON.parse(await plugin.file(`${config.pluginUUID}.sdPlugin/${name}`).async('string'));
    const [manifest, zh] = await Promise.all([read('manifest.json'), read('zh_CN.json')]);
    for (const action of manifest.Actions) assert.ok(zh[action.UUID]?.Name && zh[action.UUID]?.Tooltip, action.UUID);
});

test('plugin installer loads its native HID/JPEG dependencies outside the development workspace', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sd100-plugin-test-'));
    try {
        const archive = await JSZip.loadAsync(await fs.readFile(`public/plugins/${config.pluginUUID}.streamDeckPlugin`));
        for (const [relative, entry] of Object.entries(archive.files)) {
            if (entry.dir) continue;
            const target = path.resolve(temp, relative);
            assert.ok(target.startsWith(temp + path.sep));
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, await entry.async('nodebuffer'));
        }
        const directory = path.join(temp, `${config.pluginUUID}.sdPlugin`);
        const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
        assert.equal(manifest.Version, config.version);
        assert.ok(manifest.Actions.some(action => action.UUID === config.keyActionUUID));
        const probe = path.join(directory, 'probe.cjs');
        await fs.writeFile(probe, `
            const assert=require('node:assert/strict');
            const sharp=require('sharp'); const hid=require('node-hid');
            (async()=>{
                assert.equal(typeof hid.HIDAsync.open,'function');
                const jpeg=await sharp({create:{width:720,height:384,channels:3,background:'#ff0000'}}).jpeg().toBuffer();
                const info=await sharp(jpeg).metadata();
                assert.equal(info.width,720); assert.equal(info.height,384);
                console.log('isolated native runtime OK');
            })().catch(error=>{console.error(error);process.exitCode=1});
        `);
        const result = spawnSync(process.execPath, [probe], { cwd: directory,
            env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' }, encoding: 'utf8', windowsHide: true, timeout: 20000 });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /isolated native runtime OK/);
    } finally {
        const resolved = path.resolve(temp);
        assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
        assert.ok(path.basename(resolved).startsWith('sd100-plugin-test-'));
        await fs.rm(resolved, { recursive: true, force: true });
    }
});
