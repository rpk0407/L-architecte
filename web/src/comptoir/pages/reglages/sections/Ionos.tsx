// Connexion IONOS (Réglages, owner only): the salon keeps its domain and its mailbox at IONOS. Two parts, phone first.
// E-mail du salon: which variables Vercel has (never a secret: the password only as « posée », the user name only by its
// domain), the exact values to type there with a copy button each, where the mailbox password is at IONOS, the test e-mail
// in plain words (a refusal says what it means and what to do), then SPF and DKIM read from the domain's DNS: a help, never
// a gate. Nom de domaine: what changes at IONOS on the switch day and what never does (MX), the TTL two days before, and
// « Vérifier », the Jour J card's own DNS report (server/http/routes-bascule.js): the new site, still the old host, or half.
// Nothing here changes anything at IONOS or in Vercel. Server: GET /api/v1/ionos, POST /api/v1/ionos/{mail-dns,domain}.
import { useState, type ReactNode } from 'react';
import { api, qs, type ApiError } from '../../../../lib/api';
import { ago, clock, dates } from '../../../../lib/format';
import { useQuery } from '../../../../lib/query';
import { Link } from '../../../../lib/router';
import { Icon } from '../../../../ui/Icon';
import { Button, Note, Skeleton, toast, toastError } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { Card } from '../shared';
import './ionos.css';

type Var = { key: string; set: boolean; value: string; ok: boolean; note: string; secret?: boolean };
type Trouble = { kind: string; title: string; hint: string };
type Data = {
  demo: boolean; domain: string; stage: 'before' | 'day' | 'after'; switchedAt: number; frozenAt: number;
  mail: {
    provider: string | null; state: 'ok' | 'other' | 'partial' | 'none'; vars: Var[];
    expected: { host: string; port: string; alt: string; user: string; from: string }; limit: { hour: number; firstWeek: number };
    to: string; lastFailure: { at: number; error: string; trouble: Trouble } | null; hold: boolean;
  };
  spf: string; dkim: { name: string; target: string }[];
};
type Check = { state: 'ok' | 'todo' | 'warn' | 'info'; line: string; add?: string };
type MailDns = { domain: string; demo: boolean; spf: Check; dkim: Check; at?: number };
type Names = { a: string[]; aaaa: string[]; cname: string[]; vercel: boolean; old: string[] };
type Where = 'vercel' | 'ionos' | 'half' | 'none' | 'unknown';
type DomainCheck = { domain: string; demo: boolean; where: Where; step: { state: string; line: string }; apex?: Names; www?: Names; at?: number };
type TestResult = { ok: true; to: string; simulated: boolean; at?: number; via: string } | { ok: false; message: string; trouble?: Trouble };

// the domain the Jour J card remembers on this device: the same key, so the two screens agree
const KEY = 'lx-domain';
const readDomain = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const keepDomain = (d: string) => { try { if (d) localStorage.setItem(KEY, d); } catch { /* private window */ } };
const cleanTyped = (v: string) => v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^(www|ancien)\./, '');

async function copy(text: string, what?: string) {
  try { await navigator.clipboard.writeText(text); toast({ title: 'Copié', sub: what || text, icon: 'check' }); } catch { toast({ kind: 'err', title: 'Copie impossible : sélectionne le texte et copie-le.', icon: 'alert' }); }
}
const BADGE: Record<string, string> = { ok: 'badge-ok', todo: 'badge-warn', warn: 'badge-warn', info: 'badge-info' };
const WORD: Record<string, string> = { ok: 'bon', todo: 'à faire', warn: 'à vérifier', info: 'démo' };

