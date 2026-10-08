/* eslint-disable @typescript-eslint/no-require-imports */
// Build first, then run: node tests/desktop.e2e.cjs
// Test the packaged app: node tests/desktop.e2e.cjs --packaged
// All save-dialog choices and app data stay under build/desktop-qa.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const JSZip = require('jszip');
const { runMediaChecks, generate } = require('./webm.browser.cjs');
const screenPlayer = require('../src/lib/screenPlayer.json');

const base = 'sd100://app/';
const packaged = process.argv.includes('--packaged');
const executablePath = packaged ? path.resolve('build/release/win-unpacked/galleon-100-sd-studio.exe') : require('electron');
const qaDir = path.resolve('build/desktop-qa', new Date().toISOString().replace(/[:.]/g, '-'));
const downloadsDir = path.join(qaDir, 'downloads');
const userDataDir = path.join(qaDir, 'user-data');
fs.mkdirSync(downloadsDir, { recursive: true });
fs.mkdirSync(userDataDir, { recursive: true });
const launchArgs = [...(packaged ? [] : [path.resolve('build/desktop/main.cjs')]), `--user-data-dir=${userDataDir}`];

async function poll(read, predicate, description, timeout = 120000) {
    const deadline = Date.now() + timeout;
    let value;
    while (Date.now() < deadline) {
        value = await read();
        if (predicate(value)) return value;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(value)}`);
}

async function main() {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    assert.ok(fs.existsSync(executablePath), `Electron application does not exist: ${executablePath}`);
    const report = { startedAt: new Date().toISOString(), qaDir, packaged, executablePath, checks: [], status: 'RUNNING' };
    const app = await electron.launch({
        executablePath,
        args: launchArgs,
        env: environment,
        timeout: 60000,
    });
    const processHandle = app.process();
    const logs = [];
    processHandle.stderr.on('data', chunk => logs.push(chunk.toString()));
    let page;
    let closed = false;
    try {
        page = await app.firstWindow();
        page.setDefaultTimeout(30000);
        // firstWindow resolves when BrowserWindow exists, before main's initial
        // loadURL necessarily finishes. Let startup settle before test reloads.
        await page.locator('#drop_zone').waitFor();
        const pageErrors = [];
        const remoteRequests = [];
        report.pageErrors = pageErrors;
        report.remoteRequests = remoteRequests;
        page.on('pageerror', error => pageErrors.push(error.message));
        app.context().on('request', request => {
            if (/^https?:/i.test(request.url())) remoteRequests.push(request.url());
        });
        const security = await app.evaluate(({ app: electronApp, BrowserWindow, nativeImage, nativeTheme }) => {
            const windows = BrowserWindow.getAllWindows();
            const preferences = windows[0].webContents.getLastWebPreferences();
            const icon = nativeImage.createFromPath(`${electronApp.getAppPath()}/icon.ico`);
            return {
                iconSizes: icon.isEmpty() ? [] : icon.getScaleFactors().map(scale => icon.getSize(scale).width),
                windows: windows.length,
                darkChrome: nativeTheme.shouldUseDarkColors,
                userData: electronApp.getPath('userData'),
                nodeIntegration: preferences.nodeIntegration,
                contextIsolation: preferences.contextIsolation,
                sandbox: preferences.sandbox,
                webSecurity: preferences.webSecurity,
                preload: preferences.preload || null,
                versions: process.versions,
            };
        });
        assert.equal(security.windows, 1, 'one standalone app window');
        assert.equal(path.resolve(security.userData), userDataDir, 'QA must use isolated app data');
        assert.equal(security.nodeIntegration, false);
        assert.equal(security.contextIsolation, true);
        assert.equal(security.sandbox, true);
        assert.equal(security.webSecurity, true);
        assert.equal(security.preload, null);
        assert.equal(security.darkChrome, true, 'title bar and dialogs follow the dark studio theme');
        assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()), null, 'no menu bar');
        assert.ok(security.iconSizes.length > 0, 'bundled window icon loads');
        report.security = security;

        // Mock only the user's save-dialog answer. Real DownloadItems still run
        // through the production will-download handler and write the bytes.
        await app.evaluate(({ dialog, BrowserWindow }, directory) => {
            globalThis.__sd100Qa = { records: [], dialogs: [], counter: 0, cancelNext: false };
            const state = globalThis.__sd100Qa;
            dialog.showSaveDialogSync = (_window, options) => {
                const settings = options || _window;
                const filename = String(settings.defaultPath || 'download').split(/[\\/]/).pop();
                const cancelled = state.cancelNext;
                state.cancelNext = false;
                const chosen = cancelled ? '' : `${directory}/${++state.counter}-${filename}`;
                state.dialogs.push({ filename, title: settings.title, cancelled, chosen });
                return chosen;
            };
            BrowserWindow.getAllWindows()[0].webContents.session.prependListener('will-download', (_event, item) => {
                const record = { filename: item.getFilename(), state: 'progressing', savedPath: '', bytes: 0 };
                state.records.push(record);
                item.once('done', (_event, status) => {
                    record.state = status;
                    record.savedPath = item.getSavePath();
                    record.bytes = item.getReceivedBytes();
                });
            });
        }, downloadsDir);

        const captureDownload = async (_page, action, expectedState = 'completed') => {
            const baseline = await app.evaluate(() => globalThis.__sd100Qa.records.length);
            await action();
            const record = await poll(
                () => app.evaluate((_electron, index) => globalThis.__sd100Qa.records[index] || null, baseline),
                value => value && value.state !== 'progressing',
                `native download ${baseline + 1}`,
            );
            assert.equal(record.state, expectedState, JSON.stringify(record));
            if (expectedState === 'completed') {
                const relative = path.relative(downloadsDir, record.savedPath);
                assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'save stays in QA downloads');
                assert.ok(fs.statSync(record.savedPath).size > 0, 'saved output is non-empty');
            }
            return { suggestedFilename: () => record.filename, path: async () => record.savedPath, record };
        };

        await app.context().setOffline(true);
        await page.goto(base, { waitUntil: 'networkidle' });
        assert.deepEqual(await page.evaluate(() => ({
            secure: isSecureContext,
            requireType: typeof require,
            processType: typeof process,
        })), { secure: true, requireType: 'undefined', processType: 'undefined' });
        assert.equal(await page.locator('iframe').count(), 0, 'offline app contains no remote iframe');
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'en', 'English is the default language');
        assert.equal(await page.locator('#language').inputValue(), 'en');
        await page.screenshot({ path: path.join(qaDir, 'desktop-home.png'), fullPage: true });
        report.checks.push('Sandbox, context isolation, secure local origin, isolated data, offline page load');
        console.log('PASS desktop: standalone window, sandbox, secure local origin and offline startup.');

        const { gifBackgrounds } = await runMediaChecks({
            page,
            base,
            qaDir,
            downloadFile: captureDownload,
        });
        report.checks.push('GIF, VP8 and VP9 previews/conversion; corrupt input; window drop; cancel/retry; crop masks; stale outputs; timing and pixels; GALLEON profiles; plugin ZIP integrity; minimum window layout');

        // Cancelling a native save must preserve the generated Blob and permit
        // retrying that same output without reprocessing the source animation.
        const beforeCancel = fs.readdirSync(downloadsDir);
        await app.evaluate(() => { globalThis.__sd100Qa.cancelNext = true; });
        const cancelled = await captureDownload(page, () => page.locator('a[download="screen.gif"]').click(), 'cancelled');
        assert.equal(cancelled.suggestedFilename(), 'screen.gif');
        assert.deepEqual(fs.readdirSync(downloadsDir), beforeCancel, 'cancel creates no downloaded file');
        for (const filename of ['screen.gif', 'keys.gif']) {
            const downloaded = await captureDownload(page, () => page.locator(`a[download="${filename}"]`).click());
            assert.equal(downloaded.suggestedFilename(), filename);
            assert.deepEqual(fs.readFileSync(await downloaded.path()), await gifBackgrounds.file(`stream_deck_corsair_tiles/${filename}`).async('nodebuffer'));
        }
        const manualZip = await captureDownload(page, () => page.locator('a[download="stream_deck_gifs.zip"]').click());
        assert.equal(manualZip.suggestedFilename(), 'stream_deck_gifs.zip');
        const pluginAgain = await captureDownload(page, () => page.locator(`a[download="${screenPlayer.filename}"]`).click());
        assert.deepEqual(fs.readFileSync(await pluginAgain.path()), fs.readFileSync(path.join('public', screenPlayer.download)));
        report.checks.push('Native save cancellation/retry; separate screen/keys GIFs; manual ZIP; repeated plugin download');
        console.log('PASS desktop: native save cancellation/retry, individual GIFs, manual ZIP and repeated plugin download.');

        // New clears the project; the toolbar and Ctrl+O load media, Ctrl+N starts over.
        await page.setViewportSize({ width: 1280, height: 860 });
        await page.locator('.toolbar').getByRole('button', { name: 'New', exact: true }).click();
        await page.locator('#drop_zone').waitFor();
        assert.equal(await page.locator('.output-list').count(), 0, 'New clears the listed outputs');
        const chooser = page.waitForEvent('filechooser');
        await page.keyboard.press('Control+O');
        await (await chooser).setFiles(path.resolve('public/sample/sample_720x1280.gif'));
        await page.locator('.crop-preview img').waitFor();
        assert.equal(await page.locator('.source-name').innerText(), 'sample_720x1280.gif');
        await page.keyboard.press('Control+N');
        await page.locator('#drop_zone').waitFor();
        await page.locator('.toolbar').getByRole('button', { name: 'Load sample', exact: true }).click();
        await page.locator('.crop-preview img').waitFor();
        await page.screenshot({ path: path.join(qaDir, 'desktop-sample.png') });
        report.checks.push('No menu bar; New, Ctrl+O, Ctrl+N and the toolbar sample');

        // The language choice switches the interface at once, is saved for the next start (checked after relaunch below),
        // and also drives native dialogs and the names inside the generated profile.
        const settingsFile = path.join(userDataDir, 'settings.json');
        const savedLanguage = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')).language; } catch { return null; } };
        await page.locator('#language').selectOption('zh');
        await page.locator('.toolbar').getByRole('button', { name: '载入示例', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'zh-CN');
        await poll(async () => savedLanguage(), value => value === 'zh', 'saved Chinese language setting', 10000);
        await page.goto(base, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('#language').inputValue(), 'zh', 'the saved language survives a reload');
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'zh-CN');
        await page.locator('.toolbar').getByRole('button', { name: '载入示例', exact: true }).click();
        await page.locator('.crop-preview img').waitFor();
        await page.getByRole('button', { name: '生成', exact: true }).click();
        await page.locator('.status-chip.ok').waitFor({ timeout: 120000 });
        await page.screenshot({ path: path.join(qaDir, 'desktop-zh.png') });
        const zhProfile = await captureDownload(page, () => page.locator('a[download="GALLEON_100_SD_Background.streamDeckProfile"]').click());
        const zhDialog = await app.evaluate(() => globalThis.__sd100Qa.dialogs.at(-1));
        assert.equal(zhDialog.title, '保存导出文件', 'native save dialog follows the language');
        const zhZip = await JSZip.loadAsync(fs.readFileSync(await zhProfile.path()));
        const zhNames = await Promise.all(Object.keys(zhZip.files).filter(name => /manifest\.json$/.test(name))
            .map(async name => JSON.parse(await zhZip.file(name).async('string')).Name));
        assert.deepEqual(zhNames.filter(Boolean).sort(), ['GALLEON 100 SD 动画背景', 'GALLEON 100 SD 动画背景', '功能页'].sort());
        // Switching back retranslates the open project without regenerating it.
        await page.locator('#language').selectOption('en');
        await page.getByRole('button', { name: 'Generate', exact: true }).waitFor();
        assert.equal(await page.locator('.status-chip.ok').innerText(), 'Generated', 'outputs stay current across a language switch');
        await poll(async () => savedLanguage(), value => value === 'en', 'saved English language setting', 10000);
        await page.goto(base, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('#language').inputValue(), 'en');
        await page.locator('.toolbar').getByRole('button', { name: 'Load sample', exact: true }).click();
        await page.locator('.crop-preview img').waitFor();
        await generate(page);
        await page.screenshot({ path: path.join(qaDir, 'desktop-en.png') });
        const enProfile = await captureDownload(page, () => page.locator('a[download="GALLEON_100_SD_Background.streamDeckProfile"]').click());
        assert.equal((await app.evaluate(() => globalThis.__sd100Qa.dialogs.at(-1))).title, 'Save export');
        const enZip = await JSZip.loadAsync(fs.readFileSync(await enProfile.path()));
        assert.ok(await Promise.all(Object.keys(enZip.files).filter(name => /manifest\.json$/.test(name))
            .map(async name => JSON.parse(await enZip.file(name).async('string')).Name)).then(names => names.includes('Functions')));
        assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.output-name, .output-meta')]
            .filter(element => element.scrollWidth > element.clientWidth).map(element => element.textContent)), [], 'English output titles and details are not cut off');
        // Leave Chinese selected so the relaunch below must read it back from settings.json.
        await page.locator('#language').selectOption('zh');
        await poll(async () => savedLanguage(), value => value === 'zh', 'saved Chinese language setting before restart', 10000);
        report.checks.push('Language switch: instant UI change, saved setting, reload, localized save dialog and profile page names');

        assert.deepEqual(remoteRequests, [], 'desktop operation makes no HTTP(S) requests');
        assert.deepEqual(pageErrors, [], 'no renderer exceptions');
        assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
        report.checks.push('No external HTTP(S) requests or renderer errors');
        report.downloads = await app.evaluate(() => globalThis.__sd100Qa);
        report.remoteRequests = remoteRequests;
        report.pageErrors = pageErrors;

        // Exercise the actual close-window path, including app quit on Windows.
        const exited = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('App did not exit after closing its only window')), 15000);
            processHandle.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
        });
        await page.close();
        report.exit = await exited;
        closed = true;
        assert.equal(report.exit.code, 0);
        report.checks.push('Closing the standalone window exits the app');

        // A fresh start reads settings.json; a damaged file falls back to English.
        const startupLanguage = async () => {
            const relaunched = await electron.launch({ executablePath, args: launchArgs, env: environment, timeout: 60000 });
            try {
                const window = await relaunched.firstWindow();
                await window.locator('#drop_zone').waitFor();
                return {
                    lang: await window.evaluate(() => document.documentElement.lang),
                    selected: await window.locator('#language').inputValue(),
                    open: await window.locator('.toolbar .tool-button').first().innerText(),
                };
            } finally { await relaunched.close(); }
        };
        assert.deepEqual(await startupLanguage(), { lang: 'zh-CN', selected: 'zh', open: '打开…' }, 'saved language restored after restart');
        fs.writeFileSync(settingsFile, '{ not json');
        assert.deepEqual(await startupLanguage(), { lang: 'en', selected: 'en', open: 'Open…' }, 'damaged settings fall back to English');
        report.checks.push('Saved language restored after restart; damaged settings fall back to English');
        assert.ok(!logs.join('').includes('Could not save settings'), 'every language change reached settings.json');
        report.status = 'PASS';
        console.log('PASS desktop: no menu bar, toolbar and shortcuts, saved language switch restored after restart, no external requests, clean window-close exit.');
    } catch (error) {
        report.status = 'FAILED';
        report.error = error.stack || String(error);
        report.downloads = await app.evaluate(() => globalThis.__sd100Qa || null).catch(() => null);
        if (page && !page.isClosed()) await page.screenshot({ path: path.join(qaDir, 'failure.png'), fullPage: true }).catch(() => {});
        throw error;
    } finally {
        if (!closed) await app.close().catch(() => {});
        report.finishedAt = new Date().toISOString();
        fs.writeFileSync(path.join(qaDir, 'report.json'), JSON.stringify(report, null, 2));
        fs.writeFileSync(path.join(qaDir, 'electron-stderr.log'), logs.join(''));
        console.log(`Desktop QA artifacts: ${qaDir}`);
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
