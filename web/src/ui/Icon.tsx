// One stroke icon set, drawn for the Comptoir (1.8 px, round caps), so nothing looks borrowed.
const P: Record<string, string> = {
  agenda: 'M4 7h16M4 12h16M4 17h10',
  calendar: 'M5 6h14v14H5zM5 10h14M9 3v4M15 3v4',
  caisse: 'M4 8h16v11H4zM8 8V5h8v3M8 13h2M14 13h2M8 16h8',
  clients: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c.8-3.4 3.2-5 6-5s5.2 1.6 6 5M16 4.5a3.3 3.3 0 0 1 0 6.3M18 15c1.6.6 2.6 2 3 5',
  relances: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
  rapports: 'M5 20V11M11 20V5M17 20v-6M3 20h18',
  equipe: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4.2-6 8-6s7 2 8 6',
  catalogue: 'M4 6h16M4 12h16M4 18h16M8 3v18',
  reglages: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  journal: 'M7 4h10l3 3v13H7zM10 9h7M10 13h7M10 17h4M4 8v12',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevL: 'M15 6l-6 6 6 6', chevR: 'M9 6l6 6-6 6', chevD: 'M6 9l6 6 6-6', chevU: 'M6 15l6-6 6 6',
  arrowR: 'M4 12h15M13 6l6 6-6 6', arrowL: 'M20 12H5M11 6l-6 6 6 6', ext: 'M7 17L17 7M8 7h9v9',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L21 21',
  bell: 'M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15zM10 21h4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.8-2M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20c.9-3.5 3.6-5 7-5s6.1 1.5 7 5',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  sms: 'M4 5h16v11H9l-5 4zM8 10h.01M12 10h.01M16 10h.01',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  cash: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v.01M18 14v.01',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2',
  gift: 'M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-1.5-3-5-3-5-1s3 1 5 1zM12 7c1.5-3 5-3 5-1s-3 1-5 1z',
  ticket: 'M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4zM10 6v12',
  scissors: 'M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 6.5L20 17M8 17.5L20 7',
  chair: 'M7 4h10v7H7zM5 11h14v3H5zM8 14v6M16 14v6M6 20h12',
  walk: 'M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM10 21l2-6 3 3v3M9 12l2-5 4 2 2 3M11 7l-3 2-1 3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  block: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 18.4L18.4 5.6',
  move: 'M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  star: 'M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.8l6-.7z',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  shieldOk: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  print: 'M7 9V4h10v5M6 17H4v-7h16v7h-2M7 14h10v6H7z',
  refund: 'M9 14l-5-5 5-5M4 9h11a5 5 0 0 1 0 10h-3',
  percent: 'M19 5L5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  heart: 'M12 20s-8-4.7-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.3-8 11-8 11z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  device: 'M6 3h12v18H6zM10 18h4',
  key: 'M8 15a4 4 0 1 1 3.5-6H21v3h-2v3h-3v-3h-4.5A4 4 0 0 1 8 15z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  wait: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9',
  euro: 'M18 6.5A7 7 0 1 0 18 17.5M4 10h10M4 14h10',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  instagram: 'M4 4h16v16H4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 7h.01',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  copy: 'M8 8h12v12H8zM4 16V4h12'
};

export type IconName = keyof typeof P | string;

export function Icon({ name, size, className, title }: { name: IconName; size?: number; className?: string; title?: string }) {
  const d = P[name] || P.info;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={size} height={size} className={className} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}
