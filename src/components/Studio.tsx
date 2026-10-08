import { useCallback, useEffect, useEffectEvent, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent } from 'react';
import { processGif } from '@/utils/processGif';
import { processWebm, type VideoProgress } from '@/utils/processWebm';
import { loadVideo } from '@/utils/videoSource';
import { createTilesZip } from '@/utils/createZip';
import { exportStreamDeckProfile } from '@/utils/exportProfile';
import { DEFAULT_WEBM_FPS, MediaError, WEBM_FRAME_RATES, getMediaKind, type MediaKind } from '@/lib/media';
import { DEFAULT_CROP, type CropSettings } from '@/lib/gifCrop';
import { GALLEON_CANVAS } from '@/lib/layouts';
import screenPlayer from '@/lib/screenPlayer.json';
import { HTML_LANG, LANGUAGES, LANGUAGE_ENDPOINT, MESSAGES, languageFromTag, type Language, type NoticeKey } from '@/i18n/messages';
import { MessagesContext } from '@/i18n/context';
import CropPreview from './CropPreview';
import CropControls from './CropControls';
import ExportPanel, { type ExportResults } from './ExportPanel';
import {
    AlertIcon, CloseIcon, FilmIcon, FolderOpenIcon, GalleonMark, GlobeIcon, ImageIcon, NewIcon, PauseIcon, PlayIcon, SampleIcon,
} from './Icons';

const SAMPLE = { url: '/sample/sample_720x1280.gif', name: 'sample_720x1280.gif' };
const ACCEPT = '.gif,.webm,image/gif,video/webm';

type SourceImage = { file: File; url: string; kind: MediaKind; width: number; height: number; duration?: number };
// Notices keep a message key, so switching the language also translates an open notice.
type Notice = { tone: 'error' | 'info'; key: NoticeKey };

const formatSize = (bytes: number) => bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const settingsKey = (source: SourceImage | null, crop: CropSettings, fps: number) =>
    source ? [source.url, crop.fit, crop.zoom, crop.panX, crop.panY, source.kind === 'webm' ? fps : ''].join('|') : '';

const revokeResults = (results: ExportResults) => {
    for (const url of [results.zipUrl, results.profileUrl, ...results.backgrounds.map(file => file.url)]) {
        URL.revokeObjectURL(url);
    }
};

