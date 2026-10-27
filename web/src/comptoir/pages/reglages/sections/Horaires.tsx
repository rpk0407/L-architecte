// Horaires et fermetures: the usual week, exceptional closures and the public holidays worth closing.
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { refreshAll } from '../../../../lib/query';
import { cap, dates, plural } from '../../../../lib/format';
import { Button, Chip, confirm, toast, toastError } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { WeekEditor, weekMinutes, weekOf, weekProblem, type Week } from '../../Equipe';
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

export default function Horaires({ s }: SectionProps) {
  const { boot } = useApp();
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
      <SaveBar dirty={hours.dirty} busy={busy} onReset={hours.reset} onSave={() => { const pb = weekProblem(hours.v); if (pb) { toast({ kind: 'err', title: pb }); return; } save({ hours: hours.v }, 'Horaires du salon enregistrés'); }} />
    </div>
  );
}
