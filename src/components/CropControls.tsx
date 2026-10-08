import { getCropTransform, DEFAULT_CROP, type CropSettings, type ImageSize } from '@/lib/gifCrop';
import { GALLEON_CANVAS } from '@/lib/layouts';
import { useMessages } from '@/i18n/context';
import { ResetIcon } from './Icons';

interface Props {
    source: ImageSize;
    value: CropSettings;
    onChange: (crop: CropSettings) => void;
    disabled: boolean;
}

/** Fit mode, zoom and pan; every control maps 1:1 onto the exported crop. */
export default function CropControls({ source, value, onChange, disabled }: Props) {
    const t = useMessages().crop;
    const transform = getCropTransform(source, GALLEON_CANVAS, value);
    const update = (patch: Partial<CropSettings>) => onChange({ ...value, ...patch });
    const isDefault = value.zoom === 1 && value.panX === 0 && value.panY === 0;

    return (
        <section className="panel-section" aria-labelledby="crop-title">
            <header className="section-header">
                <h2 id="crop-title">{t.title}</h2>
                <button type="button" className="icon-button" onClick={() => onChange({ ...DEFAULT_CROP, fit: value.fit })}
                    disabled={disabled || isDefault} title={t.resetTitle} aria-label={t.reset}>
                    <ResetIcon />
                </button>
            </header>
            <fieldset className="plain-fieldset" disabled={disabled}>
                <legend className="sr-only">{t.legend}</legend>
                <div className="segmented" role="group" aria-label={t.fitGroup}>
                    <button type="button" aria-pressed={value.fit === 'cover'} onClick={() => onChange({ ...DEFAULT_CROP, fit: 'cover' })}>{t.cover}</button>
                    <button type="button" aria-pressed={value.fit === 'contain'} onClick={() => onChange({ ...DEFAULT_CROP, fit: 'contain' })}>{t.contain}</button>
                </div>
                <div className="slider-row">
                    <label htmlFor="crop-zoom">{t.zoom}</label>
                    <input id="crop-zoom" type="range" min="1" max="4" step="0.01" value={value.zoom}
                        onChange={event => update({ zoom: Number(event.target.value) })} />
                    <output htmlFor="crop-zoom">{Math.round(value.zoom * 100)}%</output>
                </div>
                <div className="slider-row">
                    <label htmlFor="crop-pan-x">{t.panX}</label>
                    <input id="crop-pan-x" type="range" min="-1" max="1" step="0.01" value={value.panX}
                        disabled={disabled || transform.rangeX < 0.001} onChange={event => update({ panX: Number(event.target.value) })} />
                    <output htmlFor="crop-pan-x">{Math.round(value.panX * 100)}</output>
                </div>
                <div className="slider-row">
                    <label htmlFor="crop-pan-y">{t.panY}</label>
                    <input id="crop-pan-y" type="range" min="-1" max="1" step="0.01" value={value.panY}
                        disabled={disabled || transform.rangeY < 0.001} onChange={event => update({ panY: Number(event.target.value) })} />
                    <output htmlFor="crop-pan-y">{Math.round(value.panY * 100)}</output>
                </div>
            </fieldset>
            <p className="hint">{t.hint}</p>
        </section>
    );
}
