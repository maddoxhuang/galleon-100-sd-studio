/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');

const APP_ORIGIN = 'sd100://app';
// The renderer PUTs the chosen language here; see LANGUAGE_ENDPOINT in src/i18n/messages.tsx.
const LANGUAGE_PATH = '/__app/language';
// Keep in sync with HTML_LANG in src/i18n/messages.tsx.
const LANGUAGE_TAGS = { en: 'en', zh: 'zh-CN' };
const DEFAULT_LANGUAGE = 'en';
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
].join('; ');

function resolveAppFile(root, requestUrl) {
    const url = new URL(requestUrl);
    if (url.protocol !== 'sd100:' || url.hostname !== 'app' || url.port || url.username || url.password) {
        throw new Error('Invalid application origin');
    }
    const pathname = decodeURIComponent(url.pathname || '/');
    if (/[\\\0:]/.test(pathname) || pathname.split('/').some(part => part === '..' || part === '.')) {
        throw new Error('Invalid resource path');
    }
    const base = path.resolve(root);
    const file = path.resolve(base, `.${pathname === '/' ? '/index.html' : pathname}`);
    const relative = path.relative(base, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Resource outside application');
    }
    return file;
}

function isAppUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'sd100:' && url.hostname === 'app' && !url.port && !url.username && !url.password;
    } catch { return false; }
}

/** Returns a supported language id, or null for anything else. */
function parseLanguage(value) {
    const id = typeof value === 'string' ? value.trim() : '';
    return Object.hasOwn(LANGUAGE_TAGS, id) ? id : null;
}

/** Sets <html lang> so the renderer starts in the saved language. */
function localizeIndex(html, language) {
    const tag = LANGUAGE_TAGS[parseLanguage(language) || DEFAULT_LANGUAGE];
    return html.replace(/(<html\b[^>]*?\blang=")[^"]*"/i, `$1${tag}"`);
}

module.exports = {
    APP_ORIGIN, CONTENT_SECURITY_POLICY, LANGUAGE_PATH, DEFAULT_LANGUAGE,
    resolveAppFile, isAppUrl, parseLanguage, localizeIndex,
};
