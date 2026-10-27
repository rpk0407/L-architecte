// Devices, data and the activity log: the proof that the books were never touched, and who did what.
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { ago, cap, clock, dates, eur, plural } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Button, Chip, Empty, Field, Note, Skeleton, confirm, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';

export default function System({ section }: { section: string }) {
  if (section === 'appareils') return <Devices />;
  if (section === 'journal') return <Journal />;
  return <Data />;
}

/* ---------------- devices ---------------- */

function Devices() {
  const { boot, reloadBoot, now } = useApp();
  const { data, loading } = useQuery<{ items: { id: string; name: string; at: number; by: string; current: boolean }[] }>('/api/v1/devices');
  const [name, setName] = useState('Comptoir');
  const [busy, setBusy] = useState(false);
  const here = data?.items.find((d) => d.current) || (boot.me.device ? { name: boot.me.device.name } : null);
  const enroll = async () => {
    setBusy(true);
    try { await api.post('/api/auth/device', { name: name.trim() || 'Poste du salon' }); toast({ title: 'Ce poste est enregistré', sub: 'L’équipe peut s’y connecter avec son code.', icon: 'device' }); refreshAll(); await reloadBoot(); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const revoke = async (d: { id: string; name: string; current: boolean }) => {
    if (!await confirm({ title: 'Retirer « ' + d.name + ' » ?', body: d.current ? 'C’est cet appareil : la connexion par code n’y sera plus possible.' : 'Les sessions ouvertes par code sur cet appareil sont fermées immédiatement.', ok: 'Retirer', danger: true })) return;
    try { await api.del('/api/v1/devices/' + d.id); toast('Appareil retiré'); refreshAll(); } catch (e) { toastError(e); }
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <section className="card col" style={{ gap: 12 }}>
        <div className="card-h"><h2><Icon name="device" size={16} />Cet appareil</h2>{here ? <span className="badge badge-ok">enregistré</span> : <span className="badge">non enregistré</span>}</div>
        {here ? (
          <p className="muted" style={{ fontSize: 14 }}>« {here.name} » propose la connexion rapide par code PIN à toute l’équipe.</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 14 }}>Enregistre l’iPad du comptoir, le téléphone de la caisse ou l’ordinateur du salon : l’équipe pourra s’y connecter avec son code en deux secondes. Ailleurs, seul le mot de passe fonctionne.</p>
            <div className="row" style={{ gap: 8 }}><input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Nom de l’appareil" /><Button variant="primary" icon="plus" busy={busy} onClick={enroll}>Enregistrer ce poste</Button></div>
          </>
        )}
      </section>
      <section className="card">
        <div className="card-h"><h2><Icon name="shield" size={16} />Appareils autorisés</h2></div>
        {loading && !data ? <Skeleton h={120} /> : !data?.items.length ? <Empty icon="device" title="Aucun appareil">Sans appareil enregistré, personne ne peut se connecter par code.</Empty> : (
          <ul className="list">{data.items.map((d) => (
            <li key={d.id} className="li">
              <span className="rg-dev"><Icon name="device" size={18} /></span>
              <span className="li-main"><b>{d.name}{d.current ? <span className="badge badge-info" style={{ marginLeft: 8 }}>cet appareil</span> : null}</b><small>Ajouté {ago(d.at, now())} par {d.by}</small></span>
              <Button size="sm" variant="ghost" icon="trash" onClick={() => revoke(d)}>Retirer</Button>
            </li>
          ))}</ul>
        )}
        <p className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>Un appareil perdu ou volé : retire-le ici, il ne peut plus rien ouvrir. Le jeton est stocké chiffré côté serveur, jamais en clair.</p>
      </section>
    </div>
  );
}

/* ---------------- data, integrity, system ---------------- */

type Integrity = { ok: boolean; count: number; head?: string; brokenAt?: number; reason?: string; ms: number; first: number | null; closures: { ref: string; day: string; seal: string; net: number }[]; store: string };
type Sys = { mode: string; store: string; version: number; events: number; head: string; payments: { provider: string; live: boolean }; sms: string | null; warnings: string[]; setupProtected: boolean; devices: number };
const STORE: Record<string, string> = { postgres: 'Base Postgres', blob: 'Vercel Blob', file: 'Fichier local', memory: 'Mémoire (temporaire)' };

