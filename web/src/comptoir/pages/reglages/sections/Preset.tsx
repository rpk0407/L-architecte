// Mise en route › « Le salon, en un geste »: the real salon as the old site had it (server/presets/architecte.js),
// shown line by line before anything is written, then put in place on one confirmation (POST /api/v1/preset/apply).
// What already exists is never touched, so a second tap changes nothing. Frank's chair goes to the owner's own account
// (the line says whose), each one gets his portrait unless he has a photo. The hours are the owner's own (the last cut
// at the hour he gave): a barber who still has the week of an earlier version is offered today's, before and after
// (« horaires à mettre à jour »), and a week changed by hand is kept. Then the days the salon closes or opens
// exceptionally, and Aland's CFA days of the school weeks (zone B). Then the first code of each barber: without one he
// is not on the tablet and cannot link his phone (POST /api/v1/preset/codes, shown once).
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { refreshAll, useQuery } from '../../../../lib/query';
import { Link } from '../../../../lib/router';
import { cap, dates, dur, eur, plural, time } from '../../../../lib/format';
import { Icon } from '../../../../ui/Icon';
import { Button, Modal, Note, confirm, toast, toastError } from '../../../../ui/kit';
import { useApp } from '../../../state';

type Iv = [number, number][];
type Week = Record<string, Iv>;
type Status = 'set' | 'same' | 'kept';
export type PresetPlan = {
  id: string; name: string; source: string; todo: number; notes: string[];
  count: { hours: number; rules: number; closures?: number; openings?: number; services: number; updates?: number; team: number; schedules?: number; absences: number; cfa?: number; photos: number };
  hours: { to: Week; now: Week; status: Status; was?: boolean };
  closures?: { from: string; to: string; label: string; status: 'create' | 'exists' | 'past' }[];
  openings?: { day: string; intervals: Iv; label: string; status: 'create' | 'exists' | 'past' }[];
  // the apprentice's CFA days of the school weeks, one absence each, and the holidays he works his full week
  school?: { staff: string; reason: string; zone: string; academie: string; read: string; year: string | null; unconfirmed: boolean; todo: number; from: string | null; until: string | null; days: { day: string; startMin?: number; status: 'create' | 'exists' }[]; holidays: { name: string; from: string; to: string }[] } | null;
  stranded?: { count: number; by: { name: string; count: number }[] };
  rules: { key: string; label: string; text: string; nowText: string; status: Status }[];
  services: { slug: string; name: string; category: string; price: number; dur: number; from: boolean; online: boolean; pack: { credits: number; days: number; weekly?: boolean } | null; draft: boolean; status: 'create' | 'exists' | 'update'; was?: string; archived: boolean }[];
  // owner: the line is the owner's own account (account: its name when it is another); online: false, kept off the site
  team: { name: string; color: string; schedule: Week; status: 'create' | 'chair' | 'exists'; archived: boolean; hasPin: boolean; owner?: boolean; account?: string; online?: boolean; photo?: 'create' | 'exists' | null; hours?: 'update' | 'kept' | null; now?: Week }[];
  absences: { staff: string; from: string; to: string; reason: string; status: 'create' | 'exists' | 'past' }[];
  noCode: { id: string; name: string }[];
};
type Code = { id: string; name: string; pin: string };

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const ivText = (iv: Iv) => iv.map(([a, b]) => time(a) + ' – ' + time(b)).join(' et ');
/** "Mardi au samedi 9 h 30 – 13 h et 14 h – 18 h" ; days with other hours get their own part. */
export function weekWords(w: Week): string[] {
  const groups: { sig: string; iv: Iv; days: number[] }[] = [];
  for (const d of ORDER) {
    const iv = w[d] || [];
    if (!iv.length) continue;
    const sig = JSON.stringify(iv);
    const g = groups.find((x) => x.sig === sig);
    if (g) g.days.push(d); else groups.push({ sig, iv, days: [d] });
  }
  return groups.map((g) => {
    const runs: number[][] = [];
    for (const d of g.days) { const r = runs[runs.length - 1]; if (r && ORDER.indexOf(d) === ORDER.indexOf(r[r.length - 1]) + 1) r.push(d); else runs.push([d]); }
    const label = runs.map((r) => (r.length >= 3 ? dates.DAYS_FR[r[0]] + ' au ' + dates.DAYS_FR[r[r.length - 1]] : r.map((d) => dates.DAYS_FR[d]).join(', '))).join(', ');
    return cap(label) + ' ' + ivText(g.iv);
  });
}
const restDays = (w: Week) => ORDER.filter((d) => !(w[d] || []).length).map((d) => dates.DAYS_FR[d]).join(' et ');
const span = (a: { from: string; to: string }) => (a.from === a.to ? 'le ' + dates.dayShort(a.from) : 'du ' + dates.dayShort(a.from) + ' au ' + dates.dayShort(a.to));

