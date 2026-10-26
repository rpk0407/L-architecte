// QR codes as crisp SVG (pay at the chair, print a gift card).
// @ts-ignore — vendored MIT library (Kazuhiko Arase), see qrcode.js
import qrcode from './qrcode.js';

export function QR({ text, size = 220, label }: { text: string; size?: number; label: string }) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + c + ' ' + r + 'h1v1h-1z';
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={label} style={{ background: '#fff', borderRadius: 16 }}>
      <path fill="#0F0E0D" d={d} />
    </svg>
  );
}
