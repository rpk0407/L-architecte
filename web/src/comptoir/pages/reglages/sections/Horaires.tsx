// Horaires et fermetures: the usual week, exceptional closures and openings, the public holidays worth closing.
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { refreshAll } from '../../../../lib/query';
import { cap, dates, plural, time } from '../../../../lib/format';
import { Button, Chip, Note, confirm, toast, toastError } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { TimeSelect, WeekEditor, weekMinutes, weekOf, weekProblem, type Week } from '../../Equipe';
import { Card, SaveBar, useSave, useSection, type SectionProps } from '../shared';

function holidays(year: number) {
  // Easter (anonymous Gregorian algorithm), then the French public holidays
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const fixed: [string, string][] = [['01-01', 'Jour de l’an'], ['05-01', 'Fête du travail'], ['05-08', 'Victoire 1945'], ['07-14', 'Fête nationale'], ['08-15', 'Assomption'], ['11-01', 'Toussaint'], ['11-11', 'Armistice'], ['12-25', 'Noël']];
  return [...fixed.map(([md, label]) => ({ day: year + '-' + md, label })), { day: dates.addDays(easter, 1), label: 'Lundi de Pâques' }, { day: dates.addDays(easter, 39), label: 'Ascension' }, { day: dates.addDays(easter, 50), label: 'Lundi de Pentecôte' }].sort((x, y) => x.day.localeCompare(y.day));
}

type Opening = { id?: string; day: string; intervals: [number, number][]; label: string; staff: 'all' | string[] };
const ivText = (iv: [number, number][]) => iv.map(([a, b]) => time(a) + ' – ' + time(b)).join(' et ');

/** The last two Mondays of this December still to come: 'ouverts exceptionnellement les lundis 21 & 28 décembre'. */
function decemberMondays(today: string) {
  let d = today.slice(0, 4) + '-12-31';
  while (dates.weekday(d) !== 1) d = dates.addDays(d, -1);
  return [dates.addDays(d, -7), d].filter((x) => x >= today);
}

