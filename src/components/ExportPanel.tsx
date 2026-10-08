import type { MouseEvent, ReactNode } from 'react';
import type { VideoProgress } from '@/utils/processWebm';
import screenPlayer from '@/lib/screenPlayer.json';
import { useMessages } from '@/i18n/context';
import { ArchiveIcon, CheckIcon, ClockIcon, ImageIcon, PluginIcon, ProfileIcon, SaveIcon, SparkIcon } from './Icons';

export const PROFILE_FILENAME = 'GALLEON_100_SD_Background.streamDeckProfile';
export const BACKGROUNDS_ZIP_FILENAME = 'stream_deck_gifs.zip';

export interface ExportResults {
    backgrounds: { name: string; url: string; width: number; height: number }[];
    zipUrl: string;
    profileUrl: string;
}

interface Props {
    canGenerate: boolean;
    isProcessing: boolean;
    processingKind: 'gif' | 'webm' | null;
    videoProgress: VideoProgress | null;
    onGenerate: () => void;
    onCancel: () => void;
    results: ExportResults | null;
    resultsStale: boolean;
    plugin: {
        href: string;
        busy: boolean;
        failed: boolean;
        onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
    };
}

function OutputRow({ href, download, icon, title, meta, badge }: {
    href: string; download: string; icon: ReactNode; title: string; meta: string; badge?: string;
}) {
    const t = useMessages().exportPanel;
    return (
        <a className="output-row" href={href} download={download} title={t.saveTitle(download)}>
            <span className="output-icon">{icon}</span>
            <span className="output-text">
                <span className="output-title"><span className="output-name">{title}</span>{badge && <span className="badge">{badge}</span>}</span>
                <span className="output-meta">{meta}</span>
            </span>
            <span className="output-action"><SaveIcon />{t.save}</span>
        </a>
    );
}

export default function ExportPanel({
    canGenerate, isProcessing, processingKind, videoProgress, onGenerate, onCancel, results, resultsStale, plugin,
}: Props) {
    const t = useMessages().exportPanel;
    const percent = videoProgress && videoProgress.total ? Math.round(videoProgress.completed / videoProgress.total * 100) : 0;
    const backgroundMeta = (file: ExportResults['backgrounds'][number]) =>
        (file.name === 'screen.gif' ? t.screenMeta : t.backgroundMeta)(file.width, file.height);

    return (
        <aside className="panel panel-right export-panel" aria-label={t.label}>
            <section className="panel-section" aria-labelledby="generate-title">
                <header className="section-header"><h2 id="generate-title">{t.generate}</h2></header>
                <ul className="output-plan">
                    <li><span>{t.planScreen}</span><code>720×384</code></li>
                    <li><span>{t.planBackground}</span><code>720×1280</code></li>
                    <li><span>{t.planProfile}</span><code>{t.planProfileValue}</code></li>
                </ul>
                <button type="button" className="primary-button" onClick={onGenerate} disabled={!canGenerate || isProcessing}>
                    <SparkIcon />{t.generate}
                </button>
                {isProcessing && (
                    <div className="progress-block">
                        {processingKind === 'webm' ? (
                            <>
                                <p>{videoProgress ? t.webmProgress(videoProgress.completed, videoProgress.total, percent) : t.webmReading}</p>
                                {videoProgress
                                    ? <progress aria-label={t.webmProgressLabel} value={videoProgress.completed} max={videoProgress.total} />
                                    : <progress aria-label={t.webmProgressLabel} />}
                                <button type="button" className="secondary-button" onClick={onCancel}>{t.cancel}</button>
                            </>
                        ) : (
                            <>
                                <p>{t.gifProgress}</p>
                                <progress aria-label={t.gifProgressLabel} />
                            </>
                        )}
                    </div>
                )}
            </section>

            {results && (
                <section className="panel-section" aria-labelledby="outputs-title">
                    <header className="section-header">
                        <h2 id="outputs-title">{t.outputs}</h2>
                        {resultsStale
                            ? <span className="status-chip warn"><ClockIcon size={12} />{t.stale}</span>
                            : <span className="status-chip ok"><CheckIcon size={12} />{t.current}</span>}
                    </header>
                    {resultsStale && <p className="hint warn-text">{t.staleHint}</p>}
                    <div className="output-list">
                        <OutputRow href={results.profileUrl} download={PROFILE_FILENAME} icon={<ProfileIcon />}
                            title={t.profileTitle} meta={t.profileMeta} badge={t.profileBadge} />
                        {results.backgrounds.map(file => (
                            <OutputRow key={file.name} href={file.url} download={file.name} icon={<ImageIcon />}
                                title={file.name} meta={backgroundMeta(file)} />
                        ))}
                        <OutputRow href={results.zipUrl} download={BACKGROUNDS_ZIP_FILENAME} icon={<ArchiveIcon />}
                            title={t.zipTitle} meta={BACKGROUNDS_ZIP_FILENAME} />
                    </div>
                </section>
            )}

            <section className="panel-section" aria-labelledby="install-title">
                <header className="section-header"><h2 id="install-title">{t.install}</h2></header>
                <ol className="steps">
                    {t.installSteps.map((step, index) => <li key={index}>{step}</li>)}
                </ol>
                <a className="output-row" href={plugin.href} download={screenPlayer.filename} onClick={plugin.onClick}
                    aria-disabled={plugin.busy} title={t.saveTitle(screenPlayer.filename)}>
                    <span className="output-icon"><PluginIcon /></span>
                    <span className="output-text">
                        <span className="output-title"><span className="output-name">{t.pluginTitle}</span></span>
                        <span className="output-meta">{t.pluginMeta}</span>
                    </span>
                    <span className="output-action"><SaveIcon />{plugin.busy ? t.pluginBusy : t.save}</span>
                </a>
                {plugin.failed && <p className="hint error-text" role="alert">{t.pluginError}</p>}
                <details className="tips">
                    <summary>{t.tips}</summary>
                    <ul>
                        {t.tipList.map((tip, index) => <li key={index}>{tip}</li>)}
                    </ul>
                </details>
            </section>
        </aside>
    );
}
