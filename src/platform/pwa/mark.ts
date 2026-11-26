// Turnkey's own mark: the four bars and the centre square of Logo in src/legacy/ui.js, on a dark rounded square,
// in the dark theme's palette so it reads on any tab strip or home screen. scripts/gen-pwa-icons.cjs draws the
// PNG and ICO files from the same shapes; src/app/icon.svg is this string for size 512.
export const MARK_COLORS = {
  purple: '#9470bd',
  teal: '#4cb4b7',
  pumpkin: '#df8e64',
  pink: '#ef85c8',
  centre: '#ffffff',
  ground: '#1f1f1f',
} as const;

export function markSvg(opts: { size?: number; maskable?: boolean } = {}): string {
  const c = MARK_COLORS;
  const s = opts.size ?? 512;
  // The mark is drawn on a 24 x 24 grid. Normal icons: it fills 70% of a rounded square. Maskable: full bleed, 56%.
  const k = opts.maskable ? 0.56 * (100 / 24) : 0.7 * (100 / 24);
  const at = (100 - 24 * k) / 2;
  const ground = opts.maskable
    ? '<rect width="100" height="100" fill="' + c.ground + '"/>'
    : '<rect width="100" height="100" rx="22" fill="' + c.ground + '"/>';
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    s +
    '" height="' +
    s +
    '" viewBox="0 0 100 100">' +
    ground +
    '<g transform="translate(' +
    at +
    ' ' +
    at +
    ') scale(' +
    k +
    ')">' +
    '<rect x="2" y="2" width="13" height="5" rx="1.5" fill="' +
    c.purple +
    '"/><rect x="17" y="2" width="5" height="13" rx="1.5" fill="' +
    c.teal +
    '"/>' +
    '<rect x="9" y="17" width="13" height="5" rx="1.5" fill="' +
    c.pumpkin +
    '"/><rect x="2" y="9" width="5" height="13" rx="1.5" fill="' +
    c.pink +
    '"/>' +
    '<rect x="9" y="9" width="6" height="6" rx="1.5" fill="' +
    c.centre +
    '"/></g></svg>'
  );
}
