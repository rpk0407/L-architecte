// The signed-out /moi in the site's own page frame (the one /mon-rendez-vous and /resilier use): skip link, the wordmark
// and « Réserver » on top, the whole footer below. The sign-in, its success moment and « l'espace n'est pas ouvert » sit in it.
import type { ReactNode } from 'react';
import { showPhone, telHref } from './phone';
import { useSalon } from './salon';

const NB = '\u00a0';
/** the footer's links, as public/pages.js writes them (« Mon espace » joins them only while the salon has the space open) */
const LINKS: [string, string][] = [['/', 'Le site'], ['/?reserver', 'Réserver'], ['/mon-rendez-vous', 'Mon rendez-vous'], ['/resilier', 'Résilier mon abonnement'], ['/?visite', 'Comment ça marche' + NB + '?'], ['/mentions-legales', 'Mentions légales'], ['/confidentialite', 'Confidentialité'], ['/cgv', 'CGV']];

export function SitePage({ children, solo, space = true }: { children: ReactNode; solo?: boolean; space?: boolean }) {
  const salon = useSalon();
  const links = space ? [...LINKS.slice(0, 3), ['/moi', 'Mon espace'] as [string, string], ...LINKS.slice(3)] : LINKS;
  const tel = telHref(salon.phone);
  return (
    <div className="ms">
      <a className="ms-skip" href="#main">Aller au contenu</a>
      <header className="ms-top">
        <a className="ms-wm" href="/" aria-label="Barber L’Architecte, accueil"><span className="ms-wm-a">L’Architecte</span><span className="ms-wm-b">Barber · Marseille</span></a>
        <a className="ms-btn" href="/?reserver">Réserver</a>
      </header>
      <main id="main" className={'ms-main' + (solo ? ' solo' : '')}>{children}</main>
      <footer className="ms-ft">
        <div className="ms-ft-g">
          <div>
            <span className="ms-ft-n">{salon.name}</span>
            <address>
              {salon.address}<br />
              {tel ? <><a href={tel}>{showPhone(salon.phone).replace(/ /g, NB)}</a> · </> : null}
              <a href={'mailto:' + salon.email}>{salon.email}</a>
            </address>
          </div>
          <nav aria-label="Pages du site">
            <ul className="ms-ft-l">
              {links.map(([href, label]) => <li key={href}><a href={href} aria-current={href === '/moi' ? 'page' : undefined}>{label}</a></li>)}
            </ul>
          </nav>
          <p className="ms-ft-c">© {new Date().getFullYear()} {salon.name} · Pas de pistage, pas de mesure d’audience.</p>
        </div>
      </footer>
    </div>
  );
}
