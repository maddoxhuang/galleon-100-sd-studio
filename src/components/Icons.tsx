import React from 'react';

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

// 16px outline icons drawn on a 24-unit grid; colour follows `currentColor`.
const icon = (paths: React.ReactNode) => function Icon({ size = 16, ...props }: IconProps) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
            {paths}
        </svg>
    );
};

export const FolderOpenIcon = icon(<path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h13.2a1.5 1.5 0 0 0 1.45-1.1L21.4 11a1 1 0 0 0-.97-1.25H8.1a1.5 1.5 0 0 0-1.43 1.04L4.5 17.5M3 7.5V6a1.5 1.5 0 0 1 1.5-1.5h4.1l2 2.25h6.9A1.5 1.5 0 0 1 19 8.25v1.5" />);
export const SampleIcon = icon(<><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><circle cx="9" cy="9" r="1.8" /><path d="m20.5 15.5-5-5-9 9" /></>);
export const NewIcon = icon(<><path d="M14 3.5H6.5a1.5 1.5 0 0 0-1.5 1.5v14a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V8.5Z" /><path d="M14 3.5v5h5M12 11.5v6M9 14.5h6" /></>);
export const PlayIcon = icon(<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8Z" />);
export const PauseIcon = icon(<><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></>);
export const ResetIcon = icon(<><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3.5 3.5V8H8" /></>);
export const SaveIcon = icon(<><path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5" /><path d="M4 16.5v2A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-2" /></>);
export const ArchiveIcon = icon(<><rect x="3.5" y="4" width="17" height="4.5" rx="1" /><path d="M5 8.5v10A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-10M10 12.5h4" /></>);
export const ImageIcon = icon(<><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="m3.5 16 5-5 4 4 2.5-2.5 5 5" /></>);
export const FilmIcon = icon(<><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4" /></>);
export const ProfileIcon = icon(<><rect x="5" y="2.5" width="14" height="19" rx="2" /><path d="M5 9h14" /><path d="M8.5 12.5h1.5M11.25 12.5h1.5M14 12.5h1.5M8.5 16h1.5M11.25 16h1.5M14 16h1.5" /></>);
export const PluginIcon = icon(<><path d="M9 3.5v4M15 3.5v4" /><path d="M6.5 7.5h11v3.5a5.5 5.5 0 0 1-11 0Z" /><path d="M12 16.5v4" /></>);
export const AlertIcon = icon(<><path d="M10.3 4.2 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4.5M12 17.2v.1" /></>);
export const CheckIcon = icon(<path d="m4.5 12.5 4.5 4.5 10.5-10.5" />);
export const CloseIcon = icon(<path d="M6 6l12 12M18 6 6 18" />);
export const SparkIcon = icon(<path d="M12 3.5 13.9 10l6.6 2-6.6 2L12 20.5 10.1 14l-6.6-2 6.6-2Z" />);
export const ClockIcon = icon(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const GlobeIcon = icon(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5Z" /></>);

/** GALLEON 100 SD silhouette: info screen above a 3 × 4 key grid. */
export function GalleonMark({ size = 20, ...props }: IconProps) {
    return (
        <svg width={size * 0.6} height={size} viewBox="0 0 18 30" aria-hidden="true" focusable="false" {...props}>
            <rect x="0.75" y="0.75" width="16.5" height="28.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="3" y="3" width="12" height="6.5" rx="1" fill="currentColor" opacity="0.9" />
            {Array.from({ length: 12 }, (_, i) => (
                <rect key={i} x={3 + (i % 3) * 4.25} y={12 + Math.floor(i / 3) * 4.25} width="3.25" height="3.25" rx="0.6" fill="currentColor" opacity="0.55" />
            ))}
        </svg>
    );
}
