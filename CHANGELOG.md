# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-08

First release of SD100 Studio: a Windows desktop rework of [Stream Deck GIF Background Slicer](https://github.com/sebastiansperandio/Stream-Deck-BG), dedicated to the CORSAIR GALLEON 100 SD.

### Added

- Portable Windows x64 app that works fully offline, with no browser, local server or Node.js needed.
- GIF and WebM (VP8, VP9) sources of any size, with a live 720×1280 preview, *Fill & crop* / *Fit (letterbox)* framing, zoom, pan and a **Show screen and keys only** preview mask.
- WebM to GIF conversion at 10, 15, 20, 25 or 30 fps, with a progress bar and a Cancel button (Esc also cancels).
- Stream Deck profile export: the screen and all 12 keys share one timeline, the left dial navigates pages natively, and a second Functions page keeps every key free.
- `screen.gif`, `keys.gif` and `stream_deck_gifs.zip` outputs.
- Bundled sync plugin 2.0.2 (**GALLEON Screen Player** in Stream Deck), which plays the animation on the keys while the Stream Deck app does not animate key backgrounds. Its settings follow the Stream Deck app's language (English or Simplified Chinese).
- English and Simplified Chinese interface, English by default; the choice is remembered.
- Keyboard shortcuts: Ctrl+O to open a file, Ctrl+N to clear the current source and outputs, Esc to cancel a WebM conversion, and the arrow keys, +/- and 0 on the canvas for framing.

### Removed

- The web version and support for Stream Deck models other than the GALLEON 100 SD.

[1.0.0]: https://github.com/maddoxhuang/galleon-100-sd-studio/releases/tag/v1.0.0
