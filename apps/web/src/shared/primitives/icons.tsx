import type { JSX, SVGProps } from 'react';

/**
 * The icon set — FRONTEND §4.7. Deliberately small (24 glyphs); a view
 * imports only the ones it uses (§0.4's per-view budget), so this module
 * exports each icon individually rather than as a lookup table baked into
 * one component — that would pull all 24 into every bundle that imports any
 * one of them.
 *
 * Inline SVG, 24×24 viewBox, 1.5px stroke, `currentColor` — no icon font
 * (a font downloads the whole set for a handful of glyphs). Every icon here
 * is decorative by construction: the meaning is carried by the adjacent
 * text label (O3), so each one renders `aria-hidden="true"` and accepts no
 * `aria-label` — the one exception FRONTEND §4.7 allows (icon-only menu/
 * close buttons) is not needed by any component in this checkpoint.
 */
export type IconName =
  | 'check'
  | 'x'
  | 'alert-triangle'
  | 'alert-circle'
  | 'info'
  | 'clock'
  | 'calendar'
  | 'user'
  | 'users'
  | 'search'
  | 'plus'
  | 'minus'
  | 'chevron-down'
  | 'chevron-right'
  | 'arrow-left'
  | 'menu'
  | 'bell'
  | 'pill'
  | 'stethoscope'
  | 'heart-hand'
  | 'package'
  | 'wifi-off'
  | 'refresh'
  | 'external-link';

type IconRenderer = (props: SVGProps<SVGSVGElement>) => JSX.Element;

function icon(paths: JSX.Element): IconRenderer {
  return function Icon(props: SVGProps<SVGSVGElement>): JSX.Element {
    return (
      <svg
        viewBox="0 0 24 24"
        width="1em"
        height="1em"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

const ICONS: Record<IconName, IconRenderer> = {
  check: icon(<path d="M4 12.5 9.5 18 20 6" />),
  x: icon(
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  'alert-triangle': icon(
    <>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  'alert-circle': icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </>
  ),
  info: icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  clock: icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  calendar: icon(
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),
  user: icon(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4.5 5-6.5 8-6.5s6.5 2 8 6.5" />
    </>
  ),
  users: icon(
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c1.2-3.6 4-5.2 6.5-5.2s5.3 1.6 6.5 5.2" />
      <path d="M16 8.5a3 3 0 1 0 0-6" />
      <path d="M17.5 14.5c2.1.5 3.6 2 4.5 5" />
    </>
  ),
  search: icon(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  plus: icon(
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  minus: icon(<path d="M5 12h14" />),
  'chevron-down': icon(<path d="m6 9 6 6 6-6" />),
  'chevron-right': icon(<path d="m9 6 6 6-6 6" />),
  'arrow-left': icon(
    <>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </>
  ),
  menu: icon(
    <>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </>
  ),
  bell: icon(
    <>
      <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </>
  ),
  pill: icon(
    <>
      <rect x="3.5" y="9" width="17" height="6.5" rx="3.25" transform="rotate(-45 12 12.25)" />
      <path d="m9.5 8.5 6 6" />
    </>
  ),
  stethoscope: icon(
    <>
      <path d="M6 4v6a4 4 0 0 0 8 0V4" />
      <path d="M10 15.5V17a5 5 0 0 0 10 0v-1.5" />
      <circle cx="20" cy="14" r="1.5" />
    </>
  ),
  'heart-hand': icon(
    <>
      <path d="M4 13c-1-4 1-8 4-8 1.4 0 2.4.8 3 1.8.6-1 1.6-1.8 3-1.8 3 0 5 4 4 8" />
      <path d="M4 13c2 4 5.5 6.5 8 8 2.5-1.5 6-4 8-8" />
    </>
  ),
  package: icon(
    <>
      <path d="M12 3 3 7.5V16.5L12 21l9-4.5V7.5L12 3Z" />
      <path d="M3 7.5 12 12l9-4.5" />
      <path d="M12 12v9" />
    </>
  ),
  'wifi-off': icon(
    <>
      <path d="M2 2l20 20" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M5 13a10 10 0 0 1 3-2" />
      <path d="M12.5 8.02A10 10 0 0 1 19 11" />
      <path d="M16 6.5a14 14 0 0 1 3 1.9" />
      <path d="M2.5 8.4A14 14 0 0 1 5.5 6.2" />
      <path d="M12 20h.01" />
    </>
  ),
  refresh: icon(
    <>
      <path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5" />
      <path d="M4 4v4.5h4.5" />
      <path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.5" />
      <path d="M20 20v-4.5h-4.5" />
    </>
  ),
  'external-link': icon(
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </>
  ),
};

export function Icon({ name, ...props }: { readonly name: IconName } & SVGProps<SVGSVGElement>): JSX.Element {
  const Component = ICONS[name];
  return <Component {...props} />;
}
