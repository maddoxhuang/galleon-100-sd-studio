/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, Menu, dialog, nativeTheme, net, protocol, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const {
    APP_ORIGIN, CONTENT_SECURITY_POLICY, LANGUAGE_PATH, DEFAULT_LANGUAGE,
    resolveAppFile, isAppUrl, parseLanguage, localizeIndex,
} = require('./protocol.cjs');
const { readSettings, writeSettings } = require('./settings.cjs');

app.setName('SD100 Studio');
app.setAppUserModelId('dev.sd100.studio');
// Dark title bar and native dialogs to match the dark editor UI.
nativeTheme.themeSource = 'dark';
// Chromium's standard switch also makes automated checks use an isolated profile.
const userData = app.commandLine.getSwitchValue('user-data-dir');
if (userData) app.setPath('userData', path.resolve(userData));

protocol.registerSchemesAsPrivileged([{
    scheme: 'sd100',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

// Native dialog text. The renderer's own text lives in src/i18n/messages.tsx.
const STRINGS = {
    en: {
        saveTitle: 'Save export',
        allFiles: 'All files',
        saveFailedTitle: 'Save failed',
        saveFailedMessage: 'The file was not saved completely. Click Save again.',
        startupTitle: 'SD100 Studio could not start',
        startupMessage: 'The built-in interface could not be loaded. Close SD100 Studio and start it again.',
    },
    zh: {
        saveTitle: '保存导出文件',
        allFiles: '所有文件',
        saveFailedTitle: '保存失败',
        saveFailedMessage: '文件未能完整保存，请重新点击保存。',
        startupTitle: 'SD100 Studio 启动失败',
        startupMessage: '无法加载程序内置界面，请关闭后重新启动。',
    },
};

let mainWindow;
let lastSaveDirectory;
let language = DEFAULT_LANGUAGE;
let settingsWrite = Promise.resolve();
const strings = () => STRINGS[language];
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

async function loadSettings() {
    language = parseLanguage((await readSettings(settingsFile())).language) || DEFAULT_LANGUAGE;
}

// Writes are queued so quick language switches land in order. Resolves to
// whether the setting reached the disk.
function saveSettings() {
    const settings = { language };
    settingsWrite = settingsWrite.then(() => writeSettings(settingsFile(), settings)).then(() => true, error => {
        console.error('Could not save settings:', error);
        return false;
    });
    return settingsWrite;
}

function installDownloads() {
    session.defaultSession.on('will-download', (event, item, contents) => {
        if (!mainWindow || contents !== mainWindow.webContents) {
            event.preventDefault();
            return;
        }
        // Control characters are invalid in Windows file names, so they are replaced too.
        // eslint-disable-next-line no-control-regex
        const name = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        const extension = path.extname(name).slice(1);
        const text = strings();
        const savePath = dialog.showSaveDialogSync(mainWindow, {
            title: text.saveTitle,
            defaultPath: path.join(lastSaveDirectory || app.getPath('downloads'), name),
            filters: [
                ...(extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : []),
                { name: text.allFiles, extensions: ['*'] },
            ],
        });
        if (!savePath) {
            item.cancel();
            return;
        }
        lastSaveDirectory = path.dirname(savePath);
        item.setSavePath(savePath);
        item.once('done', (_event, state) => {
            if (state !== 'completed' && state !== 'cancelled' && mainWindow && !mainWindow.isDestroyed()) {
                const failed = strings();
                dialog.showMessageBox(mainWindow, {
                    type: 'error', title: failed.saveFailedTitle,
                    message: failed.saveFailedMessage,
                    detail: savePath,
                });
            }
        });
    });
}

async function handleAppRequest(webRoot, request) {
    if (!isAppUrl(request.url)) return new Response(null, { status: 404 });
    // The renderer is sandboxed with no preload, so it saves its language
    // choice through this same-origin endpoint instead of IPC.
    if (new URL(request.url).pathname === LANGUAGE_PATH) {
        if (request.method !== 'PUT') return new Response(null, { status: 405, headers: { Allow: 'PUT' } });
        const next = parseLanguage(await request.text());
        if (!next) return new Response(null, { status: 400 });
        language = next;
        return new Response(null, { status: (await saveSettings()) ? 204 : 500 });
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    try {
        const file = resolveAppFile(webRoot, request.url);
        if (!(await fs.stat(file)).isFile()) return new Response(null, { status: 404 });
        const headers = new Headers({
            'Content-Security-Policy': CONTENT_SECURITY_POLICY,
            'X-Content-Type-Options': 'nosniff',
        });
        // index.html starts the renderer in the saved language, so it is never cached.
        if (file === path.join(webRoot, 'index.html')) {
            const html = localizeIndex(await fs.readFile(file, 'utf8'), language);
            headers.set('Content-Type', 'text/html; charset=utf-8');
            headers.set('Cache-Control', 'no-cache');
            return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers });
        }
        const response = await net.fetch(pathToFileURL(file).toString(), { method: request.method });
        response.headers.forEach((value, key) => { if (!headers.has(key)) headers.set(key, value); });
        return new Response(response.body, { status: response.status, headers });
    } catch { return new Response(null, { status: 404 }); }
}

async function createWindow() {
    const window = new BrowserWindow({
        title: 'SD100 Studio',
        width: 1280, height: 860, minWidth: 960, minHeight: 620,
        backgroundColor: '#18191d', show: false,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: false, contextIsolation: true, sandbox: true,
            webSecurity: true, webviewTag: false,
        },
    });
    mainWindow = window;
    // The interface has no external links; nothing may open or replace the window.
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
    await window.loadURL(`${APP_ORIGIN}/`);
}

async function start() {
    await app.whenReady();
    const webRoot = path.join(__dirname, 'web');
    await fs.access(path.join(webRoot, 'index.html'));
    await loadSettings();
    protocol.handle('sd100', request => handleAppRequest(webRoot, request));
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    // All application resources are bundled; the application never fetches remote content.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
    installDownloads();
    // No menu bar: every command lives in the window's own toolbar and shortcuts.
    Menu.setApplicationMenu(null);
    await createWindow();
    app.on('activate', () => { if (!mainWindow) void createWindow(); });
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    });
    app.on('window-all-closed', () => app.quit());
    start().catch(error => {
        console.error(error);
        const text = strings();
        dialog.showErrorBox(text.startupTitle, `${text.startupMessage}\n${error.message}`);
        app.exit(1);
    });
}
