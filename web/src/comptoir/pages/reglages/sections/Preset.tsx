// Mise en route › « Le salon, en un geste »: the real salon as the old site had it (server/presets/architecte.js),
// shown line by line before anything is written, then put in place on one confirmation (POST /api/v1/preset/apply).
// What already exists is never touched, so a second tap changes nothing. Then the first code of each barber: without
// one he is not on the tablet and cannot link his phone (POST /api/v1/preset/codes, shown once).
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
  count: { hours: number; rules: number; services: number; team: number; absences: number };
  hours: { to: Week; now: Week; status: Status };
  rules: { key: string; label: string; text: string; nowText: string; status: Status }[];
  services: { slug: string; name: string; category: string; price: number; dur: number; from: boolean; online: boolean; pack: { credits: number; days: number } | null; draft: boolean; status: 'create' | 'exists'; archived: boolean }[];
  team: { name: string; color: string; schedule: Week; status: 'create' | 'chair' | 'exists'; archived: boolean; hasPin: boolean }[];
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

const TAG: Record<string, string> = { create: 'à créer', chair: 'fauteuil à ajouter', exists: 'déjà là', set: 'à régler', same: 'déjà réglé', kept: 'ton réglage, gardé', past: 'passée' };
const Tag = ({ s }: { s: string }) => <span className={'badge' + (s === 'create' || s === 'chair' || s === 'set' ? ' badge-accent' : '')}>{TAG[s] || s}</span>;

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
  const what = [c.team ? plural(c.team, 'barbier') : '', c.services ? plural(c.services, 'prestation') : '', c.hours ? 'les horaires du salon' : '', c.rules ? plural(c.rules, 'règle') + ' de réservation' : '', c.absences ? plural(c.absences, 'absence') : ''].filter(Boolean);
  const after = async () => { refreshAll(); await Promise.all([refresh(), reloadBoot().catch(() => {})]); };
  const apply = async () => {
    if (!await confirm({ title: 'Mettre le salon en place ?', body: 'Seront créés : ' + what.join(', ') + '. Ce qui existe déjà n’est pas modifié, et tu peux tout ajuster ensuite.', ok: 'Mettre en place' })) return;
    setBusy(true);
    try {
      const r = await api.post<{ done: PresetPlan['count'] }>('/api/v1/preset/apply', {});
      const d = r.done;
      toast({ title: 'Le salon est en place', sub: [d.team ? plural(d.team, 'barbier') : '', d.services ? plural(d.services, 'prestation') : '', d.hours ? 'horaires' : '', d.rules ? plural(d.rules, 'règle') : '', d.absences ? plural(d.absences, 'absence') : ''].filter(Boolean).join(' · ') || 'Tout y était déjà.', icon: 'check', ttl: 8000 });
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
      <div className="card-h"><h2><Icon name="sparkle" size={16} />Le salon {p.name}, en un geste</h2><span className={'badge' + (done ? ' badge-ok' : ' badge-accent')}>{done ? 'en place' : plural(p.todo, 'ligne') + ' à créer'}</span></div>
      <p className="muted" style={{ fontSize: 13.5 }}>
        {done ? 'L’équipe, la carte, les horaires et les règles de l’ancien site sont en place. ' : 'L’équipe et ses vrais horaires, la carte et ses prix, les horaires du salon et ses règles de réservation, tels qu’ils sont sur l’ancien site. Rien n’est créé avant que tu confirmes ; ce qui existe déjà n’est jamais modifié. '}
        <span className="faint">{p.source}.</span>
      </p>
      {detail ? (
        <div className="mr-pre">
          <div className="mr-pre-b" data-part="team">
            <p className="section-k">Équipe</p>
            <ul className="list">{p.team.map((t) => (
              <li key={t.name} className="li">
                <span className="mr-dot" style={{ background: t.color }} aria-hidden />
                <span className="li-main"><b>{t.name}{t.archived ? ' (désactivé)' : ''}</b>{weekWords(t.schedule).map((l) => <small key={l}>{l}</small>)}<small className="faint">Repos : {restDays(t.schedule)}</small></span>
                <Tag s={t.status} />
              </li>
            ))}</ul>
          </div>
          <div className="mr-pre-b" data-part="services">
            <p className="section-k">Carte</p>
            <ul className="list">{p.services.map((x) => (
              <li key={x.slug} className="li">
                <span className="li-main"><b>{x.name}</b><small>{x.category} · {dur(x.dur)}{x.pack ? ' · carnet de ' + x.pack.credits + ' coupes, ' + x.pack.days + ' jours' : ''}{!x.online ? ' · au salon seulement' : ''}{x.archived ? ' · archivée' : ''}</small></span>
                <b className="tnum">{x.from ? <small className="faint">dès </small> : null}{eur(x.price)}</b>
                <Tag s={x.status} />
              </li>
            ))}</ul>
          </div>
          <div className="mr-pre-b" data-part="hours">
            <p className="section-k">Horaires du salon</p>
            <ul className="list">
              <li className="li"><span className="li-main"><b>{weekWords(p.hours.to).join(' · ')}</b><small>Fermé : {restDays(p.hours.to)}{p.hours.status === 'kept' ? ' · aujourd’hui : ' + (weekWords(p.hours.now).join(' · ') || 'fermé toute la semaine') : ''}</small></span><Tag s={p.hours.status} /></li>
              {p.rules.map((r) => <li key={r.key} className="li"><span className="li-main"><b>{r.label} {r.text}</b>{r.status === 'kept' ? <small>Aujourd’hui : {r.nowText}</small> : null}</span><Tag s={r.status} /></li>)}
            </ul>
          </div>
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
        {done ? <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>{open ? 'Masquer le détail' : 'Voir le détail'}</Button> : <Button variant="primary" icon="check" busy={busy} onClick={apply}>Mettre le salon en place</Button>}
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
