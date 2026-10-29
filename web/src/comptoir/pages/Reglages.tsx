// Réglages: one place for everything the owner sets once and forgets, and for each person's own account.
import { lazy, Suspense, use, useEffect, type ComponentType, type ReactNode } from 'react';
import { Link, useRoute } from '../../lib/router';
import { useIsPhone } from '../../lib/hooks';
import { Icon } from '../../ui/Icon';
import { Skeleton } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import { Account } from './reglages/Account';
import Shop from './reglages/Shop';
import { sectionCap } from './reglages/caps';
import type { SectionProps } from './reglages/shared';
import './reglages.css';

const System = lazy(() => import('./reglages/System'));
const Wordpress = lazy(() => import('./reglages/Wordpress'));
const MiseEnRoute = lazy(() => import('./reglages/sections/MiseEnRoute'));

// The salon sections are one file each but load together, on the first visit to any of them, so moving between them
// never waits again (as when they were all in Shop).
const parts: (() => Promise<unknown>)[] = [];
let all: Promise<unknown> | undefined;
const loadSalon = () => (all ??= Promise.all(parts.map((f) => f())));
const salon = (load: () => Promise<{ default: ComponentType<SectionProps> }>) => {
  let C: ComponentType<SectionProps> | undefined;
  parts.push(() => load().then((m) => { C = m.default; }));
  function Part(p: SectionProps) {
    if (!C) use(loadSalon());
    return C ? <C {...p} /> : null;
  }
  return () => <Shop section={Part} />;
};
const system = (id: string) => () => <System section={id} />;
// Comptabilité: the owner sets the books up (with the salon's settings); a manager (cap `compta`) gets the month's files
const comptaFull = salon(() => import('./reglages/sections/Compta'));
const ComptaFiles = lazy(() => import('./reglages/sections/Compta').then((m) => ({ default: m.ComptaFiles })));
function Comptabilite() { const { can } = useApp(); return can('settings') ? comptaFull() : <ComptaFiles />; }

// The REGISTRY of Réglages: a new section is one entry here (and its file in ./reglages/sections), and its capability one
// line in ./reglages/caps.ts, which App.tsx reads too. The first section the person may open is the default one.
// `component` is called, not mounted: sections sharing Shop or System keep it mounted, so the settings load once.
type Section = { id: string; label: string; hint: string; icon: string; group: string; component: () => ReactNode };
const SECTIONS: Section[] = [
  { id: 'mise-en-route', label: 'Mise en route', hint: 'Ce qu’il reste avant d’ouvrir, et la santé', icon: 'check', group: 'Démarrage', component: () => <MiseEnRoute /> },
  { id: 'wordpress', label: 'Reprendre WordPress', hint: 'Clients, rendez-vous, cartes cadeaux', icon: 'download', group: 'Démarrage', component: () => <Wordpress /> },
  { id: 'compte', label: 'Mon compte', hint: 'Code, mot de passe, profil', icon: 'user', group: 'Moi', component: () => <Account /> },
  { id: 'salon', label: 'Le salon', hint: 'Coordonnées, mentions du ticket', icon: 'map', group: 'Salon', component: salon(() => import('./reglages/sections/Salon')) },
  { id: 'horaires', label: 'Horaires et fermetures', hint: 'Semaine type, jours fériés, congés', icon: 'clock', group: 'Salon', component: salon(() => import('./reglages/sections/Horaires')) },
  { id: 'reservation', label: 'Réservation en ligne', hint: 'Délais, annulation, acomptes', icon: 'globe', group: 'Salon', component: salon(() => import('./reglages/sections/Reservation')) },
  { id: 'paiements', label: 'Paiements', hint: 'Moyens acceptés, pourboires, Stripe', icon: 'card', group: 'Salon', component: salon(() => import('./reglages/sections/Paiements')) },
  { id: 'abonnements', label: 'Abonnements', hint: 'Formules mensuelles, délai de grâce', icon: 'card', group: 'Salon', component: salon(() => import('./reglages/sections/Abonnements')) },
  { id: 'messages', label: 'Messages', hint: 'SMS, e-mails et leurs textes', icon: 'sms', group: 'Salon', component: salon(() => import('./reglages/sections/Messages')) },
  { id: 'equipe', label: 'Équipe et accès', hint: 'Ce que les barbiers peuvent faire', icon: 'shield', group: 'Salon', component: salon(() => import('./reglages/sections/Equipe')) },
  { id: 'objectifs', label: 'Objectifs', hint: 'Chiffre visé chaque mois', icon: 'target', group: 'Salon', component: salon(() => import('./reglages/sections/Objectifs')) },
  { id: 'fidelite', label: 'Fidélité', hint: 'Carte à tampons et parrainage', icon: 'gift', group: 'Salon', component: salon(() => import('./reglages/sections/Fidelite')) },
  { id: 'compta', label: 'Comptabilité', hint: 'TVA, plan de comptes, ton comptable', icon: 'euro', group: 'Salon', component: () => <Comptabilite /> },
  { id: 'appareils', label: 'Appareils', hint: 'Postes autorisés à la connexion par code', icon: 'device', group: 'Sécurité', component: system('appareils') },
  { id: 'donnees', label: 'Données et intégrité', hint: 'Santé, vérification, exports, système', icon: 'shieldOk', group: 'Sécurité', component: system('donnees') },
  { id: 'journal', label: 'Journal d’activité', hint: 'Qui a fait quoi, quand', icon: 'journal', group: 'Sécurité', component: system('journal') }
];

export default function Reglages() {
  const { can } = useApp();
  const route = useRoute();
  const phone = useIsPhone();
  const list = SECTIONS.filter((s) => { const c = sectionCap(s.id); return !c || can(c); });
  const cur = list.find((s) => s.id === route.id) || (phone ? null : list[0]);
  const groups = [...new Set(list.map((s) => s.group))];
  useEffect(() => { if (cur?.group === 'Salon') void loadSalon(); }, [cur?.group]);
  return (
    <>
      <PageTitle><h1>{phone && cur ? cur.label : 'Réglages'}</h1></PageTitle>
      <div className={'rg' + (cur ? ' has-cur' : '')}>
        <nav className="rg-nav" aria-label="Sections des réglages" data-guide="reglages-nav">
          {groups.map((g) => (
            <div key={g} className="rg-group">
              <p className="section-k">{g}</p>
              {list.filter((s) => s.group === g).map((s) => (
                <Link key={s.id} to={'/reglages/' + s.id} className="rg-link" aria-current={cur?.id === s.id ? 'page' : undefined}>
                  <Icon name={s.icon} size={18} /><span><b>{s.label}</b><small>{s.hint}</small></span><Icon name="chevR" size={16} />
                </Link>
              ))}
            </div>
          ))}
        </nav>
        {cur ? (
          <div className="rg-body">
            {phone ? <Link to="/reglages" className="rg-back"><Icon name="chevL" size={16} />Réglages</Link> : null}
            <Suspense fallback={<Skeleton h={320} r={22} />}>
              {cur.component()}
            </Suspense>
          </div>
        ) : null}
      </div>
    </>
  );
}
