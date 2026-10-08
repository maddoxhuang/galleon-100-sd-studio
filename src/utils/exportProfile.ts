import JSZip from 'jszip';
import type { TileData } from './gifOutputs';
import { GALLEON_CANVAS, GALLEON_KEY_REGIONS, GALLEON_KEY_SIZE, GALLEON_SCREEN_REGION } from '../lib/layouts';
import screenPlayer from '../lib/screenPlayer.json';

/** GALLEON 100 SD model code, verified against Stream Deck's bundled Galleon100SD_winDefault profile. */
const DEVICE_MODEL = 'GRETSCH';

// Keep animation data portable without depending on paths on the export machine.
const toBase64 = (bytes: Uint8Array): string => {
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    }
    return btoa(chunks.join(''));
};

/** Generate a UUID v4 */
const uuidv4 = (): string =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });

// Native GALLEON default profile: Action Trigger entries are ordered
// counter-clockwise / press / clockwise. PageIndex is zero-based.
const createPageDial = () => ({
    ActionID: uuidv4(), LinkedTitle: true, Name: 'Action Trigger',
    Plugin: { Name: 'Keys', UUID: 'com.elgato.streamdeck.keys', Version: '1.0' },
    Resources: null, Settings: {}, State: 0, States: [{}],
    UUID: 'com.elgato.streamdeck.keys.adaptor',
    Actions: [
        ['previous', 'Previous Page'], ['goto', 'Go to Page'], ['next', 'Next Page'],
    ].map(([command, name]) => ({
        ActionID: uuidv4(), LinkedTitle: true, Name: name,
        Plugin: { Name: 'Pages', UUID: 'com.elgato.streamdeck.page', Version: '1.0' },
        Resources: null, Settings: command === 'goto' ? { PageIndex: 0 } : {},
        State: 0, States: [{}], UUID: `com.elgato.streamdeck.page.${command}`,
    })),
});

const findOne = (tiles: TileData[], match: (tile: TileData) => boolean, width: number, height: number, label: string) => {
    const matches = tiles.filter(match);
    const tile = matches[0];
    if (matches.length !== 1 || tile.width !== width || tile.height !== height || !tile.buffer.length) {
        throw new Error(`GALLEON profile requires one ${width}×${height} ${label}.`);
    }
    return tile;
};

/**
 * Generates a GALLEON 100 SD `.streamDeckProfile` (Stream Deck v7 format).
 * Structure:
 *   package.json
 *   Profiles/{PROFILE_UUID}.sdProfile/
 *     manifest.json           (profile metadata: device, name, pages list)
 *     Profiles/
 *       {PAGE_UUID}/
 *         manifest.json       (Controllers: Keypad + Encoder)
 *         Images/             (keys.gif, screen.gif and key_01..12.gif)
 */
export const exportStreamDeckProfile = async (
    tiles: TileData[],
    profileName: string = 'GALLEON 100 SD Background',
    functionsPageName: string = 'Functions',
): Promise<Blob> => {
    const zip = new JSZip();

    const profileUUID      = uuidv4().toUpperCase();
    const pageUUID         = uuidv4();               // lowercase in Pages array
    const emptyPageUUID    = uuidv4();               // used as Default page
    const controlsPageUUID = uuidv4();
    const deviceUUID       = uuidv4();               // placeholder device UUID

    const profileDir = `Profiles/${profileUUID}.sdProfile`;
    const pageDir    = `${profileDir}/Profiles/${pageUUID.toUpperCase()}`;
    const masterTile = findOne(tiles, tile => tile.name === 'keys', GALLEON_CANVAS.width, GALLEON_CANVAS.height, 'keys.gif');

    // One synchronized player action per key; key 1 carries the complete master.
    const actions: Record<string, object> = {};
    for (const region of GALLEON_KEY_REGIONS) {
        const tile = findOne(tiles, tile => tile.row === region.row && tile.col === region.col,
            GALLEON_KEY_SIZE, GALLEON_KEY_SIZE, `GIF for key ${region.row * 3 + region.col + 1}`);
        const key = region.row * 3 + region.col;
        actions[`${region.col},${region.row}`] = {                   // Elgato format: "col,row"
            ActionID: uuidv4(),
            LinkedTitle: false,
            Name: '',
            Plugin: { Name: 'GALLEON Screen Player', UUID: screenPlayer.pluginUUID, Version: screenPlayer.version },
            Resources: null,
            Settings: { animationId: profileUUID, key, ...(key === 0 ? { masterGif: toBase64(masterTile.buffer) } : {}) },
            State: 0,
            States: [{ ShowTitle: false, Title: '' }],
            UUID: screenPlayer.keyActionUUID,
        };
        zip.file(`${pageDir}/Images/key_${String(key + 1).padStart(2, '0')}.gif`, tile.buffer, { binary: true });
    }

    // The synchronized plugin owns all moving pixels. Native custom GIF icons
    // would start independent clocks and overwrite the hardware frames.
    // Keep the master/screen backgrounds as static fallbacks only.
    const controllers = ([
        ['keys', 'Keypad', GALLEON_CANVAS.width, GALLEON_CANVAS.height],
        ['screen', 'Encoder', GALLEON_SCREEN_REGION.width, GALLEON_SCREEN_REGION.height],
    ] as const).map(([name, type, width, height]) => {
        const tile = findOne(tiles, tile => tile.name === name, width, height, `${name}.gif`);
        const background = `Images/${name}.gif`;
        zip.file(`${pageDir}/${background}`, tile.buffer, { binary: true });
        return { Actions: type === 'Keypad' ? actions : { '0,0': createPageDial() }, Background: background, Type: type };
    });

    zip.file(`${pageDir}/manifest.json`, JSON.stringify({ Controllers: controllers, Icon: '', Name: profileName }));

    // A separate functional page keeps all twelve animation keys intact.
    // Its matching native dial lets the user get back without reserving a key.
    zip.file(`${profileDir}/Profiles/${controlsPageUUID.toUpperCase()}/manifest.json`, JSON.stringify({
        Controllers: [
            { Actions: null, Type: 'Keypad' },
            { Actions: { '0,0': createPageDial() }, Type: 'Encoder' },
        ],
        Icon: '', Name: functionsPageName,
    }));

    // --- Empty default page (required by the format) ---
    zip.file(`${profileDir}/Profiles/${emptyPageUUID.toUpperCase()}/manifest.json`, JSON.stringify({
        Controllers: [{ Actions: null, Type: 'Keypad' }, { Actions: { '0,0': createPageDial() }, Type: 'Encoder' }],
        Icon: '',
        Name: '',
    }));

    // --- Profile-level manifest ---
    zip.file(`${profileDir}/manifest.json`, JSON.stringify({
        Device: { Model: DEVICE_MODEL, UUID: deviceUUID },
        Name: profileName,
        Pages: { Current: pageUUID, Default: emptyPageUUID, Pages: [pageUUID, controlsPageUUID] },
        Version: '3.0',
    }));

    // --- Root package.json (format metadata) ---
    zip.file('package.json', JSON.stringify({
        AppVersion: '7.4.0.22604',
        DeviceModel: DEVICE_MODEL,
        DeviceSettings: null,
        FormatVersion: 1,
        OSType: 'Windows',
        OSVersion: '10.0.26200',
        RequiredPlugins: [screenPlayer.pluginUUID, 'com.elgato.streamdeck.keys', 'com.elgato.streamdeck.page'],
    }));

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
};
