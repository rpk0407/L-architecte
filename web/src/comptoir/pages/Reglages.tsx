// Réglages: one place for everything the owner sets once and forgets, and for each person's own account.
import { lazy, Suspense } from 'react';
import { Link, useRoute } from '../../lib/router';
import { useIsPhone } from '../../lib/hooks';
import { Icon } from '../../ui/Icon';
import { Skeleton } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import { Account } from './reglages/Account';
import './reglages.css';

const Shop = lazy(() => import('./reglages/Shop'));
const System = lazy(() => import('./reglages/System'));

type Section = { id: string; label: string; hint: string; icon: string; cap?: string; group: string };
const SECTIONS: Section[] = [
  { id: 'compte', label: 'Mon compte', hint: 'Code, mot de passe, profil', icon: 'user', group: 'Moi' },
  { id: 'salon', label: 'Le salon', hint: 'Coordonnées, mentions du ticket', icon: 'map', cap: 'settings', group: 'Salon' },
  { id: 'horaires', label: 'Horaires et fermetures', hint: 'Semaine type, jours fériés, congés', icon: 'clock', cap: 'settings', group: 'Salon' },
  { id: 'reservation', label: 'Réservation en ligne', hint: 'Délais, annulation, acomptes', icon: 'globe', cap: 'settings', group: 'Salon' },
  { id: 'paiements', label: 'Paiements', hint: 'Moyens acceptés, pourboires, Stripe', icon: 'card', cap: 'settings', group: 'Salon' },
  { id: 'messages', label: 'Messages', hint: 'SMS automatiques et leurs textes', icon: 'sms', cap: 'settings', group: 'Salon' },
  { id: 'equipe', label: 'Équipe et accès', hint: 'Ce que les barbiers peuvent faire', icon: 'shield', cap: 'settings', group: 'Salon' },
  { id: 'objectifs', label: 'Objectifs', hint: 'Chiffre visé chaque mois', icon: 'target', cap: 'settings', group: 'Salon' },
  { id: 'appareils', label: 'Appareils', hint: 'Postes autorisés à la connexion par code', icon: 'device', cap: 'devices', group: 'Sécurité' },
  { id: 'donnees', label: 'Données et intégrité', hint: 'Vérification, exports, système', icon: 'shieldOk', cap: 'data', group: 'Sécurité' },
  { id: 'journal', label: 'Journal d’activité', hint: 'Qui a fait quoi, quand', icon: 'journal', cap: 'audit', group: 'Sécurité' }
];

export default function Reglages() {
  const { can } = useApp();
  const route = useRoute();
  const phone = useIsPhone();
  const list = SECTIONS.filter((s) => !s.cap || can(s.cap));
  const cur = list.find((s) => s.id === route.id) || (phone ? null : list[0]);
  const groups = [...new Set(list.map((s) => s.group))];
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
              {cur.id === 'compte' ? <Account /> : ['appareils', 'donnees', 'journal'].includes(cur.id) ? <System section={cur.id} /> : <Shop section={cur.id} />}
            </Suspense>
          </div>
        ) : null}
      </div>
    </>
  );
}
