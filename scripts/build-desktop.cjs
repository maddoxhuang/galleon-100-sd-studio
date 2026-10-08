/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');
const screenPlayer = require('../src/lib/screenPlayer.json');

const root = path.resolve(__dirname, '..');
const output = path.resolve(root, 'build', 'desktop');
const webOutput = path.join(output, 'web');

async function writeLicenses(inputs) {
    const packages = new Map();
    for (const input of Object.keys(inputs)) {
        if (!input.replaceAll('\\', '/').includes('node_modules/')) continue;
        let directory = path.dirname(path.resolve(root, input));
        while (directory !== root && directory !== path.dirname(directory)) {
            try {
                const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
                if (metadata.name) packages.set(directory, metadata);
                break;
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                directory = path.dirname(directory);
            }
        }
    }
    const notices = [];
    for (const [directory, metadata] of [...packages].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
        const files = (await fs.readdir(directory, { withFileTypes: true }))
            .filter(entry => entry.isFile() && /^(licen[cs]e|copying|notice|unlicense)([.-]|$)/i.test(entry.name));
        notices.push(`${metadata.name} ${metadata.version}\nDeclared license: ${metadata.license || 'See package notices'}`);
        for (const file of files) notices.push(await fs.readFile(path.join(directory, file.name), 'utf8'));
    }
    await fs.writeFile(path.join(output, 'THIRD-PARTY-LICENSES.txt'), notices.join('\n\n'), 'utf8');
}

async function main() {
    // Never clean the source tree, plugin output, or an arbitrary supplied path.
    if (path.relative(root, output) !== path.join('build', 'desktop')) throw new Error('Invalid desktop build directory.');
    const buildParent = path.dirname(output);
    await fs.mkdir(buildParent, { recursive: true });
    if (await fs.realpath(buildParent) !== path.join(await fs.realpath(root), 'build')) throw new Error('Desktop build parent must not be a symlink.');
    try {
        if ((await fs.lstat(output)).isSymbolicLink()) throw new Error('Desktop build directory must not be a symlink.');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    await fs.rm(output, { recursive: true, force: true });
    await fs.mkdir(webOutput, { recursive: true });
    // public/plugins also keeps older plugin builds; bundle only the current one.
    const bundledPlugins = new Set([screenPlayer.download, screenPlayer.data].map(url => path.posix.basename(url)));
    await fs.cp(path.join(root, 'public'), webOutput, {
        recursive: true,
        filter: source => path.basename(path.dirname(source)) !== 'plugins' || bundledPlugins.has(path.basename(source)),
    });
    for (const file of ['main.cjs', 'protocol.cjs', 'settings.cjs', 'icon.ico']) {
        await fs.copyFile(path.join(root, 'desktop', file), path.join(output, file));
    }
    await fs.copyFile(path.join(root, 'desktop', 'index.html'), path.join(webOutput, 'index.html'));
    await fs.copyFile(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'));

    // CSS imported by the renderer is emitted beside it as renderer.css.
    const result = await esbuild.build({
        absWorkingDir: root,
        entryPoints: ['desktop/renderer.tsx'],
        outfile: path.join(webOutput, 'renderer.js'),
        bundle: true,
        platform: 'browser',
        target: 'chrome130',
        format: 'iife',
        minify: true,
        legalComments: 'eof',
        metafile: true,
        plugins: [{
            name: 'gif-encoder-strict-mode',
            setup(build) {
                build.onLoad({ filter: /[\\/]gif-encoder-2[\\/]src[\\/]LZWEncoder\.js$/ }, async args => {
                    const source = await fs.readFile(args.path, 'utf8');
                    const constructor = 'function LZWEncoder(width, height, pixels, colorDepth) {';
                    if (!source.includes(constructor)) throw new Error('Unsupported gif-encoder-2 LZWEncoder source.');
                    // v1.0.5 assigns these without declarations. Keep them per
                    // encoder instance so the browser bundle works in strict mode.
                    return { contents: source.replace(constructor, `${constructor}\n  var remaining, curPixel, n_bits`), loader: 'js' };
                });
            },
        }],
        alias: { stream: 'stream-browserify', events: 'events', buffer: 'buffer', process: 'process/browser' },
        inject: [path.join(root, 'desktop', 'browser-shims.ts')],
        define: {
            'process.env.NODE_ENV': '"production"',
            global: 'globalThis',
        },
    });
    await writeLicenses(result.metafile.inputs);
    const project = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    await fs.writeFile(path.join(output, 'package.json'), `${JSON.stringify({
        name: 'sd100-desktop',
        productName: 'SD100 Studio',
        version: project.version,
        description: 'Offline GIF and WebM animated backgrounds for the Corsair GALLEON 100 SD',
        author: 'SD100 contributors; based on Stream-Deck-BG by Sebastian Sperandio',
        license: 'MIT',
        main: 'main.cjs',
        private: true,
    }, null, 2)}\n`, 'utf8');
    console.log(`Desktop application built: ${output}`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
