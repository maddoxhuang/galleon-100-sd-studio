/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');

// Windows briefly refuses to replace a file that another process (antivirus,
// search indexer, backup) has open. These errors clear up after a moment.
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Returns the saved settings object, or {} when the file is missing or damaged. */
async function readSettings(file, { fs = require('node:fs/promises') } = {}) {
    try {
        const settings = JSON.parse(await fs.readFile(file, 'utf8'));
        return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    } catch { return {}; }
}

/**
 * Saves settings through a temporary file so a crash never leaves half-written
 * JSON. A rename that stays blocked falls back to writing the file in place.
 */
async function writeSettings(file, settings, { fs = require('node:fs/promises'), wait = sleep, retries = 5 } = {}) {
    const contents = `${JSON.stringify(settings, null, 2)}\n`;
    const temporary = `${file}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, contents);
    for (let attempt = 0; ; attempt++) {
        try {
            await fs.rename(temporary, file);
            return;
        } catch (error) {
            if (!RETRYABLE.has(error && error.code)) throw error;
            if (attempt >= retries) break;
            await wait(50 * 2 ** attempt);
        }
    }
    await fs.writeFile(file, contents);
    await fs.rm(temporary, { force: true }).catch(() => {});
}

module.exports = { readSettings, writeSettings };