export default function Horaires({ s }: SectionProps) {
  const { boot, staffById } = useApp();
  const hours = useSection<Week>(weekOf(s.hours));
  const { busy, save } = useSave();
  const [cl, setCl] = useState({ from: boot.today, to: boot.today, label: 'Congés' });
  const closures: { id: string; from: string; to: string; label: string }[] = s.closures || [];
  const upcoming = closures.filter((c) => c.to >= boot.today);
  const y = Number(boot.today.slice(0, 4));
  const suggest = [...holidays(y), ...holidays(y + 1)].filter((h) => h.day >= boot.today && dates.diffDays(boot.today, h.day) <= 200 && (s.hours[dates.weekday(h.day)] || []).length && !closures.some((c) => c.from <= h.day && c.to >= h.day)).slice(0, 4);
  const addClosure = async (body: { from: string; to: string; label: string }) => {
    try { await api.post('/api/v1/settings/closures', body); toast({ title: 'Fermeture ajoutée', sub: 'Plus aucune réservation en ligne ces jours-là.', icon: 'lock' }); refreshAll(); }
    catch (e) { toastError(e); }
  };
  const total = weekMinutes(hours.v);

  /* exceptional openings: the whole list in one patch (settings/hours.js), so adding twice is harmless. The past ones
     are sent back too: the reports of those days count their hours (only those over 400 days old are dropped) */
  const all: Opening[] = s.openings || [];
  const kept = all.filter((o) => dates.diffDays(o.day, boot.today) <= 400);
  const openings = all.filter((o) => o.day >= boot.today);
  const chairs = boot.staff.filter((x) => x.active && x.chair);
  const usualOn = (day: string) => (s.hours[dates.weekday(day)] || []) as [number, number][];
  const closedOn = (day: string) => closures.find((c) => c.from <= day && c.to >= day);
  // the form starts on the next day the salon is usually closed (a Monday, here) that has no opening yet
  const blank = (list: Opening[]): Opening => {
    let day = dates.addDays(boot.today, 1);
    for (let i = 0; i < 60 && (usualOn(day).length || closedOn(day) || list.some((o) => o.day === day)); i++) day = dates.addDays(day, 1);
    return { day, intervals: [[540, 1110]], label: 'Ouverture exceptionnelle', staff: 'all' };
  };
  const [op, setOp] = useState<Opening>(() => blank(all));
  const saveOpenings = (list: Opening[], msg: string) => save({ openings: list.map(({ id: _id, ...o }) => o) }, msg);
  const addOpenings = async (add: Opening[], form = false) => {
    const taken = add.find((o) => all.some((x) => x.day === o.day));
    if (taken) { toast({ kind: 'err', title: 'Déjà une ouverture le ' + dates.dayLong(taken.day), sub: 'Supprime-la d’abord pour changer ses horaires.' }); return; }
    const list = [...kept, ...add];
    if (await saveOpenings(list, add.length > 1 ? 'Ouvertures ajoutées' : 'Ouverture ajoutée') && form) setOp(blank(list));
  };
  const mondays = (s.hours[1] || []).length ? [] : decemberMondays(boot.today).filter((d) => !all.some((o) => o.day === d) && !closedOn(d));
  const [a0, b0] = op.intervals[0];
  const usual = usualOn(op.day);
  const past = op.day < boot.today;
  // from 'everyone', a tap means 'only him'; then each tap adds or removes one
  const pick = (id: string) => {
    if (op.staff === 'all') { setOp({ ...op, staff: [id] }); return; }
    const next = op.staff.includes(id) ? op.staff.filter((x) => x !== id) : [...op.staff, id];
    setOp({ ...op, staff: next.length ? next : 'all' });
  };
  const names = (ids: string[]) => ids.map((id) => staffById.get(id)?.name).filter(Boolean).join(', ') || 'Personne';
  // as availability.js does it: on a usual day the team keeps its hours, those named do the opening's
  const who = (o: Opening) => usualOn(o.day).length
    ? (o.staff === 'all' ? 'chacun à ses horaires' : names(o.staff) + ' sur ces horaires, les autres aux leurs')
    : (o.staff === 'all' ? 'Toute l’équipe' : names(o.staff));
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Semaine type" icon="clock" aside={<span className="faint" style={{ fontSize: 13 }}>{Math.floor(total / 60)} h d’ouverture</span>}>
        <p className="muted" style={{ fontSize: 13.5 }}>Les horaires de chaque barbier restent à l’intérieur de ceux du salon. Le site ne propose jamais un créneau hors de ces heures.</p>
        <WeekEditor value={hours.v} onChange={hours.setV} offLabel={() => 'Fermé'} />
      </Card>
      <Card title="Fermetures exceptionnelles" icon="lock">
        {upcoming.length ? (
          <ul className="list">{upcoming.map((c) => (
            <li key={c.id} className="li">
              <span className="li-main"><b>{c.label}</b><small>{c.from === c.to ? cap(dates.dayLong(c.from)) : 'Du ' + dates.dayShort(c.from) + ' au ' + dates.dayShort(c.to) + ' · ' + plural(dates.diffDays(c.from, c.to) + 1, 'jour')}</small></span>
              <Button size="sm" variant="ghost" icon="trash" aria-label="Supprimer" onClick={async () => { if (!await confirm({ title: 'Rouvrir ces jours ?', ok: 'Rouvrir' })) return; try { await api.del('/api/v1/settings/closures/' + c.id); refreshAll(); } catch (e) { toastError(e); } }} />
            </li>
          ))}</ul>
        ) : <p className="muted">Aucune fermeture prévue.</p>}
        {suggest.length ? <div className="col" style={{ gap: 8 }}><p className="section-k">Jours fériés à venir, salon normalement ouvert</p><div className="chips">{suggest.map((h) => <Chip key={h.day} small onClick={() => addClosure({ from: h.day, to: h.day, label: h.label })}>+ {h.label} · {dates.dayShort(h.day)}</Chip>)}</div></div> : null}
        <div className="rg-closure">
          <input className="input" value={cl.label} maxLength={60} onChange={(e) => setCl({ ...cl, label: e.target.value })} aria-label="Motif" />
          <input className="input" type="date" value={cl.from} min={boot.today} onChange={(e) => e.target.value && setCl({ ...cl, from: e.target.value, to: cl.to < e.target.value ? e.target.value : cl.to })} aria-label="Du" />
          <input className="input" type="date" value={cl.to} min={cl.from} onChange={(e) => e.target.value && setCl({ ...cl, to: e.target.value })} aria-label="Au" />
          <Button variant="primary" icon="plus" disabled={!cl.label.trim()} onClick={() => addClosure(cl)}>Fermer</Button>
        </div>
        <p className="faint" style={{ fontSize: 12.5 }}>Les rendez-vous déjà pris ces jours-là ne sont pas annulés automatiquement : déplace-les depuis l’agenda.</p>
      </Card>
      <Card title="Ouvertures exceptionnelles" icon="sun">
        <p className="muted" style={{ fontSize: 13.5 }}>Un jour où le salon ouvre alors qu’il est fermé d’habitude, ou avec d’autres horaires. Le site l’annonce deux semaines avant et propose ses créneaux.</p>
        {openings.length ? (
          <ul className="list rg-openings">{openings.map((o) => {
            const shut = closedOn(o.day);
            return (
              <li key={o.day} className="li">
                <span className="li-main"><b>{o.label}</b><small>{cap(dates.dayLong(o.day))} · {ivText(o.intervals)} · {who(o)}</small>{shut ? <small style={{ color: 'var(--warn-tx)' }}>Fermeture « {shut.label} » ce jour-là : le salon reste fermé.</small> : null}</span>
                <Button size="sm" variant="ghost" icon="trash" aria-label={'Supprimer l’ouverture du ' + dates.dayLong(o.day)} disabled={busy} onClick={async () => { if (!await confirm({ title: 'Supprimer l’ouverture du ' + dates.dayLong(o.day) + ' ?', body: 'Le site ne proposera plus de créneaux ce jour-là. Les rendez-vous déjà pris restent dans l’agenda.', ok: 'Supprimer l’ouverture', cancel: 'Garder', danger: true })) return; saveOpenings(kept.filter((x) => x.day !== o.day), 'Ouverture supprimée'); }} />
              </li>
            );
          })}</ul>
        ) : <p className="muted">Aucune ouverture exceptionnelle prévue.</p>}
        {mondays.length ? <div className="col" style={{ gap: 8 }}><p className="section-k">En un geste</p><div className="chips"><Chip small disabled={busy} onClick={() => addOpenings(mondays.map((day) => ({ day, intervals: [[540, 1110]], label: 'Lundis de décembre', staff: 'all' })))}>+ {mondays.length > 1 ? 'Lundis' : 'Lundi'} de décembre · {mondays.map((d) => Number(d.slice(8))).join(' et ')} déc.</Chip></div></div> : null}
        <div className="row wrap rg-opening" style={{ gap: 8 }}>
          <input className="input" style={{ flex: '1 1 200px' }} value={op.label} maxLength={60} onChange={(e) => setOp({ ...op, label: e.target.value })} aria-label="Motif de l’ouverture" />
          <input className="input" style={{ flex: '1 1 150px' }} type="date" value={op.day} min={boot.today} onChange={(e) => e.target.value && setOp({ ...op, day: e.target.value })} aria-label="Jour de l’ouverture" />
          <span className="row" style={{ gap: 6, flex: '1 1 220px' }}>
            <label><span className="vh">Ouvre à</span><TimeSelect id="rg-op-from" value={a0} onChange={(m) => setOp({ ...op, intervals: [[m, b0]] })} /></label>
            <span className="faint" aria-hidden="true">→</span>
            <label><span className="vh">Ferme à</span><TimeSelect id="rg-op-to" value={b0} onChange={(m) => setOp({ ...op, intervals: [[a0, m]] })} /></label>
          </span>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {chairs.length > 1 ? (
            <div className="chips grow" role="group" aria-label={usual.length ? 'Qui fait ces horaires' : 'Qui travaille ce jour-là'}>
              <Chip small on={op.staff === 'all'} onClick={() => setOp({ ...op, staff: 'all' })}>{usual.length ? 'Chacun ses horaires' : 'Toute l’équipe'}</Chip>
              {chairs.map((x) => <Chip key={x.id} small dot={x.color} on={op.staff !== 'all' && op.staff.includes(x.id)} onClick={() => pick(x.id)}>{x.name}</Chip>)}
            </div>
          ) : <span className="grow" />}
          <Button variant="primary" icon="plus" busy={busy} disabled={!op.label.trim() || b0 <= a0 || past || (op.staff !== 'all' && !op.staff.length)} onClick={() => addOpenings([{ ...op, label: op.label.trim() }], true)}>Ouvrir</Button>
        </div>
        {past ? <Note tone="warn" icon="clock">Ce jour est passé : choisis un jour à venir.</Note>
          : closedOn(op.day) ? <Note tone="warn" icon="lock">Une fermeture couvre ce jour-là : elle l’emporte, le salon restera fermé.</Note>
          : usual.length ? <Note icon="info">Le salon ouvre d’habitude ce jour-là ({ivText(usual)}) : ces horaires remplacent les siens, et chaque barbier garde les siens à l’intérieur. Pour finir plus tard, choisis qui fait ces horaires-là.</Note> : null}
        <p className="faint" style={{ fontSize: 12.5 }}>{usual.length ? 'Les barbiers choisis travaillent tous ces horaires ; une absence posée dans Équipe compte toujours.' : 'Les barbiers qui ne travaillent pas ce jour-là d’habitude prennent ces horaires ; une absence posée dans Équipe compte toujours.'}</p>
      </Card>
      <SaveBar dirty={hours.dirty} busy={busy} onReset={hours.reset} onSave={() => { const pb = weekProblem(hours.v); if (pb) { toast({ kind: 'err', title: pb }); return; } save({ hours: hours.v }, 'Horaires du salon enregistrés'); }} />
    </div>
  );
}