export default function Ionos() {
  const [remembered] = useState(readDomain);
  const q = useQuery<Data>('/api/v1/ionos' + qs({ remembered }));
  const [domain, setDomain] = useState<string | null>(null);
  const d = q.data;
  if (!d) return q.error ? <section className="card"><Note tone="err" icon="alert">{q.error.message}</Note></section> : <Skeleton h={420} r={22} />;
  const dom = domain ?? d.domain;
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  return (
    <div className="col io" style={{ gap: 16 }}>
      <section className="card col io-head" style={{ gap: 10 }}>
        <div className="card-h"><h2><Icon name="globe" size={16} />Connexion IONOS</h2></div>
        <p className="muted" style={{ fontSize: 13.5 }}>Ton nom de domaine et ta boîte mail restent chez IONOS. Ici : ce qu’il faut brancher pour que les e-mails du salon partent par ta boîte, et ce qui change chez IONOS le jour de la bascule.</p>
        <div className="io-jump">
          <button type="button" className="chip" onClick={() => go('io-mail')}><Icon name="mail" size={15} />E-mail du salon</button>
          <button type="button" className="chip" onClick={() => go('io-domain')}><Icon name="globe" size={15} />Nom de domaine</button>
        </div>
      </section>
      <Mail d={d} domain={dom} refresh={() => void q.refresh()} />
      <Domain d={d} domain={dom} setDomain={(x) => { setDomain(x); keepDomain(x); }} />
    </div>
  );
}

/* ---------------- E-mail du salon ---------------- */

