/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveAppFile, isAppUrl, parseLanguage, localizeIndex } = require('../desktop/protocol.cjs');
const root = path.resolve('build/desktop/web');

test('desktop serves root, unicode filenames and bundled assets within its web directory', () => {
    assert.equal(resolveAppFile(root, 'sd100://app/'), path.join(root, 'index.html'));
    assert.equal(resolveAppFile(root, 'sd100://app/plugins/plugin.json?v=2'), path.join(root, 'plugins/plugin.json'));
    assert.equal(resolveAppFile(root, 'sd100://app/sample/%E7%A4%BA%E4%BE%8B.gif'), path.join(root, 'sample/示例.gif'));
});

test('desktop rejects other origins and Windows path escape forms', () => {
    for (const url of [
        'https://app/index.html', 'sd100://other/index.html', 'sd100://app:123/index.html',
        'sd100://user@app/index.html', 'sd100://app/%2e%2e%2fsecret',
        'sd100://app/%2e%2e%5csecret', 'sd100://app/C%3A/secret',
        'sd100://app/test%00.png', 'sd100://app/%zz',
    ]) assert.throws(() => resolveAppFile(root, url), url);
});

test('desktop navigation only accepts the application origin', () => {
    assert.equal(isAppUrl('sd100://app/#test'), true);
    for (const url of ['sd100://user@app/', 'sd100://app.evil/', 'https://example.com', 'file:///C:/Windows/notepad.exe', 'bad-url']) {
        assert.equal(isAppUrl(url), false, url);
    }
});

test('desktop accepts only the supported interface languages', () => {
    assert.equal(parseLanguage('en'), 'en');
    assert.equal(parseLanguage(' zh\n'), 'zh');
    for (const value of ['', 'EN', 'zh-CN', 'fr', 'toString', '__proto__', null, undefined, 1, {}]) {
        assert.equal(parseLanguage(value), null, String(value));
    }
});

test('desktop serves index.html in the saved language and defaults to English', () => {
    const html = fs.readFileSync(path.resolve('desktop/index.html'), 'utf8');
    assert.match(html, /<html lang="en">/, 'the bundled page defaults to English');
    assert.match(localizeIndex(html, 'zh'), /<html lang="zh-CN">/);
    assert.match(localizeIndex(html, 'en'), /<html lang="en">/);
    assert.match(localizeIndex(html, 'fr'), /<html lang="en">/);
    assert.equal(localizeIndex(html, 'zh').replace('zh-CN', 'en'), html, 'only the language tag changes');
});