export default function Studio() {
    // main.cjs serves the page with the saved language in <html lang>.
    const [language, setLanguage] = useState<Language>(() => languageFromTag(document.documentElement.lang));
    const [file, setFile] = useState<File | null>(null);
    const [sourceImage, setSourceImage] = useState<SourceImage | null>(null);
    // Tracked apart from the dismissible notice, so closing the error does not look like loading.
    const [loadFailed, setLoadFailed] = useState(false);
    const [videoFps, setVideoFps] = useState<number>(DEFAULT_WEBM_FPS);
    const [videoProgress, setVideoProgress] = useState<VideoProgress | null>(null);
    const [crop, setCrop] = useState<CropSettings>({ ...DEFAULT_CROP });
    const [notice, setNotice] = useState<Notice | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [playing, setPlaying] = useState(true);
    const [hardwarePreview, setHardwarePreview] = useState(false);
    const [results, setResults] = useState<(ExportResults & { key: string }) | null>(null);
    const [pluginUrl, setPluginUrl] = useState('');
    const [pluginDownloadFailed, setPluginDownloadFailed] = useState(false);
    const [isDownloadingPlugin, setIsDownloadingPlugin] = useState(false);
    const processingAbort = useRef<AbortController | null>(null);
    const pluginDownloadAbort = useRef<AbortController | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepth = useRef(0);

    const t = MESSAGES[language];
    const isLoading = Boolean(file && !sourceImage && !loadFailed);
    const currentKey = settingsKey(sourceImage, crop, videoFps);
    const canGenerate = Boolean(file && sourceImage?.file === file);

    // Decode just enough of the chosen file for the preview and its dimensions.
    useEffect(() => {
        if (!file) return;
        const kind = getMediaKind(file);
        if (!kind) return;
        const url = URL.createObjectURL(file);
        const controller = new AbortController();
        let cancelled = false;
        const img = kind === 'gif' ? new Image() : null;
        if (img) {
            img.onload = () => {
                if (!cancelled) setSourceImage({ file, url, kind, width: img.naturalWidth, height: img.naturalHeight });
            };
            img.onerror = () => {
                if (cancelled) return;
                setLoadFailed(true);
                setNotice({ tone: 'error', key: 'gif-unreadable' });
            };
            img.src = url;
        } else {
            void loadVideo(url, controller.signal).then(source => {
                if (!cancelled) setSourceImage({ file, url, kind, width: source.width, height: source.height, duration: source.duration });
                source.dispose();
            }).catch(error => {
                if (cancelled) return;
                setLoadFailed(true);
                setNotice({ tone: 'error', key: error instanceof MediaError ? error.code : 'webm-unreadable' });
            });
        }
        return () => {
            cancelled = true;
            controller.abort();
            if (img) { img.onload = null; img.onerror = null; }
            URL.revokeObjectURL(url);
        };
    }, [file]);

    useEffect(() => () => { processingAbort.current?.abort(); pluginDownloadAbort.current?.abort(); }, []);
    useEffect(() => () => { if (results) revokeResults(results); }, [results]);
    useEffect(() => () => { if (pluginUrl) URL.revokeObjectURL(pluginUrl); }, [pluginUrl]);

    const changeLanguage = (next: Language) => {
        setLanguage(next);
        document.documentElement.lang = HTML_LANG[next];
        // Saved by the main process for its save dialogs and the next start.
        void fetch(LANGUAGE_ENDPOINT, { method: 'PUT', body: next }).catch(() => {});
    };

    const selectFile = (selected: File) => {
        if (isProcessing) return;
        // Reject unsupported files before touching the current source, crop or unsaved outputs.
        if (!getMediaKind(selected)) {
            setNotice({ tone: 'error', key: 'unsupported-file' });
            return;
        }
        setNotice(null);
        setLoadFailed(false);
        setSourceImage(null);
        setResults(null);
        setCrop({ ...DEFAULT_CROP });
        setVideoProgress(null);
        setPlaying(true);
        setFile(selected);
    };

    const openFilePicker = () => {
        if (!isProcessing) fileInputRef.current?.click();
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const selected = event.target.files?.[0];
        // Clear the value so choosing the same file again still reloads it.
        event.target.value = '';
        if (selected) selectFile(selected);
    };

    const loadSample = async () => {
        if (isProcessing) return;
        try {
            const response = await fetch(SAMPLE.url);
            if (!response.ok) throw new Error(response.statusText);
            selectFile(new File([await response.blob()], SAMPLE.name, { type: 'image/gif' }));
        } catch {
            setNotice({ tone: 'error', key: 'sample-failed' });
        }
    };

    const reset = () => {
        if (isProcessing) return;
        setFile(null);
        setLoadFailed(false);
        setSourceImage(null);
        setResults(null);
        setCrop({ ...DEFAULT_CROP });
        setVideoProgress(null);
        setNotice(null);
        setPlaying(true);
    };

    const cancelProcessing = () => processingAbort.current?.abort();

    const generate = async () => {
        if (isProcessing) return;
        if (!file || sourceImage?.file !== file) {
            setNotice({ tone: 'error', key: 'open-first' });
            return;
        }
        setIsProcessing(true);
        setVideoProgress(null);
        setNotice(null);
        const controller = new AbortController();
        processingAbort.current = controller;
        const key = currentKey;
        try {
            // Both input formats use the same crop and animated GIF outputs.
            const tiles = sourceImage.kind === 'webm'
                ? await processWebm(file, crop, { fps: videoFps, signal: controller.signal, onProgress: setVideoProgress })
                : await processGif(file, crop);
            controller.signal.throwIfAborted();
            const backgrounds = tiles.filter(tile => tile.row < 0);
            const zip = await createTilesZip(backgrounds);
            controller.signal.throwIfAborted();
            // The 12 key GIFs are only delivered inside the profile.
            const profile = await exportStreamDeckProfile(tiles, t.profile.name, t.profile.functionsPage);
            controller.signal.throwIfAborted();
            setResults({
                key,
                backgrounds: backgrounds.map(tile => ({
                    name: `${tile.name}.gif`,
                    url: URL.createObjectURL(new Blob([new Uint8Array(tile.buffer)], { type: 'image/gif' })),
                    width: tile.width,
                    height: tile.height,
                })),
                zipUrl: URL.createObjectURL(zip),
                profileUrl: URL.createObjectURL(profile),
            });
        } catch (err: unknown) {
            if (controller.signal.aborted) {
                setNotice({ tone: 'info', key: 'cancelled' });
                return;
            }
            console.error(err);
            setNotice({ tone: 'error', key: err instanceof MediaError ? err.code : 'generate-failed' });
        } finally {
            processingAbort.current = null;
            setIsProcessing(false);
        }
    };

    // The installer is served as JSON so it can be saved like the generated Blobs.
    const downloadScreenPlugin = async (event: MouseEvent<HTMLAnchorElement>) => {
        if (pluginUrl) return;
        event.preventDefault();
        if (pluginDownloadAbort.current) return;
        const controller = new AbortController();
        pluginDownloadAbort.current = controller;
        setIsDownloadingPlugin(true);
        setPluginDownloadFailed(false);
        try {
            const response = await fetch(screenPlayer.data, { signal: controller.signal });
            if (!response.ok) throw new Error('Plugin data could not be read.');
            const { size, base64 } = await response.json();
            if (typeof base64 !== 'string' || !Number.isSafeInteger(size) || size <= 0) throw new Error('Plugin data is incomplete.');
            const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
            if (bytes.length !== size || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('Plugin data is incomplete.');
            controller.signal.throwIfAborted();
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
            setPluginUrl(url);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = screenPlayer.filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        } catch {
            if (!controller.signal.aborted) setPluginDownloadFailed(true);
        } finally {
            if (pluginDownloadAbort.current === controller) {
                pluginDownloadAbort.current = null;
                setIsDownloadingPlugin(false);
            }
        }
    };

    // The window has no menu bar, so the shortcuts shown in the toolbar tooltips live here.
    const handleKey = useEffectEvent((event: KeyboardEvent) => {
        if (event.key === 'Escape' && isProcessing) {
            cancelProcessing();
            return;
        }
        if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
        const key = event.key.toLowerCase();
        if (key === 'o') {
            event.preventDefault();
            openFilePicker();
        } else if (key === 'n') {
            event.preventDefault();
            reset();
        }
    });
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => handleKey(event);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
    const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current += 1;
        if (!isProcessing) setIsDragOver(true);
    };
    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = isProcessing ? 'none' : 'copy';
    };
    const handleDragLeave = () => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setIsDragOver(false);
    };
    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepth.current = 0;
        setIsDragOver(false);
        const dropped = event.dataTransfer.files?.[0];
        if (dropped) selectFile(dropped);
    };

    const onPlaybackBlocked = useCallback(() => setPlaying(false), []);

    const resultsStale = Boolean(results && results.key !== currentKey);
    const status = isProcessing
        ? (sourceImage?.kind === 'webm' && videoProgress ? t.status.converting(videoProgress.completed, videoProgress.total) : t.status.processing)
        : isLoading ? t.status.loading
        : notice?.tone === 'error' ? t.status.error
        : results && !resultsStale ? t.status.done
        : sourceImage ? t.status.ready
        : t.status.empty;

    return (
        <MessagesContext.Provider value={t}>
            <div className="studio" onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
                <header className="toolbar">
                    <div className="brand">
                        <GalleonMark size={22} className="brand-mark" />
                        <h1 className="brand-name">SD100 Studio</h1>
                    </div>
                    <div className="toolbar-group" role="toolbar" aria-label={t.toolbar.label}>
                        <button type="button" className="tool-button" onClick={openFilePicker} disabled={isProcessing} title={t.toolbar.openTitle}>
                            <FolderOpenIcon />{t.toolbar.open}
                        </button>
                        <button type="button" className="tool-button" onClick={() => void loadSample()} disabled={isProcessing} title={t.toolbar.sampleTitle}>
                            <SampleIcon />{t.toolbar.sample}
                        </button>
                        <button type="button" className="tool-button" onClick={reset} disabled={isProcessing || (!file && !notice)} title={t.toolbar.newTitle}>
                            <NewIcon />{t.toolbar.new}
                        </button>
                    </div>
                    <div className="toolbar-spacer" />
                    <span className="device-chip"><GalleonMark size={14} />CORSAIR GALLEON 100 SD</span>
                    <label className="language-picker" title={t.toolbar.language}>
                        <GlobeIcon />
                        <select id="language" aria-label={t.toolbar.language} value={language}
                            onChange={event => changeLanguage(event.target.value as Language)}>
                            {LANGUAGES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </select>
                    </label>
                    <input type="file" id="gif_file" className="visually-hidden-input" accept={ACCEPT} tabIndex={-1} aria-hidden="true"
                        ref={fileInputRef} onChange={handleFileChange} disabled={isProcessing} />
                </header>

                <div className="workspace">
                    <aside className="panel panel-left" aria-label={t.source.panel}>
                        <section className="panel-section" aria-labelledby="source-title">
                            <header className="section-header"><h2 id="source-title">{t.source.title}</h2></header>
                            {sourceImage ? (
                                <>
                                    <div className="source-card">
                                        <span className="source-icon">{sourceImage.kind === 'webm' ? <FilmIcon /> : <ImageIcon />}</span>
                                        <span className="source-text">
                                            <span className="source-name" title={sourceImage.file.name}>{sourceImage.file.name}</span>
                                            <span className="source-kind">{sourceImage.kind === 'webm' ? t.source.webm : t.source.gif} · {formatSize(sourceImage.file.size)}</span>
                                        </span>
                                    </div>
                                    <dl className="props">
                                        <dt>{t.source.originalSize}</dt><dd>{sourceImage.width}×{sourceImage.height}</dd>
                                        <dt>{t.source.outputCanvas}</dt><dd>{GALLEON_CANVAS.width}×{GALLEON_CANVAS.height}</dd>
                                        {sourceImage.duration !== undefined && <><dt>{t.source.duration}</dt><dd id="source-duration">{t.source.seconds(sourceImage.duration.toFixed(2))}</dd></>}
                                    </dl>
                                    {sourceImage.kind === 'webm' && (
                                        <fieldset className="plain-fieldset webm-options" disabled={isProcessing}>
                                            <legend className="sr-only">{t.source.webmLegend}</legend>
                                            <div className="field-row">
                                                <label htmlFor="webm-fps">{t.source.frameRate}</label>
                                                <select id="webm-fps" value={videoFps} onChange={event => setVideoFps(Number(event.target.value))}>
                                                    {WEBM_FRAME_RATES.map(fps => <option key={fps} value={fps}>{fps} fps</option>)}
                                                </select>
                                            </div>
                                            <p className="hint">{t.source.frameRateHint}</p>
                                        </fieldset>
                                    )}
                                </>
                            ) : (
                                <p className="hint">{isLoading ? t.source.loading : t.source.empty}</p>
                            )}
                        </section>
                        {sourceImage && <CropControls source={sourceImage} value={crop} onChange={setCrop} disabled={isProcessing} />}
                    </aside>

                    <main className="canvas-area" aria-label={t.canvas.label}>
                        {notice && (
                            <div id={notice.tone === 'error' ? 'error_message' : 'info_message'} className={`notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
                                {notice.tone === 'error' && <AlertIcon />}
                                <span>{t.notices[notice.key]}</span>
                                <button type="button" className="icon-button" onClick={() => setNotice(null)} aria-label={t.canvas.dismiss}><CloseIcon size={14} /></button>
                            </div>
                        )}
                        <div className="canvas-stage">
                            {sourceImage ? (
                                <CropPreview source={sourceImage} value={crop} onChange={setCrop} disabled={isProcessing}
                                    playing={playing} onPlaybackBlocked={onPlaybackBlocked} hardwarePreview={hardwarePreview} />
                            ) : isLoading ? (
                                <div className="canvas-loading" role="status"><span className="spinner" aria-hidden="true" />{t.canvas.loading}</div>
                            ) : (
                                <div id="drop_zone" className="empty-state">
                                    <GalleonMark size={72} className="empty-mark" />
                                    <h2>{t.canvas.emptyTitle}</h2>
                                    <p>{t.canvas.emptyText}</p>
                                    <div className="empty-actions">
                                        <button type="button" className="primary-button" onClick={openFilePicker}><FolderOpenIcon />{t.canvas.openFile}</button>
                                        <button type="button" className="secondary-button" onClick={() => void loadSample()}><SampleIcon />{t.toolbar.sample}</button>
                                    </div>
                                    <p className="hint">{t.canvas.emptyHint}</p>
                                </div>
                            )}
                        </div>
                        {sourceImage && (
                            <div className="canvas-toolbar" role="toolbar" aria-label={t.canvas.toolbar}>
                                {sourceImage.kind === 'webm' && (
                                    <button type="button" className="tool-button" onClick={() => setPlaying(!playing)} disabled={isProcessing}>
                                        {playing ? <PauseIcon /> : <PlayIcon />}{playing ? t.canvas.pause : t.canvas.play}
                                    </button>
                                )}
                                <label className="toggle" htmlFor="crop-hardware-preview" title={t.canvas.hardwareOnlyTitle}>
                                    <input id="crop-hardware-preview" type="checkbox" checked={hardwarePreview} onChange={event => setHardwarePreview(event.target.checked)} />
                                    {t.canvas.hardwareOnly}
                                </label>
                                <span className="toolbar-spacer" />
                                <span className="canvas-readout">{crop.fit === 'cover' ? t.canvas.fill : t.canvas.fit} · {Math.round(crop.zoom * 100)}%</span>
                            </div>
                        )}
                    </main>

                    <ExportPanel
                        canGenerate={canGenerate}
                        isProcessing={isProcessing}
                        processingKind={isProcessing ? sourceImage?.kind ?? null : null}
                        videoProgress={videoProgress}
                        onGenerate={() => void generate()}
                        onCancel={cancelProcessing}
                        results={results}
                        resultsStale={resultsStale}
                        plugin={{
                            href: pluginUrl || screenPlayer.download,
                            busy: isDownloadingPlugin,
                            failed: pluginDownloadFailed,
                            onClick: event => void downloadScreenPlugin(event),
                        }}
                    />
                </div>

                <footer className="statusbar">
                    <span className="status-text" role="status" aria-live="polite">{status}</span>
                </footer>

                {isDragOver && <div className="drop-overlay" aria-hidden="true"><div>{t.canvas.drop}</div></div>}
            </div>
        </MessagesContext.Provider>
    );
}