function Mail({ d, domain, refresh }: { d: Data; domain: string; refresh: () => void }) {
  const { now } = useApp();
  const M = d.mail;
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState<TestResult | null>(null);
  const [dnsRes, setDnsRes] = useState<MailDns | null>(null);
  const [pw, setPw] = useState(false);
  const badge = d.demo ? ['Démo · simulé', 'badge-info'] : M.state === 'ok' ? ['En service', 'badge-ok'] : M.state === 'other' ? ['Par ' + (M.provider === 'brevo' ? 'Brevo' : M.provider), 'badge-info'] : M.state === 'partial' ? ['Incomplet', 'badge-warn'] : ['À brancher', ''];
  // the values to type: the server's, with the domain typed here when the server knew none
  const user = M.expected.user || (domain ? 'rdv@' + domain : '');
  const from = M.expected.from || (user ? 'L’Architecte <' + user + '>' : '');
  const rows: { key: string; value: string; note?: string; copy: boolean }[] = [
    { key: 'SMTP_HOST', value: M.expected.host, copy: true },
    { key: 'SMTP_PORT', value: M.expected.port, note: 'Si l’e-mail test dit que le serveur ne répond pas : ' + M.expected.alt + '.', copy: true },
    { key: 'SMTP_USER', value: user || 'rdv@ton-domaine', note: 'L’adresse complète de la boîte.', copy: !!user },
    { key: 'SMTP_PASS', value: 'le mot de passe de cette boîte', note: 'Type « Sensitive » dans Vercel. Voir plus bas où le trouver.', copy: false },
    { key: 'EMAIL_FROM', value: from || 'L’Architecte <rdv@ton-domaine>', note: 'Une adresse du même domaine que la boîte : IONOS refuse les autres.', copy: !!from }
  ];
  const sendTest = async () => {
    setBusy('test');
    try {
      const r = await api.post<{ simulated: boolean; to: string; at?: number; provider: string | null }>('/api/v1/messages/channels/test-email', {});
      setTest({ ok: true, to: r.to, simulated: r.simulated, at: r.at, via: r.provider === 'smtp' ? 'par la boîte du salon' : r.provider ? 'par ' + (r.provider === 'brevo' ? 'Brevo' : r.provider) : '' });
    } catch (e) {
      const err = e as ApiError;
      setTest({ ok: false, message: err.message, trouble: err.extra && err.extra.trouble });
    } finally { setBusy(''); refresh(); }
  };
  const checkDns = async () => {
    if (!domain) { toast({ kind: 'err', title: 'Indique ton domaine dans « Nom de domaine », plus bas.', icon: 'alert' }); return; }
    setBusy('dns');
    try { setDnsRes(await api.post<MailDns>('/api/v1/ionos/mail-dns', { domain })); } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  const fail = M.lastFailure;
  return (
    <Card title="E-mail du salon" icon="mail" guide="ionos-mail" aside={<span className={'badge ' + badge[1]}>{badge[0]}</span>}>
      <span id="io-mail" className="io-anchor" />
      <p className="muted" style={{ fontSize: 13.5 }}>Les confirmations, les rappels par e-mail et ton résumé du soir partent par ta boîte IONOS. Le mot de passe reste dans Vercel : le Comptoir ne le voit jamais.</p>
      {M.hold && !d.demo ? <Note icon="info">Tu peux la brancher avant la bascule : les e-mails aux clients attendent le jour J ; le test et tes propres alertes partent tout de suite.</Note> : null}

      <p className="section-k">Dans Vercel aujourd’hui</p>
      <ul className="io-vars" aria-label="Variables de la boîte mail dans Vercel">
        {M.vars.map((v) => (
          <li key={v.key} className={'io-var ' + (v.set && v.ok ? 'ok' : !v.set && !v.ok ? 'miss' : v.ok ? 'opt' : 'bad')}>
            <Icon name={v.set && v.ok ? 'check' : v.ok ? 'info' : 'alert'} size={15} />
            <span className="io-main">
              <code>{v.key}</code>
              <small>{v.set ? (v.secret ? 'posée' + (v.value ? ' (' + v.value + ')' : '') : v.value) : v.ok ? (v.value ? v.value : 'pas posée') : 'manquante'}{v.note ? ' · ' + v.note : ''}</small>
            </span>
          </li>
        ))}
      </ul>

      <p className="section-k">À taper dans Vercel</p>
      <p className="faint io-p">Vercel › ton projet › Settings › Environment Variables, pour « Production ». Puis Deployments › le dernier › Redeploy : une variable ne compte qu’après un redéploiement.</p>
      <ul className="io-copy" aria-label="Valeurs à taper dans Vercel">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="io-main">
              <span className="io-k"><code>{r.key}</code><button type="button" className="io-mini" aria-label={'Copier le nom ' + r.key} onClick={() => void copy(r.key)}><Icon name="copy" size={14} /></button></span>
              <span className={r.copy ? 'io-v' : 'io-v faint'}>{r.value}</span>
              {r.note ? <small>{r.note}</small> : null}
            </span>
            {r.copy ? <Button size="sm" variant="subtle" icon="copy" aria-label={'Copier la valeur de ' + r.key} onClick={() => void copy(r.value, r.key + ' = ' + r.value)}>Copier</Button> : null}
          </li>
        ))}
      </ul>
      {!domain ? <Note icon="info">Indique ton domaine dans « Nom de domaine », plus bas : l’adresse de la boîte en dépend.</Note> : null}

      <button type="button" className="io-more" aria-expanded={pw} onClick={() => setPw(!pw)}><Icon name="key" size={15} />Où trouver le mot de passe de la boîte<Icon name={pw ? 'chevD' : 'chevR'} size={15} /></button>
      {pw ? (
        <div className="io-box">
          <p>IONOS ne le montre jamais. Si tu ne l’as plus, choisis-en un nouveau : compte IONOS › <b>E-mail</b> › sur la ligne de l’adresse, les trois points › <b>Modifier le mot de passe</b>. Il compte en quelques minutes.</p>
          <p>Si ton téléphone lit cette boîte (appli Mail), change-le aussi dans l’appli. Le plus simple : une adresse rien que pour le Comptoir{user ? ', par exemple ' + user : ''}, avec son propre mot de passe.</p>
        </div>
      ) : null}

      <div className="io-test">
        <Button variant="primary" icon="mail" busy={busy === 'test'} disabled={!d.demo && !M.provider} onClick={() => void sendTest()}>Envoyer un e-mail test</Button>
        <small className="faint">{!d.demo && !M.provider ? 'Pose d’abord les variables ci-dessus, puis redéploie.' : 'Vers ' + (M.to || 'ton e-mail') + '. Trois tests par heure.'}</small>
      </div>
      {test ? <TestNote r={test} /> : null}
      {!test && fail && now() - fail.at < 7 * 86400000 ? <Note tone="warn" icon="alert">Dernier e-mail en échec {ago(fail.at, now())} : <b>{fail.trouble.title}.</b> {fail.trouble.hint}</Note> : null}
      <p className="faint io-p">IONOS laisse partir {M.limit.hour} e-mails par heure d’une boîte ({M.limit.firstWeek} la première semaine d’une boîte neuve). Le salon en envoie quelques dizaines par jour.</p>

      <p className="section-k" style={{ marginTop: 4 }}>Arriver en boîte de réception (SPF et DKIM)</p>
      <p className="faint io-p">Ces deux lignes des DNS prouvent que les e-mails viennent bien d’IONOS. Tant que les DNS restent chez IONOS, il les met tout seul. Rien n’est bloqué par cette vérification.</p>
      <div className="io-test"><Button variant="subtle" icon="shieldOk" busy={busy === 'dns'} onClick={() => void checkDns()}>Vérifier SPF et DKIM</Button>{domain ? <small className="faint">Sur {domain}.</small> : null}</div>
      {dnsRes ? (
        <ul className="io-checks" aria-label="SPF et DKIM">
          <CheckRow name="SPF" c={dnsRes.spf} extra={dnsRes.spf.add ? <span className="io-add"><code>{dnsRes.spf.add}</code><Button size="sm" variant="subtle" icon="copy" onClick={() => void copy(dnsRes.spf.add!)}>Copier</Button></span> : null} />
          <CheckRow name="DKIM" c={dnsRes.dkim} />
        </ul>
      ) : null}
    </Card>
  );
}

