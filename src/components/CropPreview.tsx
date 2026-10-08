import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { getCropTransform, type CropSettings, type ImageSize } from '@/lib/gifCrop';
import { GALLEON_CANVAS, GALLEON_GAP, GALLEON_VISIBLE_REGIONS } from '@/lib/layouts';
import type { MediaKind } from '@/lib/media';
import { useMessages } from '@/i18n/context';

export interface PreviewSource extends ImageSize {
    url: string;
    kind: MediaKind;
}

interface Props {
    source: PreviewSource;
    value: CropSettings;
    onChange: (crop: CropSettings) => void;
    disabled: boolean;
    playing: boolean;
    onPlaybackBlocked: () => void;
    hardwarePreview: boolean;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const { width: CANVAS_W, height: CANVAS_H } = GALLEON_CANVAS;
const percent = (value: number, total: number) => `${value / total * 100}%`;
// The outer rectangle overdraws by 4 units so no sub-pixel sliver shows at the edges.
const MASK_PATH = [`M-4 -4H${CANVAS_W + 4}V${CANVAS_H + 4}H-4Z`, ...GALLEON_VISIBLE_REGIONS.map(
    ({ x, y, width, height }) => `M${x} ${y}h${width}v${height}h${-width}Z`
)].join(' ');

/** Animated 720×1280 preview. Mask and guides are preview-only and never exported. */
export default function CropPreview({ source, value, onChange, disabled, playing, onPlaybackBlocked, hardwarePreview }: Props) {
    const t = useMessages().canvas;
    const transform = getCropTransform(source, GALLEON_CANVAS, value);
    const videoRef = useRef<HTMLVideoElement>(null);
    const drag = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number; pixelsPerUnit: number } | null>(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (disabled || !playing) video.pause();
        else void video.play().catch(onPlaybackBlocked);
    }, [disabled, playing, source.url, onPlaybackBlocked]);

    const mediaStyle = {
        left: percent(transform.x, CANVAS_W), top: percent(transform.y, CANVAS_H),
        width: percent(transform.width, CANVAS_W), height: percent(transform.height, CANVAS_H),
    };
    const update = (patch: Partial<CropSettings>) => onChange({ ...value, ...patch });
    const pan = (axis: 'panX' | 'panY', range: number, pixels: number) =>
        range ? clamp(value[axis] + pixels / range, -1, 1) : 0;

    const startDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (disabled || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
            pointerId: event.pointerId, x: event.clientX, y: event.clientY,
            panX: value.panX, panY: value.panY,
            pixelsPerUnit: CANVAS_W / event.currentTarget.getBoundingClientRect().width,
        };
    };

    const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (disabled || !start || start.pointerId !== event.pointerId) return;
        update({
            panX: transform.rangeX ? clamp(start.panX + (event.clientX - start.x) * start.pixelsPerUnit / transform.rangeX, -1, 1) : 0,
            panY: transform.rangeY ? clamp(start.panY + (event.clientY - start.y) * start.pixelsPerUnit / transform.rangeY, -1, 1) : 0,
        });
    };

    // Scroll to zoom, like an image editor; the window itself never scrolls.
    const zoomWheel = (event: WheelEvent<HTMLDivElement>) => {
        if (disabled || event.deltaY === 0) return;
        update({ zoom: Math.round(clamp(value.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), 1, 4) * 100) / 100 });
    };

    // Arrow keys nudge 8 output pixels (Shift: 40); +/- zoom; 0 restores 100 %.
    const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled) return;
        const step = event.shiftKey ? 40 : 8;
        const actions: Record<string, () => Partial<CropSettings>> = {
            ArrowLeft: () => ({ panX: pan('panX', transform.rangeX, -step) }),
            ArrowRight: () => ({ panX: pan('panX', transform.rangeX, step) }),
            ArrowUp: () => ({ panY: pan('panY', transform.rangeY, -step) }),
            ArrowDown: () => ({ panY: pan('panY', transform.rangeY, step) }),
            '+': () => ({ zoom: clamp(value.zoom + 0.1, 1, 4) }),
            '=': () => ({ zoom: clamp(value.zoom + 0.1, 1, 4) }),
            '-': () => ({ zoom: clamp(value.zoom - 0.1, 1, 4) }),
            '0': () => ({ zoom: 1 }),
        };
        const action = actions[event.key];
        if (!action) return;
        event.preventDefault();
        update(action());
    };

    return (
        <div
            className={`crop-preview${disabled ? ' is-disabled' : ''}`}
            role="application"
            aria-roledescription={t.roleDescription}
            aria-label={t.previewLabel}
            tabIndex={0}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onLostPointerCapture={() => { drag.current = null; }}
            onWheel={zoomWheel}
            onKeyDown={nudge}
        >
            {source.kind === 'webm' ? (
                <video ref={videoRef} src={source.url} aria-label={t.videoLabel} autoPlay muted loop playsInline style={mediaStyle} />
            ) : (
                <img src={source.url} alt={t.imageAlt} draggable={false} style={mediaStyle} />
            )}
            {hardwarePreview ? (
                <svg className="crop-hardware-mask" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} preserveAspectRatio="none" aria-hidden="true">
                    <path d={MASK_PATH} fill="black" fillRule="evenodd" />
                </svg>
            ) : (
                <div className="crop-guides" aria-hidden="true">
                    {GALLEON_VISIBLE_REGIONS.map(region => (
                        <div key={region.name} className={`crop-region${region.row >= 0 ? ' crop-key-region' : ''}`} style={{
                            left: percent(region.x, CANVAS_W), top: percent(region.y, CANVAS_H),
                            width: percent(region.width, CANVAS_W), height: percent(region.height, CANVAS_H),
                        }}>
                            <span>{region.row >= 0 ? region.row * 3 + region.col + 1 : t.screenGuide(region.width, region.height)}</span>
                        </div>
                    ))}
                    <div className="crop-gap" style={{ top: percent(GALLEON_GAP.y, CANVAS_H), height: percent(GALLEON_GAP.height, CANVAS_H) }}>
                        <span>{t.gapGuide}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
