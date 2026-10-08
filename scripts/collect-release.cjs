/* eslint-disable @typescript-eslint/no-require-imports */
// electron-builder works in build/release (the unpacked app there is also what
// test:desktop:packaged runs). Only the portable EXE is moved to release/.
const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build', 'release');
const releaseDir = path.join(root, 'release');

const built = fs.readdirSync(buildDir).filter(name => name.endsWith(`-${version}-windows-x64.exe`));
if (built.length !== 1) throw new Error(`Expected one portable EXE for ${version} in ${buildDir}, found: ${built.join(', ') || 'none'}`);
const [name] = built;

fs.mkdirSync(releaseDir, { recursive: true });
// Replace earlier EXEs and the unpacked folder and logs that older builds wrote here.
for (const entry of fs.readdirSync(releaseDir)) {
    if (entry === 'win-unpacked' || /^builder-.*\.ya?ml$/.test(entry) || /\.exe$/i.test(entry)) {
        fs.rmSync(path.join(releaseDir, entry), { recursive: true, force: true });
    }
}
const target = path.join(releaseDir, name);
try {
    fs.renameSync(path.join(buildDir, name), target);
} catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.copyFileSync(path.join(buildDir, name), target);
    fs.rmSync(path.join(buildDir, name));
}
console.log(`Portable release: ${target}`);