function CheckRow({ name, c, extra }: { name: string; c: Check; extra?: ReactNode }) {
  return (
    <li className="io-check" data-state={c.state}>
      <span className="io-main"><b>{name}</b><small>{c.line}</small>{extra}</span>
      <span className={'badge ' + (BADGE[c.state] || '')}>{WORD[c.state] || c.state}</span>
    </li>
  );
}

/** The test e-mail, in plain words: where it went, or what the refusal means and what to do. */
function TestNote({ r }: { r: TestResult }) {
  if (r.ok) return r.simulated ? <Note icon="info">Démo : rien ne part vraiment. En production, l’e-mail test partirait vers {r.to}.</Note>
    : <Note tone="ok" icon="check">Parti vers {r.to}{r.at ? ' à ' + clock(r.at) : ''}{r.via ? ', ' + r.via : ''}. Il arrive dans la minute : regarde aussi les indésirables.</Note>;
  const t = r.trouble;
  return (
    <div className="io-fail" role="alert">
      <Note tone="err" icon="alert"><b>{t ? t.title + '.' : 'L’e-mail n’est pas parti.'}</b> {t ? t.hint : r.message}</Note>
      {t && t.kind !== 'config' && t.kind !== 'other' ? <small className="faint">Les mots du serveur : {r.message.replace(/^Refusé : /, '')}</small> : null}
    </div>
  );
}

/* ---------------- Nom de domaine ---------------- */

const WHERE: Record<Where, { t: string; tone: string }> = {
  vercel: { t: 'Pointe vers le nouveau site', tone: 'badge-ok' },
  ionos: { t: 'Encore sur l’ancien site', tone: 'badge-info' },
  half: { t: 'À moitié fait', tone: 'badge-warn' },
  none: { t: 'Aucune adresse', tone: 'badge-warn' },
  unknown: { t: 'Vérification impossible', tone: 'badge-warn' }
};

