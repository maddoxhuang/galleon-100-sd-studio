// Browser-only implementations required by gif-encoder-2 and readable-stream.
// These do not expose Electron, Node.js, or filesystem access to the renderer.
export { Buffer } from 'buffer';
export { default as process } from 'process';
