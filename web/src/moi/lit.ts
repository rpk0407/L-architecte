// The signed-in space is drawn in light only (client.css has no dark theme); the signed-out page follows the phone's dark mode like
// the site's own pages (moi.css). While the space shows, the page behind it (its overscroll, its scrollbars) and the browser's bar
// are light: `m-lit` on <html> says so, and a first theme-color tag without a media query wins over the two the page declares.
import { useLayoutEffect } from 'react';

export function useLit() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add('m-lit');
    const bar = document.createElement('meta');
    bar.name = 'theme-color';
    bar.content = '#ECE8E0';
    document.head.prepend(bar);
    return () => { root.classList.remove('m-lit'); bar.remove(); };
  }, []);
}
