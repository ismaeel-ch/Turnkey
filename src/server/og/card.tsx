/**
 * The 1200 × 630 picture shown when a Turnkey link is pasted into a chat or a post: an icon, a name, a line about it,
 * and where it lives. Drawn with next/og (Satori), so only flexbox layout and inline styles work here.
 */
import { ImageResponse } from 'next/og';
import { logoSvg } from '@/platform/pwa/logo';
import { cleanText, type AppIcon } from '@/server/share/preview';
import { TURNKEY_LOGO_SVG } from './turnkey-logo';

export const CARD_SIZE = { width: 1200, height: 630 } as const;
// The card's width less its side padding (80 + 80), the icon (240) and the gap after it (56). Satori wraps text only
// inside a box with a known width.
const TEXT_WIDTH = 1200 - 160 - 240 - 56;

const dataUrl = (svg: string) => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

export type CardInput = {
  title: string;
  description: string;
  /** An app's icon. Without one the card wears Turnkey's own. */
  icon?: AppIcon;
  /** The site's host name, shown in the corner. */
  host: string;
  /** A short line above the title, such as "Shared app". */
  kicker?: string;
};

export function renderCard(input: CardInput): ImageResponse {
  const iconSrc = input.icon ? dataUrl(logoSvg(input.icon, { size: 512 })) : dataUrl(TURNKEY_LOGO_SVG);
  const titleSize = input.title.length > 28 ? 60 : 72;
  // four lines at most, so a long description never pushes the footer off the card
  const description = cleanText(input.description, 150);
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '56px 80px 56px',
        background: '#1f1f1f',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 56, flexGrow: 1, paddingBottom: 40 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain img elements, not next/image */}
        <img src={iconSrc} width={240} height={240} alt="" style={{ width: 240, height: 240, flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', width: TEXT_WIDTH }}>
          {input.kicker ? <div style={{ fontSize: 28, color: '#adadad', marginBottom: 12, display: 'flex' }}>{input.kicker}</div> : null}
          <div style={{ fontSize: titleSize, lineHeight: 1.1, display: 'flex' }}>{input.title}</div>
          <div style={{ fontSize: 32, lineHeight: 1.35, color: '#d6d6d6', marginTop: 24, display: 'flex' }}>{description}</div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '2px solid #3d3d3d',
          paddingTop: 28,
          fontSize: 28,
          color: '#adadad',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
          <img src={dataUrl(TURNKEY_LOGO_SVG)} width={44} height={44} alt="" style={{ width: 44, height: 44 }} />
          <span>{input.icon ? 'Made with Turnkey' : 'Turnkey'}</span>
        </div>
        <span>{input.host}</span>
      </div>
    </div>,
    CARD_SIZE,
  );
}
