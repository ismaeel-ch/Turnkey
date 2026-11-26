// Draws an app's icon as SVG from its identity. A port of logoSvg in src/legacy/release.js: the same shapes, fills,
// marks and proportions, so an installed app wears the icon the workspace shows. Nothing from a request is written
// into the markup except values from the catalogs (shape, fill, mark, accent) and glyph paths from the build.
import { ACCENT_COLORS, glyphPath, type AppIdentity } from './identity';

const SHAPES = {
  squircle: '<rect width="100" height="100" rx="24"/>',
  circle: '<circle cx="50" cy="50" r="50"/>',
  hexagon:
    '<path d="M44 3.5a12 12 0 0 1 12 0l31 18a12 12 0 0 1 6 10.4v36.2a12 12 0 0 1-6 10.4l-31 18a12 12 0 0 1-12 0l-31-18a12 12 0 0 1-6-10.4V31.9a12 12 0 0 1 6-10.4z"/>',
  shield: '<path d="M50 2c13 8.5 26 12 40 12v38c0 22-15 38-40 46C25 90 10 74 10 52V14c14 0 27-3.5 40-12z"/>',
  tile: '<rect width="100" height="100" rx="9"/>',
} as const;

export type LogoOptions = {
  size?: number;
  /** Full-bleed accent background with the icon in the middle 70%, so any mask the system applies keeps it whole. */
  maskable?: boolean;
};

export function logoSvg(id: Pick<AppIdentity, 'accent' | 'glyph' | 'shape' | 'fill' | 'mark'>, opts: LogoOptions = {}): string {
  const c = ACCENT_COLORS[id.accent];
  const s = Math.max(16, Math.min(1024, Math.round(opts.size ?? 64)));
  const g = 'lg-' + id.accent;
  const small = id.fill === 'ring';
  const shape = SHAPES[id.shape];
  const bg =
    id.fill === 'gradient'
      ? '<g fill="url(#' + g + ')">' + shape + '</g>'
      : id.fill === 'split'
        ? '<g fill="' +
          c[0] +
          '">' +
          shape +
          '</g><g clip-path="url(#' +
          g +
          '-' +
          id.shape +
          ')"><path d="M0 100 100 0v100z" fill="' +
          c[1] +
          '"/></g>'
        : '<g fill="' +
          c[0] +
          '">' +
          shape +
          '</g>' +
          (small ? '<circle cx="50" cy="50" r="31" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="4"/>' : '');
  const mark =
    id.mark === 'dot'
      ? '<circle cx="76" cy="26" r="7" fill="#fff" fill-opacity=".92"/>'
      : id.mark === 'spark'
        ? '<path d="M76 14l3.2 8.8 8.8 3.2-8.8 3.2-3.2 8.8-3.2-8.8-8.8-3.2 8.8-3.2z" fill="#fff" fill-opacity=".92"/>'
        : id.mark === 'bar'
          ? '<rect x="32" y="80" width="36" height="5" rx="2.5" fill="#fff" fill-opacity=".6"/>'
          : '';
  const k = small ? 2 : id.shape === 'shield' || id.shape === 'hexagon' ? 2.3 : 2.6;
  const at = 50 - 10 * k;
  const up = id.mark === 'bar' && !small ? 4 : 0;
  const body =
    bg + '<g transform="translate(' + at + ' ' + (at - up) + ') scale(' + k + ')" fill="#fff">' + glyphPath(id.glyph) + '</g>' + mark;
  const defs =
    '<defs><linearGradient id="' +
    g +
    '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' +
    c[2] +
    '"/><stop offset="1" stop-color="' +
    c[1] +
    '"/></linearGradient><clipPath id="' +
    g +
    '-' +
    id.shape +
    '">' +
    shape +
    '</clipPath></defs>';
  const inner = opts.maskable
    ? '<rect width="100" height="100" fill="' + c[0] + '"/><g transform="translate(15 15) scale(.7)">' + body + '</g>'
    : body;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    s +
    '" height="' +
    s +
    '" viewBox="0 0 100 100" role="img" aria-hidden="true">' +
    defs +
    inner +
    '</svg>'
  );
}
