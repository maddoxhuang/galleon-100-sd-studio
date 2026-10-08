declare module 'gif-encoder-2' {
    export default class GIFEncoder {
        constructor(width: number, height: number);
        start(): void;
        setRepeat(repeat: number): void;
        setQuality(quality: number): void;
        setDelay(milliseconds: number): void;
        addFrame(pixels: Uint8ClampedArray | Uint8Array): void;
        finish(): void;
        out: { getData(): Uint8Array };
    }
}
