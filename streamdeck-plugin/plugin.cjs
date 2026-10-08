/* eslint-disable @typescript-eslint/no-require-imports */
const { ScreenPlayer } = require('./player.cjs');
const { SyncPlayer } = require('./sync-player.cjs');
const { keyActionUUID } = require('../src/lib/screenPlayer.json');

const args = new Map();
for (let i = 2; i < process.argv.length - 1; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const port = Number(args.get('-port'));
if (!Number.isInteger(port) || port < 1 || port > 65535 || !args.get('-pluginUUID') || args.get('-registerEvent') !== 'registerPlugin') {
    throw new Error('Launch GALLEON Screen Player from Stream Deck.');
}

const socket = new WebSocket(`ws://127.0.0.1:${port}`);
const send = message => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};
const player = new ScreenPlayer(send, { ready: () => socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 1024 * 1024 });
const synced = new SyncPlayer(send);
const devices = new Map((JSON.parse(args.get('-info') || '{}').devices || []).map(device => [device.id, device.type]));
socket.addEventListener('open', () => socket.send(JSON.stringify({ event: args.get('-registerEvent'), uuid: args.get('-pluginUUID') })));
socket.addEventListener('message', event => {
    try {
        const message = JSON.parse(event.data);
        if (message.event === 'deviceDidConnect' || message.event === 'deviceDidChange') devices.set(message.device, message.deviceInfo.type);
        player.handle(message);
        if (message.action === keyActionUUID && ['willAppear', 'didReceiveSettings'].includes(message.event) && devices.get(message.device) !== 12) {
            send({ event: 'showAlert', context: message.context });
            return;
        }
        synced.handle(message);
        if (message.event === 'deviceDidDisconnect') devices.delete(message.device);
    }
    catch { console.error('GALLEON Screen Player: invalid event.'); }
});
const stop = () => { player.close(); void synced.close(); };
socket.addEventListener('close', () => { stop(); process.exitCode = 0; });
socket.addEventListener('error', () => { stop(); console.error('GALLEON Screen Player: Stream Deck connection closed.'); socket.close(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); socket.close(); });