/** The message the owner forwards to whoever does the DNS (WhatsApp, e-mail): the day, the two lines, what never changes. */
function brief(domain: string) {
  const dm = domain || 'ton-domaine';
  return [
    'Bascule du site ' + dm + ' vers Vercel, le lundi de la bascule seulement.',
    '',
    '48 h avant : chez IONOS, TTL de @ et de www à 300 s ; noter les valeurs actuelles (A, AAAA, CNAME) pour le plan de retour.',
    '',
    'Le jour J, chez IONOS (Domaines › DNS) :',
    '- A @ : l’adresse que Vercel affiche pour le projet (Vercel › Settings › Domains, souvent 76.76.21.21 ou 216.198.79.1)',
    '- CNAME www : la cible que Vercel affiche pour www (du type xxxx.vercel-dns-017.com)',
    '- supprimer les autres A et AAAA de @, et l’ancienne ligne de www',
    '',
    'Ne pas toucher : MX (la boîte mail), TXT SPF, CNAME _domainkey (DKIM), serveurs de noms (NS) : tout reste chez IONOS.',
    'Puis Comptoir › Réglages › Connexion IONOS › Vérifier, et la carte Jour J.'
  ].join('\n');
}

function Domain({ d, domain, setDomain }: { d: Data; domain: string; setDomain: (d: string) => void }) {
  const { now } = useApp();
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<DomainCheck | null>(null);
  const text = typed ?? domain;
  const verify = async () => {
    const dom = cleanTyped(text);
    if (!dom) { toast({ kind: 'err', title: 'Indique ton domaine, par exemple barberlarchitecte.com.', icon: 'alert' }); return; }
    setBusy(true);
    try { const r = await api.post<DomainCheck>('/api/v1/ionos/domain', { domain: dom, refresh: true }); setRes(r); setDomain(r.domain); setTyped(null); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const stage = d.stage;
  const day = (ms: number) => { const p = dates.dayParts(dates.localParts(ms).day); return p.d + (p.d === 1 ? 'er ' : ' ') + dates.MONTHS_FR[p.m - 1]; };
  const aside = stage === 'after' ? ['Bascule faite', 'badge-ok'] : stage === 'day' ? ['Jour J', 'badge-warn'] : ['Pas avant le jour J', 'badge-info'];
  // the check read against the day: before it the old site is the right answer, a domain already moved is the alarm
  const early = res && !res.demo && stage === 'before' && (res.where === 'vercel' || res.where === 'half');
  return (
    <Card title="Nom de domaine" icon="globe" guide="ionos-domain" aside={<span className={'badge ' + aside[1]}>{aside[0]}</span>}>
      <span id="io-domain" className="io-anchor" />
      {stage === 'before' ? <Note tone="warn" icon="lock"><b>Ne rien changer avant le lundi de la bascule.</b> Ce jour-là, ton prestataire change deux lignes chez IONOS ; ta boîte mail ne bouge pas.</Note>
        : stage === 'day' ? <Note tone="accent" icon="bolt">C’est le jour J : WordPress est bloqué depuis le {day(d.frozenAt)}. Change les deux lignes ci-dessous, puis « Vérifier ». La carte <Link to="/reglages/wordpress" className="link">Jour J</Link> suit le reste.</Note>
          : <Note tone="ok" icon="check">Bascule faite le {day(d.switchedAt)}. Garde le domaine et la boîte mail chez IONOS.</Note>}

      <ol className="io-steps">
        <li><b>48 h avant</b><span>Chez IONOS, baisse le TTL de <code>@</code> et de <code>www</code> à 300 secondes, et note les valeurs actuelles : c’est le plan de retour.</span></li>
        <li><b>Dans Vercel</b><span>Ton projet › Settings › Domains : ajoute {domain || 'ton domaine'} et www.{domain || 'ton domaine'}. Vercel affiche les deux valeurs à recopier, propres à ton projet.</span></li>
        <li><b>Le jour J, chez IONOS</b><span>Domaines › DNS, deux lignes :</span></li>
      </ol>
      <ul className="io-recs" aria-label="Les deux lignes à changer chez IONOS">
        <li><span className="io-rec"><b>A</b><code>@</code></span><span className="io-main"><span>L’adresse que Vercel affiche pour ton projet</span><small>Souvent 76.76.21.21, ou 216.198.79.1 pour un projet récent.</small></span></li>
        <li><span className="io-rec"><b>CNAME</b><code>www</code></span><span className="io-main"><span>La cible que Vercel affiche pour www</span><small>Du type xxxx.vercel-dns-017.com.</small></span></li>
      </ul>
      <p className="faint io-p">Supprime les autres lignes A et AAAA de <code>@</code>, et l’ancienne ligne de <code>www</code> : une seule qui reste envoie une partie des visiteurs sur l’ancien site.</p>

      <Note tone="err" icon="alert"><b>Ne touche jamais aux lignes MX</b> : ce sont elles qui amènent les e-mails dans la boîte du salon. Les TXT (SPF), les CNAME <code>_domainkey</code> (DKIM) et les serveurs de noms restent aussi comme ils sont.</Note>
      <div className="io-test"><Button variant="subtle" icon="copy" className="io-wrap" onClick={() => void copy(brief(domain), 'Les consignes pour ton prestataire')}>Copier pour ton prestataire</Button><small className="faint">Les deux lignes et ce qui ne bouge pas, à lui envoyer par WhatsApp ou e-mail.</small></div>

      <form className="io-dom" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
        <label htmlFor="io-dom">Ton domaine</label>
        <input id="io-dom" className="input" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="barberlarchitecte.com" value={text} onChange={(e) => setTyped(e.target.value)} />
        <Button type="submit" variant="subtle" icon="globe" busy={busy}>Vérifier</Button>
      </form>
      {res ? (
        <div className="io-res" data-where={res.where}>
          <div className="io-res-h"><span className={'badge ' + (res.demo ? 'badge-info' : WHERE[res.where].tone)}>{res.demo ? 'Démo' : WHERE[res.where].t}</span>{res.at ? <small className="faint">{ago(res.at, now())}</small> : null}</div>
          {/* before the day the old site is the right answer: the Jour J card's « change les DNS » would say the opposite of « ne rien changer » */}
          <p>{!res.demo && stage === 'before' && res.where === 'ionos' ? res.domain + ' et www pointent encore vers l’ancien site, chez IONOS.' : res.step.line}</p>
          {!res.demo && res.apex && res.www ? (
            <ul className="io-names">
              <NameRow host={res.domain} n={res.apex} />
              <NameRow host={'www.' + res.domain} n={res.www} />
            </ul>
          ) : null}
          {!res.demo && stage === 'before' && res.where === 'ionos' ? <Note icon="check">Normal avant le jour J : ne change rien.</Note> : null}
          {early ? <Note tone="warn" icon="alert">Le domaine a déjà changé alors que la bascule n’est pas faite : WordPress reçoit encore les réservations. Vois avec ton prestataire, et suis la carte <Link to="/reglages/wordpress" className="link">Jour J</Link>.</Note> : null}
        </div>
      ) : null}
      <p className="faint io-p">Les anciennes adresses du site et l’ancien site garé se vérifient dans <Link to="/reglages/wordpress" className="link">Reprendre WordPress › Jour J</Link>.</p>
    </Card>
  );
}

function NameRow({ host, n }: { host: string; n: Names }) {
  const vals = [...n.cname.map((c) => 'CNAME ' + c), ...(n.cname.some((c) => /vercel-dns/i.test(c)) ? [] : n.a.map((a) => 'A ' + a)), ...n.aaaa.map((a) => 'AAAA ' + a)];
  const state = n.vercel && !n.old.length ? 'Vercel' : n.vercel ? 'Vercel et l’ancien' : vals.length ? 'ancien site' : 'rien';
  return <li><b>{host}</b><small>{state}{vals.length ? ' · ' + vals.join(', ') : ''}</small></li>;
}
