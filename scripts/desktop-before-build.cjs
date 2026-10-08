/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function beforeBuild({ appDir }) {
    const expected = path.resolve(__dirname, '..', 'build', 'desktop');
    if (path.resolve(appDir) !== expected) throw new Error('Unexpected desktop package directory');
    const metadata = JSON.parse(await fs.readFile(path.join(appDir, 'package.json'), 'utf8'));
    if (Object.keys(metadata.dependencies || {}).length) throw new Error('Desktop runtime must be self-contained');
    await fs.access(path.join(appDir, 'web', 'renderer.js'));
    // Renderer dependencies are already bundled by esbuild; the main process
    // uses only Electron and Node built-ins. Do not collect the web project's
    // node_modules from parent directories or rebuild its native plugin tools.
    return false;
};
