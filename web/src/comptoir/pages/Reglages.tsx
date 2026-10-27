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
import type { SectionProps } from './reglages/shared';
import './reglages.css';

const System = lazy(() => import('./reglages/System'));
const Wordpress = lazy(() => import('./reglages/Wordpress'));

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

// The REGISTRY of Réglages: a new section is one entry here (and its file in ./reglages/sections).
// `component` is called, not mounted: sections sharing Shop or System keep it mounted, so the settings load once.
type Section = { id: string; label: string; hint: string; icon: string; cap?: string; group: string; component: () => ReactNode };
const SECTIONS: Section[] = [
  { id: 'compte', label: 'Mon compte', hint: 'Code, mot de passe, profil', icon: 'user', group: 'Moi', component: () => <Account /> },
  { id: 'salon', label: 'Le salon', hint: 'Coordonnées, mentions du ticket', icon: 'map', cap: 'settings', group: 'Salon', component: salon(() => import('./reglages/sections/Salon')) },
  { id: 'horaires', label: 'Horaires et fermetures', hint: 'Semaine type, jours fériés, congés', icon: 'clock', cap: 'settings', group: 'Salon', component: salon(() => import('./reglages/sections/Horaires')) },
  { id: 'reservation', label: 'Réservation en ligne', hint: 'Délais, annulation, acomptes', icon: 'globe', cap: 'settings', group: 'Salon', component: salon(() => import('./reglages/sections/Reservation')) },
  { id: 'paiements', label: 'Paiements', hint: 'Moyens acceptés, pourboires, Stripe', icon: 'card', cap: 'settings', group: 'Salon', component: salon(() => import('./reglages/sections/Paiements')) },
  { id: 'messages', label: 'Messages', hint: 'SMS automatiques et leurs textes', icon: 'sms', cap: 'settings', group: 'Salon', component: salon(() => import('./reglages/sections/Messages')) },
  { id: 'equipe', label: 'Équipe et accès', hint: 'Ce que les barbiers peuvent faire', icon: 'shield', cap: 'settings', group: 'Salon', component: salon(() => import('./reglages/sections/Equipe')) },
  { id: 'objectifs', label: 'Objectifs', hint: 'Chiffre visé chaque mois', icon: 'target', cap: 'settings', group: 'Salon', component: salon(() => import('./reglages/sections/Objectifs')) },
  { id: 'appareils', label: 'Appareils', hint: 'Postes autorisés à la connexion par code', icon: 'device', cap: 'devices', group: 'Sécurité', component: system('appareils') },
  { id: 'donnees', label: 'Données et intégrité', hint: 'Vérification, exports, système', icon: 'shieldOk', cap: 'data', group: 'Sécurité', component: system('donnees') },
  { id: 'wordpress', label: 'Reprendre WordPress', hint: 'Clients, rendez-vous, cartes cadeaux', icon: 'download', cap: 'settings', group: 'Sécurité', component: () => <Wordpress /> },
  { id: 'journal', label: 'Journal d’activité', hint: 'Qui a fait quoi, quand', icon: 'journal', cap: 'audit', group: 'Sécurité', component: system('journal') }
];

export default function Reglages() {
  const { can } = useApp();
  const route = useRoute();
  const phone = useIsPhone();
  const list = SECTIONS.filter((s) => !s.cap || can(s.cap));
  const cur = list.find((s) => s.id === route.id) || (phone ? null : list[0]);
  const groups = [...new Set(list.map((s) => s.group))];
  useEffect(() => { if (cur?.group === 'Salon') void loadSalon(); }, [cur?.group]);
  return (
    <>
      <PageTitle><h1>{phone && cur ? cur.label : 'Réglages'}</h1></PageTitle>
      <div className={'rg' + (cur ? ' has-cur' : '')}>
        <nav className="rg-nav" aria-label="Sections des réglages">
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