const TAG: Record<string, string> = { hours: 'horaires à mettre à jour', update: 'à mettre à jour', create: 'à créer', chair: 'fauteuil à ajouter', mine: 'sur ton compte', photo: 'portrait à poser', exists: 'déjà là', set: 'à régler', same: 'déjà réglé', kept: 'ton réglage, gardé', past: 'passée' };
const Tag = ({ s }: { s: string }) => <span className={'badge' + (s === 'create' || s === 'update' || s === 'hours' || s === 'chair' || s === 'mine' || s === 'photo' || s === 'set' ? ' badge-accent' : '')}>{TAG[s] || s}</span>;

export default function Preset() {
  const { reloadBoot } = useApp();
  const { data, refresh } = useQuery<PresetPlan>('/api/v1/preset');
  const [busy, setBusy] = useState(false);
  const [coding, setCoding] = useState(false);
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const p = data;
  const c = p.count;
  const cfa = c.cfa || 0;
  const what = [c.team ? plural(c.team, 'barbier') : '', c.services ? plural(c.services, 'prestation') : '', c.hours ? 'les horaires du salon' : '', c.rules ? plural(c.rules, 'règle') + ' de réservation' : '', c.closures ? plural(c.closures, 'fermeture') : '', c.openings ? plural(c.openings, 'ouverture exceptionnelle', 'ouvertures exceptionnelles') : '', c.absences ? plural(c.absences, 'absence') : '', cfa && p.school ? plural(cfa, 'absence') + ' « ' + p.school.reason + ' » de ' + p.school.staff : '', c.photos ? plural(c.photos, 'portrait') : ''].filter(Boolean);
  const renamed = p.services.filter((x) => x.status === 'update');
  // the barbers whose week an earlier version set: today's hours replace it, once the owner has read both
  const rehoured = p.team.filter((t) => t.hours === 'update');
  const onlyUpdates = renamed.length + rehoured.length > 0 && renamed.length + rehoured.length === p.todo;
  const closings = (p.closures || []).filter((x) => x.status !== 'past');
  const opens = (p.openings || []).filter((x) => x.status !== 'past');
  const sc = p.school && (p.school.days.length || p.school.unconfirmed) ? p.school : null;
  const after = async () => { refreshAll(); await Promise.all([refresh(), reloadBoot().catch(() => {})]); };
  const apply = async () => {
    if (!await confirm({ title: onlyUpdates ? 'Mettre la carte à jour ?' : 'Mettre le salon en place ?', body: (what.length ? 'Seront créés : ' + what.join(', ') + '. ' : '') + (rehoured.length ? 'Horaires mis à jour : ' + rehoured.map((t) => t.name).join(', ') + '. ' : '') + (p.stranded && p.stranded.count ? plural(p.stranded.count, 'rendez-vous déjà pris reste', 'rendez-vous déjà pris restent') + ' en dehors de ces horaires : aucun n’est déplacé. ' : '') + (renamed.length ? renamed.map((x) => '« ' + x.was + ' » devient « ' + x.name + ' » : même prix, même lien, l’entretien de la barbe compris dans la visite. ').join('') : '') + 'Le reste n’est pas modifié, et tu peux tout ajuster ensuite.', ok: onlyUpdates ? 'Mettre à jour' : 'Mettre en place' })) return;
    setBusy(true);
    try {
      const r = await api.post<{ done: PresetPlan['count'] }>('/api/v1/preset/apply', {});
      const d = r.done;
      toast({ title: 'Le salon est en place', sub: [d.updates ? plural(d.updates, 'prestation mise à jour', 'prestations mises à jour') : '', d.team ? plural(d.team, 'barbier') : '', d.schedules ? plural(d.schedules, 'semaine mise à jour', 'semaines mises à jour') : '', d.services ? plural(d.services, 'prestation') : '', d.hours ? 'horaires' : '', d.rules ? plural(d.rules, 'règle') : '', d.closures ? plural(d.closures, 'fermeture') : '', d.openings ? plural(d.openings, 'ouverture') : '', d.absences || d.cfa ? plural(d.absences + (d.cfa || 0), 'absence') : '', d.photos ? plural(d.photos, 'portrait') : ''].filter(Boolean).join(' · ') || 'Tout y était déjà.', icon: 'check', ttl: 8000 });
      await after();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const giveCodes = async () => {
    if (!await confirm({ title: 'Donner un code à ' + (p.noCode.length > 1 ? 'chacun' : p.noCode[0].name) + ' ?', body: 'Un code à 4 chiffres est tiré pour ' + p.noCode.map((x) => x.name).join(', ') + '. Il s’affiche une seule fois : note-le et donne-le de vive voix.', ok: 'Tirer les codes' })) return;
    setCoding(true);
    try { const r = await api.post<{ codes: Code[] }>('/api/v1/preset/codes', {}); setCodes(r.codes); await after(); }
    catch (e) { toastError(e); } finally { setCoding(false); }
  };
  const done = !p.todo;
  const detail = open || !done;
  return (
    <section className="card col mr-preset" style={{ gap: 12 }} data-guide="mer-preset" data-todo={p.todo}>
      <div className="card-h"><h2><Icon name="sparkle" size={16} />Le salon {p.name}, en un geste</h2><span className={'badge' + (done ? ' badge-ok' : ' badge-accent')}>{done ? 'en place' : plural(p.todo, 'ligne') + (onlyUpdates ? ' à mettre à jour' : ' à créer')}</span></div>
      <p className="muted" style={{ fontSize: 13.5 }}>
        {done ? 'L’équipe, la carte, les horaires et les règles de l’ancien site sont en place. ' : 'L’équipe et ses vrais horaires, la carte et ses prix, les horaires du salon et ses règles de réservation, tels qu’ils sont sur l’ancien site. Rien n’est créé avant que tu confirmes ; ce qui existe déjà n’est jamais modifié. '}
        <span className="faint">{p.source}.</span>
      </p>
      {detail ? (
        <div className="mr-pre">
          <div className="mr-pre-b" data-part="team">
            <p className="section-k">Équipe</p>
            <ul className="list">{p.team.map((t) => {
              const hours = weekWords(t.schedule);
              return (
                <li key={t.name} className="li">
                  <span className="mr-dot" style={{ background: t.color }} aria-hidden />
                  <span className="li-main">
                    <b>{t.name}{t.archived ? ' (désactivé)' : ''}</b>
                    {/* Frank is the gérant: his chair is the owner's own account, never a second one */}
                    {t.owner ? <small>{t.status === 'chair' ? 'Ton compte' + (t.account ? ' « ' + t.account + ' »' : '') + ' reçoit son fauteuil, sa semaine, sa couleur et ses initiales' : 'Sur ton compte' + (t.account ? ' « ' + t.account + ' »' : '')}</small> : null}
                    {t.hours === 'kept' && t.now ? <small>Ses horaires ont été changés à la main, ils sont gardés : {weekWords(t.now).join(' · ') || 'aucun horaire'}</small> : null}
                    {t.hours === 'update' && t.now ? <small className="faint">Avant : {weekWords(t.now).join(' · ') || 'aucun horaire'}</small> : null}
                    {t.hours === 'update' ? <small className="faint">Après :</small> : null}
                    {t.hours === 'kept' ? null : hours.length ? hours.map((l) => <small key={l}>{l}</small>) : <small>Horaires à entrer dans Équipe</small>}
                    {hours.length && t.hours !== 'kept' ? <small className="faint">Repos : {restDays(t.schedule)}</small> : null}
                    {t.online === false ? <small className="faint">Pas proposé en ligne tant que ses horaires ne sont pas entrés</small> : null}
                    {t.photo === 'create' ? <small className="faint">Son portrait est posé, dans le Comptoir et sur le site</small> : t.photo === 'exists' ? <small className="faint">A déjà sa photo : elle est gardée</small> : null}
                  </span>
                  <Tag s={t.owner && t.status === 'chair' ? 'mine' : t.hours === 'update' ? 'hours' : t.hours === 'kept' ? 'kept' : t.status === 'exists' && t.photo === 'create' ? 'photo' : t.status} />
                </li>
              );
            })}</ul>
          </div>
          <div className="mr-pre-b" data-part="services">
            <p className="section-k">Carte</p>
            <ul className="list">{p.services.map((x) => (
              <li key={x.slug} className="li">
                <span className="li-main"><b>{x.name}</b><small>{x.category} · {dur(x.dur)}{x.pack ? (x.pack.weekly ? ' · ' + x.pack.credits + ' visites, 1 par semaine' : ' · carnet de ' + x.pack.credits + ' coupes, ' + x.pack.days + ' jours') : ''}{x.status === 'update' && x.was ? ' · remplace « ' + x.was + ' », avec l’entretien de la barbe' : ''}{!x.online ? ' · au salon seulement' : ''}{x.archived ? ' · archivée' : ''}</small></span>
                <b className="tnum">{x.from ? <small className="faint">dès </small> : null}{eur(x.price)}</b>
                <Tag s={x.status} />
              </li>
            ))}</ul>
          </div>
          <div className="mr-pre-b" data-part="hours">
            <p className="section-k">Horaires du salon</p>
            <ul className="list">
              <li className="li"><span className="li-main"><b>{weekWords(p.hours.to).join(' · ')}</b><small>Fermé : {restDays(p.hours.to)}{p.hours.status === 'kept' || (p.hours.status === 'set' && p.hours.was) ? ' · aujourd’hui : ' + (weekWords(p.hours.now).join(' · ') || 'fermé toute la semaine') : ''}</small></span><Tag s={p.hours.status === 'set' && p.hours.was ? 'update' : p.hours.status} /></li>
              {p.rules.map((r) => <li key={r.key} className="li"><span className="li-main"><b>{r.label} {r.text}</b>{r.status === 'kept' ? <small>Aujourd’hui : {r.nowText}</small> : null}</span><Tag s={r.status} /></li>)}
            </ul>
          </div>
          {closings.length || opens.length ? (
            <div className="mr-pre-b" data-part="days">
              <p className="section-k">Fermetures et ouvertures exceptionnelles</p>
              <ul className="list">
                {[...closings.map((x) => ({ at: x.from, k: 'c' + x.from, b: 'Fermé ' + span(x), small: x.label, status: x.status })), ...opens.map((x) => ({ at: x.day, k: 'o' + x.day, b: 'Ouvert ' + dates.dayLong(x.day), small: ivText(x.intervals) + ' · toute l’équipe', status: x.status }))]
                  .sort((a, b) => (a.at < b.at ? -1 : 1)).map((x) => <li key={x.k} className="li"><span className="li-main"><b>{x.b}</b><small>{x.small}</small></span><Tag s={x.status} /></li>)}
              </ul>
            </div>
          ) : null}
          {sc ? (
            <div className="mr-pre-b" data-part="school">
              <p className="section-k">{sc.staff}, en alternance</p>
              <ul className="list">
                {sc.days.length && sc.from && sc.until ? (
                  <li className="li">
                    <span className="li-main">
                      <b>{plural(sc.days.length, 'absence')} « {sc.reason} », {span({ from: sc.from, to: sc.until })}</b>
                      <small>Les semaines d’école : le mercredi à partir de 12 h et le jeudi toute la journée. Une absence par jour, visible dans Équipe.</small>
                      {sc.holidays.length ? <small>Semaine complète pendant les vacances (zone {sc.zone}, {sc.academie}) : {sc.holidays.map((h) => h.name + ' ' + span(h)).join(' · ')}</small> : null}
                      <small className="faint">Calendrier officiel {sc.year}, lu le {dates.dayShort(sc.read)}</small>
                    </span>
                    <Tag s={sc.todo ? 'create' : 'exists'} />
                  </li>
                ) : <li className="li"><span className="li-main"><b>Vacances non confirmées : à vérifier</b><small>Le calendrier scolaire de l’année qui vient n’est pas connu : aucune absence « {sc.reason} » n’est posée.</small></span></li>}
              </ul>
            </div>
          ) : null}
          {p.absences.some((a) => a.status !== 'past') ? (
            <div className="mr-pre-b" data-part="absences">
              <p className="section-k">Absences déjà posées sur l’ancien site</p>
              <ul className="list">{p.absences.filter((a) => a.status !== 'past').map((a) => <li key={a.staff + a.from} className="li"><span className="li-main"><b>{a.staff}</b><small>{cap(span(a))}</small></span><Tag s={a.status} /></li>)}</ul>
            </div>
          ) : null}
          {p.notes.length ? <Note tone="warn" icon="alert"><b>À savoir avant de confirmer</b><ul className="mr-notes">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul></Note> : null}
        </div>
      ) : null}
      <div className="row wrap" style={{ gap: 8 }}>
        {done ? <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>{open ? 'Masquer le détail' : 'Voir le détail'}</Button> : <Button variant="primary" icon="check" busy={busy} onClick={apply}>{onlyUpdates ? 'Mettre à jour' : 'Mettre le salon en place'}</Button>}
        {done ? <Link to="/equipe" className="btn btn-ghost btn-sm">Équipe<Icon name="chevR" size={14} /></Link> : null}
        {done ? <Link to="/catalogue" className="btn btn-ghost btn-sm">Catalogue<Icon name="chevR" size={14} /></Link> : null}
      </div>
      {p.noCode.length ? (
        <Note tone="warn" icon="key">
          <b>Sans code : {p.noCode.map((x) => x.name).join(', ')}.</b> Sans code, {p.noCode.length > 1 ? 'ils ne peuvent' : 'il ne peut'} ni entrer sur la tablette ni lier {p.noCode.length > 1 ? 'leur' : 'son'} téléphone.
          <div className="row wrap" style={{ gap: 8, marginTop: 8 }}><Button size="sm" variant="primary" icon="key" busy={coding} onClick={giveCodes}>Donner un code à {p.noCode.length > 1 ? 'chacun' : p.noCode[0].name}</Button></div>
        </Note>
      ) : null}
      <Modal open={!!codes} onClose={() => setCodes(null)} label="Codes de l’équipe">
        <h2>Les codes de l’équipe</h2>
        <p>Ils ne seront plus affichés. Donne à chacun le sien de vive voix : il le change ensuite lui-même dans Mon compte.</p>
        <ul className="list mr-codes">{(codes || []).map((x) => <li key={x.id} className="li"><span className="li-main"><b>{x.name}</b></span><b className="tnum mr-code">{x.pin}</b></li>)}</ul>
        <p className="faint" style={{ fontSize: 12.5 }}>Sur la tablette du salon, il touche son prénom puis tape son code. Pour son téléphone : Équipe, sa fiche, « Lier son téléphone », il scanne le QR code et entre le même code.</p>
        <div className="acts"><Button variant="primary" onClick={() => setCodes(null)}>C’est noté</Button></div>
      </Modal>
    </section>
  );
}
