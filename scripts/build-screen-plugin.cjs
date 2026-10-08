/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('esbuild');
const JSZip = require('jszip');
const { createCanvas } = require('@napi-rs/canvas');
const config = require('../src/lib/screenPlayer.json');

async function main() {
    const root = path.resolve(__dirname, '..');
    const output = path.join(root, 'build', `${config.pluginUUID}.sdPlugin`);
    const source = path.join(root, 'streamdeck-plugin');
    const publicDir = path.join(root, 'public', 'plugins');
    // This installer contains Windows x64 native dependencies.
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the plugin on Windows x64.');
    if (path.dirname(output) !== path.join(root, 'build')) throw new Error('Invalid plugin build directory.');
    await fs.rm(output, { recursive: true, force: true });
    await fs.mkdir(path.join(output, 'bin'), { recursive: true });
    await fs.mkdir(path.join(output, 'images'), { recursive: true });
    await fs.mkdir(publicDir, { recursive: true });
    // zh_CN.json localizes the manifest strings for Simplified Chinese Stream Deck.
    for (const name of ['manifest.json', 'zh_CN.json', 'screen-layout.json', 'inspector.html']) await fs.copyFile(path.join(source, name), path.join(output, name));
    const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
    if (manifest.UUID !== config.pluginUUID || manifest.Version !== config.version || !manifest.Actions.some(action => action.UUID === config.keyActionUUID)) throw new Error('Plugin and profile identifiers must match.');
    await esbuild.build({ entryPoints: [path.join(source, 'plugin.cjs')], outfile: path.join(output, 'bin', 'plugin.js'), bundle: true, platform: 'node', target: 'node24', format: 'cjs', legalComments: 'eof', external: ['node-hid', 'sharp'] });
    // Ship runtime dependencies with the plugin, including the HID N-API binding
    // and JPEG encoder DLLs. No npm, Python, or separate Node install is needed.
    const copied = new Set();
    async function copyRuntime(name, optional = false) {
        if (copied.has(name)) return;
        const directory = path.join(root, 'node_modules', name);
        let metadata;
        try { metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')); }
        catch (error) { if (optional && error.code === 'ENOENT') return; throw error; }
        if (metadata.os && !metadata.os.includes('win32')) return;
        if (metadata.cpu && !metadata.cpu.includes('x64')) return;
        copied.add(name);
        await fs.cp(directory, path.join(output, 'node_modules', name), { recursive: true, filter: item => {
            const relative = path.relative(directory, item).replaceAll('\\', '/');
            return !relative.startsWith('node_modules/') && relative !== 'node_modules' &&
                (!relative.startsWith('prebuilds/') || relative.startsWith('prebuilds/HID-win32-x64'));
        } });
        for (const dependency of Object.keys(metadata.dependencies || {})) await copyRuntime(dependency);
        for (const dependency of Object.keys(metadata.optionalDependencies || {})) await copyRuntime(dependency, true);
    }
    await copyRuntime('node-hid');
    await copyRuntime('sharp');
    // Simple source-generated icons; no external artwork is bundled.
    for (const [name, size] of [['plugin', 256], ['action', 20], ['key', 72]]) {
        for (const scale of [1, 2]) {
            const canvas = createCanvas(size * scale, size * scale);
            const ctx = canvas.getContext('2d');
            ctx.scale(size * scale / 100, size * scale / 100);
            if (name !== 'action') { ctx.fillStyle = '#201632'; ctx.fillRect(0, 0, 100, 100); }
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5;
            ctx.strokeRect(10, 23, 80, 50);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.moveTo(43, 34); ctx.lineTo(64, 48); ctx.lineTo(43, 62); ctx.fill();
            await fs.writeFile(path.join(output, 'images', `${name}${scale === 2 ? '@2x' : ''}.png`), canvas.toBuffer('image/png'));
        }
    }
    const licenses = ['gifuct-js', 'js-binary-schema-parser', 'pngjs'];
    const notices = await Promise.all(licenses.map(async name => {
        const directory = path.join(root, 'node_modules', name);
        const file = (await fs.readdir(directory)).find(file => /^licen[cs]e/i.test(file));
        if (!file) throw new Error(`Missing license: ${name}`);
        return `${name}\n${await fs.readFile(path.join(directory, file), 'utf8')}`;
    }));
    notices.push('Display report layouts are based on the Elgato Gen2 HID API and the galdeck project protocol documentation (CC-BY 4.0).\nhttps://docs.elgato.com/streamdeck/hid/\nhttps://github.com/cynak/galdeck/blob/main/docs/protocol.md\nhttps://creativecommons.org/licenses/by/4.0/\nNative dependencies retain their licenses under node_modules.');
    await fs.writeFile(path.join(output, 'THIRD-PARTY-LICENSES.txt'), notices.join('\n\n'));
    const cliPackage = require('@elgato/cli/package.json');
    const cli = path.join(path.dirname(require.resolve('@elgato/cli/package.json')), typeof cliPackage.bin === 'string' ? cliPackage.bin : cliPackage.bin.streamdeck);
    const result = spawnSync(process.execPath, [cli, 'pack', output, '--output', publicDir, '--force', '--no-file-list'], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Stream Deck plugin validation/packaging failed.');
    // Include instructions beside the installer. The JSON copy lets the app save it
    // through a local Blob, like the GIF/Profile exports.
    const zip = new JSZip();
    const installer = `${config.pluginUUID}.streamDeckPlugin`;
    zip.file(installer, await fs.readFile(path.join(publicDir, installer)));
    // One bilingual README: English first, then Simplified Chinese. The BOM and
    // CRLF line endings keep Windows Notepad from misreading the encoding.
    zip.file('README.txt', '\uFEFF' + [
        'GALLEON Screen Player (synchronized background plugin)',
        '',
        '1. Extract this ZIP.',
        '2. Double-click com.sd100.screen-player.streamDeckPlugin to install or upgrade the plugin. Requires Windows x64 and Stream Deck 7.1 or later.',
        '3. In SD100 Studio, generate and save the Stream Deck profile again.',
        '4. In Stream Deck, import it under Profiles → Import, then switch to the new profile.',
        '',
        'The full 720×384 screen and all 12 keys are driven by the same frame. Older four-region profiles must be regenerated.',
        'The new profile has an animation page and a Functions page. Turn the left dial counterclockwise for the previous page or clockwise for the next page; press it to return to the animation page. Both pages come with built-in navigation that uses none of the 12 keys.',
        'Keep the main key at the top left of the animation page and the left-dial navigation, and leave the rest of the screen empty. Add any keys you like to the Functions page; if you add more pages, copy the left-dial navigation to them.',
        'To restart playback from the beginning, click "Restart synced playback" in the plugin settings. You can close SD100 Studio, but Stream Deck must keep running.',
        'The device receives the images of each frame one after another over USB, so a frame can take a moment to update everywhere. This delay does not build up into drift the way separately looping animations would.',
        '',
        '----------------------------------------',
        '',
        'GALLEON 同步背景插件',
        '',
        '1. 解压本 ZIP。',
        '2. 双击 com.sd100.screen-player.streamDeckPlugin 安装或升级插件。需要 Windows x64 和 Stream Deck 7.1 或更新版。',
        '3. 在 SD100 Studio 中重新生成并保存 Stream Deck Profile。',
        '4. 在 Stream Deck 的 Profiles → Import 中导入，并切换到新 Profile。',
        '',
        '完整 720×384 上屏和 12 个按键由同一帧驱动。旧版四区域 Profile 必须重新生成。',
        '新版 Profile 包含动画页和「功能页」。左滚轮逆时针上一页、顺时针下一页、按下返回动画页。两页均已预置原生导航，不占用 12 个按键。',
        '请保留动画页左上角主控键和左滚轮导航，其余上屏区域留空。「功能页」可以自由添加按键；新增页面时请复制左滚轮导航。',
        '可在插件设置中点击「从头重新同步播放」。SD100 Studio 可关闭，Stream Deck 需保持运行。',
        '设备通过 USB 顺序接收同一帧的各个图像，可能存在短暂帧内更新延迟，不会累积成独立循环的时间漂移。',
        '',
    ].join('\r\n'));
    const zipBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await fs.writeFile(path.join(root, 'public', config.download), zipBytes);
    await fs.writeFile(path.join(root, 'public', config.data), JSON.stringify({ size: zipBytes.length, base64: zipBytes.toString('base64') }));
    console.log(`Plugin ready: ${path.join(publicDir, `${config.pluginUUID}.streamDeckPlugin`)}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