function Data() {
  const { boot, can } = useApp();
  const [chk, setChk] = useState<Integrity | null>(null);
  const [busy, setBusy] = useState(false);
  const sys = useQuery<Sys>(can('settings') ? '/api/v1/system' : null);
  const verify = async () => {
    setBusy(true);
    try { setChk(await api.get<Integrity>('/api/v1/integrity')); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  useEffect(() => { if (can('audit')) verify(); }, []);
  const month = dates.monthStart(boot.today);
  return (
    <div className="col" style={{ gap: 16 }}>
      {can('audit') ? (
        <section className="card col" style={{ gap: 12 }}>
          <div className="card-h"><h2><Icon name="shieldOk" size={16} />Intégrité du journal</h2><Button size="sm" variant="ghost" icon="undo" busy={busy} onClick={verify}>Vérifier</Button></div>
          {!chk ? <Skeleton h={80} /> : chk.ok ? (
            <div className="rg-proof ok">
              <Icon name="shieldOk" />
              <div><b>Journal intact</b><p>{plural(chk.count, 'opération')} vérifiée{chk.count > 1 ? 's' : ''} une à une en {chk.ms} ms{chk.first ? ', depuis le ' + dates.dayShort(dates.localParts(chk.first).day) + ' ' + dates.localParts(chk.first).day.slice(0, 4) : ''}. Chaque opération porte l’empreinte de la précédente : modifier ou supprimer une vente casserait la chaîne.</p></div>
            </div>
          ) : (
            <div className="rg-proof err"><Icon name="alert" /><div><b>Anomalie à l’opération n° {chk.brokenAt}</b><p>{chk.reason}. Contacte immédiatement la personne qui gère l’installation et conserve l’export du journal.</p></div></div>
          )}
          {chk?.head ? <p className="seal">Empreinte actuelle {chk.head}</p> : null}
          {chk?.closures.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Clôture</th><th>Jour</th><th className="num">Net</th><th>Sceau</th></tr></thead>
              <tbody>{chk.closures.map((z) => <tr key={z.ref}><td>{z.ref}</td><td>{cap(dates.dayShort(z.day))}</td><td className="num money">{eur(z.net)}</td><td className="seal">{z.seal.slice(0, 16)}…</td></tr>)}</tbody>
            </table></div>
          ) : null}
          <p className="faint" style={{ fontSize: 12.5 }}>Inspiré des exigences d’inaltérabilité des logiciels de caisse (loi anti-fraude TVA, NF525). La certification officielle par un organisme agréé reste une démarche à part.</p>
        </section>
      ) : null}

      {can('settings') ? <Backups /> : null}

      <section className="card col" style={{ gap: 10 }}>
        <div className="card-h"><h2><Icon name="download" size={16} />Exports</h2></div>
        <div className="rp-exports">
          {can('data') ? <a className="rp-exp" href="/api/v1/export?kind=journal" download><Icon name="shield" /><span><b>Archive complète du journal</b><small>JSON vérifiable hors ligne, sans données personnelles</small></span><Icon name="download" /></a> : null}
          {can('client.export') ? <a className="rp-exp" href="/api/v1/export?kind=clients" download><Icon name="clients" /><span><b>Fichier clients</b><small>CSV, pour une sauvegarde ou un changement d’outil</small></span><Icon name="download" /></a> : null}
          {can('report.shop') ? <a className="rp-exp" href={'/api/v1/export?kind=vat&from=' + month.slice(0, 4) + '-01-01&to=' + boot.today} download><Icon name="lock" /><span><b>Clôtures Z de l’année</b><small>Pour le comptable et un contrôle fiscal</small></span><Icon name="download" /></a> : null}
        </div>
        <p className="muted" style={{ fontSize: 13.5 }}>Tes données t’appartiennent : tout s’exporte, à tout moment, sans demander à personne.</p>
      </section>

      <section className="card col" style={{ gap: 10 }}>
        <div className="card-h"><h2><Icon name="lock" size={16} />Données personnelles (RGPD)</h2></div>
        <p className="muted" style={{ fontSize: 13.5 }}>Les noms, numéros et notes des clients sont stockés à part des opérations comptables. Un client qui demande l’effacement est effacé depuis sa fiche (menu ⋯) : ses tickets restent dans les comptes, sans son nom, et le journal reste vérifiable.</p>
        <p className="muted" style={{ fontSize: 13.5 }}>Les barbiers ne voient que la fin des numéros. Les exports de clients sont réservés au gérant.</p>
      </section>

      {sys.data ? (
        <section className="card col" style={{ gap: 4 }}>
          <div className="card-h"><h2><Icon name="info" size={16} />Système</h2></div>
          <div className="kv"><span>Mode</span><b>{sys.data.mode === 'demo' ? 'Démonstration' : 'Production'}</b></div>
          <div className="kv"><span>Stockage</span><b>{STORE[sys.data.store] || sys.data.store}</b></div>
          <div className="kv"><span>Opérations enregistrées</span><b className="tnum">{sys.data.events.toLocaleString('fr-FR')}</b></div>
          <div className="kv"><span>Paiement en ligne</span><b>{sys.data.payments.provider === 'stripe' ? 'Stripe' + (sys.data.payments.live ? ' (réel)' : ' (test)') : 'Simulé'}</b></div>
          <div className="kv"><span>SMS</span><b>{sys.data.sms ? cap(sys.data.sms) : sys.data.mode === 'demo' ? 'Simulés' : 'Non branché'}</b></div>
          <div className="kv"><span>Appareils autorisés</span><b>{sys.data.devices}</b></div>
          {sys.data.warnings.map((w) => <Note key={w} tone="warn" icon="alert">{w}</Note>)}
        </section>
      ) : null}

      {boot.mode === 'demo' && boot.me.role === 'owner' ? (
        <section className="card col" style={{ gap: 10 }}>
          <div className="card-h"><h2><Icon name="undo" size={16} />Démo</h2></div>
          <p className="muted" style={{ fontSize: 13.5 }}>Remet la démo à zéro : dix semaines d’activité recréées autour d’aujourd’hui, comme au premier jour.</p>
          <div><Button variant="danger" icon="undo" onClick={async () => {
            if (!await confirm({ title: 'Remettre la démo à zéro ?', body: 'Tout ce qui a été fait pendant la démo est effacé.', ok: 'Remettre à zéro', danger: true })) return;
            try { await api.post('/api/v1/demo/reset'); location.reload(); } catch (e) { toastError(e); }
          }}>Remettre à zéro</Button></div>
        </section>
      ) : null}
    </div>
  );
}

/* ---------------- encrypted backups ---------------- */

type BackupItem = { name: string; day: string; at: number; count: number | null; size: number | null };
type BackupStatus = { blob: boolean; key: boolean; keyProblem: string; off: string; items: BackupItem[]; last: BackupItem | null; unreadable: boolean; error: string; staleAfterMs: number; keep: { daily: number; monthly: number } };

/** "cette nuit 03:02", "aujourd’hui 14:10", "hier 03:02", "le 24/10 à 03:02" */
function backupWhen(at: number, today: string) {
  const p = dates.localParts(at);
  const t = clock(at);
  if (p.day === today) return (p.min < 6 * 60 ? 'cette nuit ' : 'aujourd’hui ') + t;
  if (p.day === dates.addDays(today, -1)) return 'hier ' + t;
  return 'le ' + p.day.slice(8) + '/' + p.day.slice(5, 7) + ' à ' + t;
}

function Backups() {
  const { boot, now } = useApp();
  const { data, loading, refresh } = useQuery<BackupStatus>('/api/v1/backups');
  const [busy, setBusy] = useState(false);
  // once more a little later: the visit that wakes the scheduler after 03:00 may be the one writing tonight’s backup
  useEffect(() => { const t = setTimeout(() => { refresh(); }, 8000); return () => clearTimeout(t); }, []);
  const saveNow = async () => {
    setBusy(true);
    try { await api.post('/api/v1/backups/now'); toast({ title: 'Sauvegarde faite', sub: 'Chiffrée et rangée avec les autres.', icon: 'shieldOk' }); await refresh(); }
    catch (e) { toastError(e); await refresh(); } finally { setBusy(false); }
  };
  if (loading && !data) return <section className="card"><Skeleton h={120} /></section>;
  if (!data) return null;
  const last = data.last;
  const stale = !last || now() - last.at > data.staleAfterMs;
  // a demo (or a preview) writes nothing, on purpose: say how it works in production, without alarming
  const quietDemo = boot.mode === 'demo' || !!data.off;
  const problem = !data.key ? data.keyProblem
    : !data.blob ? 'Aucun stockage Blob relié (BLOB_READ_WRITE_TOKEN) : pas de sauvegarde automatique, et un gros salon ne se télécharge plus d’un bloc. Relie un stockage Blob (accès privé) ; en attendant, télécharge la sauvegarde chiffrée et range-la en lieu sûr.'
      : data.error || (stale ? (last ? 'La dernière sauvegarde date de plus de 36 h : celle de la nuit n’a pas eu lieu.' : 'Aucune sauvegarde pour l’instant : la première se fera cette nuit, ou maintenant.') : '');
  const title = last ? 'Dernière sauvegarde : ' + backupWhen(last.at, boot.today) + (problem ? '' : ' ✓') : data.unreadable ? 'Sauvegardes illisibles pour l’instant' : 'Aucune sauvegarde';
  return (
    <section className="card col" style={{ gap: 12 }}>
      <div className="card-h"><h2><Icon name="lock" size={16} />Sauvegardes</h2>{data.items.length ? <span className="faint" style={{ fontSize: 13 }}>{plural(data.items.length, 'copie')}</span> : null}</div>
      {quietDemo ? (
        <Note icon="info">{boot.mode === 'demo' ? 'En démo, rien n’est sauvegardé.' : data.off} En production, le salon entier (clients compris) est chiffré chaque nuit vers 3 h avec ta clé BACKUP_KEY : {data.keep.daily} jours et {data.keep.monthly} mois gardés.</Note>
      ) : (
        <div className={'rg-proof ' + (problem ? 'err' : 'ok')}>
          <Icon name={problem ? 'alert' : 'shieldOk'} />
          <div>
            <b style={{ fontSize: 22 }}>{title}</b>
            <p>{problem || (last && last.count != null ? plural(last.count, 'opération') + ', clients et accès compris, ' : 'Le salon entier, ') + 'chiffré avec ta clé BACKUP_KEY. On garde ' + data.keep.daily + ' jours et ' + data.keep.monthly + ' mois.'}</p>
          </div>
        </div>
      )}
      {quietDemo && !data.key ? null : <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {data.key ? <a className="btn btn-ghost" href="/api/v1/backups/latest" download><Icon name="download" />Télécharger la sauvegarde chiffrée</a> : <Button variant="ghost" icon="download" disabled>Télécharger la sauvegarde chiffrée</Button>}
        <Button variant="subtle" icon="shieldOk" busy={busy} disabled={!data.key || !data.blob || !!data.off} onClick={saveNow}>Sauvegarder maintenant</Button>
      </div>
      <p className="faint" style={{ fontSize: 12.5 }}>Garde une copie de la clé BACKUP_KEY hors de l’hébergement (gestionnaire de mots de passe) : sans elle, une sauvegarde ne s’ouvre pas, même par nous. Pour réinstaller le salon : un déploiement neuf avec la même clé, puis « Installer depuis une sauvegarde » sur l’écran d’installation.</p>
      </>}
    </section>
  );
}

/* ---------------- the activity log ---------------- */

type AuditItem = { v: number; at: number; type: string; label: string; summary: string; actor: string; actorId: string; device: string; hash: string };
const KINDS: [string, string][] = [['', 'Tout'], ['appt.', 'Rendez-vous'], ['sale.', 'Ventes'], ['drawer.', 'Caisse'], ['day.', 'Clôtures'], ['client.', 'Clients'], ['staff.', 'Équipe'], ['settings.', 'Réglages'], ['payment.', 'Paiements'], ['device.', 'Appareils']];

function Journal() {
  const { boot, now } = useApp();
  const [type, setType] = useState('');
  const [actor, setActor] = useState('');
  const [pages, setPages] = useState<AuditItem[][]>([]);
  const [busy, setBusy] = useState(false);
  const [end, setEnd] = useState(false);
  const load = async (reset: boolean) => {
    setBusy(true);
    try {
      const before = reset ? '' : String(pages.flat().slice(-1)[0]?.v || '');
      const r = await api.get<{ items: AuditItem[] }>('/api/v1/audit?limit=60' + (type ? '&type=' + type : '') + (actor ? '&actor=' + encodeURIComponent(actor) : '') + (before ? '&before=' + before : ''));
      setPages(reset ? [r.items] : [...pages, r.items]);
      setEnd(r.items.length < 60);
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  useEffect(() => { load(true); }, [type, actor]);
  const items = pages.flat();
  const days = new Map<string, AuditItem[]>();
  for (const x of items) { const d = dates.localParts(x.at).day; if (!days.has(d)) days.set(d, []); days.get(d)!.push(x); }
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="chips rp-periods">{KINDS.map(([k, t]) => <Chip key={k} small on={type === k} onClick={() => setType(k)}>{t}</Chip>)}</div>
      <Field label="Qui"><select className="input select" value={actor} onChange={(e) => setActor(e.target.value)} style={{ maxWidth: 260 }}><option value="">Tout le monde</option>{boot.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="web">Clients (site)</option><option value="scheduler">Automatique</option></select></Field>
      {!items.length && busy ? <Skeleton h={300} r={22} /> : !items.length ? <Empty icon="journal" title="Rien à afficher" /> : (
        [...days].map(([d, xs]) => (
          <section key={d} className="card">
            <div className="card-h"><h2>{cap(dates.dayLong(d))}</h2><span className="faint" style={{ fontSize: 13 }}>{xs.length}</span></div>
            <ul className="rg-log">{xs.map((x) => (
              <li key={x.v}>
                <span className="t tnum">{clock(x.at)}</span>
                <span className="m"><b>{x.label}</b>{x.summary ? <span> · {x.summary}</span> : null}<small>{x.actor}{x.device ? ' · ' + x.device : ''} · n° {x.v} · {x.hash}</small></span>
              </li>
            ))}</ul>
          </section>
        ))
      )}
      {items.length && !end ? <Button variant="ghost" block busy={busy} onClick={() => load(false)}>Plus ancien</Button> : null}
      <p className="faint" style={{ fontSize: 12.5 }}>Le journal ne s’efface pas et ne se modifie pas. Dernière mise à jour {ago(now(), now())}.</p>
    </div>
  );
}
