/* eslint-disable @typescript-eslint/no-require-imports */
// Display-only reports from Elgato's Gen2 HID API and the galdeck project.
// https://docs.elgato.com/streamdeck/hid/main/
// https://github.com/cynak/galdeck/blob/main/docs/protocol.md (CC-BY 4.0)
// We use only the validated 720x384 LCD and 160x160 key paths, never the
// unmeasured full physical-panel extent. Stream Deck owns input and keepalives.
const VID = 0x1b1c, PID = 0x2b18;

// The property inspector localizes user-facing failures by their stable code.
const deviceError = (code, message) => Object.assign(new Error(message), { code });

function* imageReports(jpeg, key = null) {
    if (!Buffer.isBuffer(jpeg) || jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Invalid JPEG.');
    if (key !== null && (!Number.isInteger(key) || key < 0 || key >= 12)) throw new Error('Invalid key.');
    const header = key === null ? 16 : 8;
    const capacity = 1024 - header;
    if (Math.ceil(jpeg.length / capacity) > 65536) throw new Error('JPEG exceeds report index range.');
    for (let offset = 0, part = 0; offset < jpeg.length; offset += capacity, part++) {
        const length = Math.min(capacity, jpeg.length - offset);
        const report = Buffer.alloc(1024);
        report[0] = 2;
        if (key === null) {
            report[1] = 0x0c;
            report.writeUInt16LE(720, 6);
            report.writeUInt16LE(384, 8);
            report[10] = offset + length === jpeg.length ? 1 : 0;
            report.writeUInt16LE(part, 11);
            report.writeUInt16LE(length, 13);
        } else {
            report[1] = 7;
            report[2] = key;
            report[3] = offset + length === jpeg.length ? 1 : 0;
            report.writeUInt16LE(length, 4);
            report.writeUInt16LE(part, 6);
        }
        jpeg.copy(report, header, offset, offset + length);
        yield report;
    }
}

class HidOutput {
    constructor(device) { this.device = device; }
    static async open(hid = require('node-hid')) {
        const candidates = (await hid.devicesAsync(VID, PID)).filter(d => d.interface === 0);
        if (!candidates.length) throw deviceError('display-not-found', 'GALLEON display interface not found. Check the USB connection.');
        if (candidates.length !== 1) throw deviceError('multiple-devices', 'More than one GALLEON is connected. Connect only the target device and try again.');
        return new HidOutput(await hid.HIDAsync.open(candidates[0].path));
    }
    async writeFrame(images, keys, current) {
        // Finish each JPEG before beginning another; the device may reuse its
        // receive buffer. All images come from exactly the same decoded frame.
        for (const key of [null, ...[...keys].sort((a, b) => a - b)]) {
            for (const report of imageReports(images[key === null ? 0 : key + 1], key)) {
                if (!current()) return;
                const count = await this.device.write(report);
                if (count !== report.length) throw deviceError('transfer-incomplete', 'GALLEON image transfer was incomplete. Reconnect the device.');
            }
        }
    }
    async close() { await this.device.close(); }
}

module.exports = { HidOutput, imageReports };
