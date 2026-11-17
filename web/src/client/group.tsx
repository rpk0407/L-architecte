// A booking of several people on the /r/ page (server/domain/group.js). The organiser reads one recap: each person, each
// service, each price and the total, with « Gérer » on every place and « Envoyer à mes amis » (the phone's own share sheet
// when it has one, else WhatsApp and a copy). A friend, on the link of his own place, reads who organised it; nothing
// about the others is sent to his page.
import { useState } from 'react';
import { cap, dates, eur, time } from '../lib/format';
import { copyText } from '../lib/clipboard';
import type { Group } from './booking';

const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/** « Envoyer à mes amis »: the share sheet, or WhatsApp and « Copier le message » where the browser has none. */
export function ShareFriends({ share }: { share: { title: string; text: string } }) {
  const [note, setNote] = useState('');
  const native = canShare();
  const send = async () => {
    try { await navigator.share({ title: share.title, text: share.text }); }
    catch (e: any) { if (e && e.name !== 'AbortError') setNote('Le partage n’a pas pu s’ouvrir. Copie le message ci-dessous.'); }
  };
  const copy = () => copyText(share.text).then(() => setNote('Message copié. Colle-le dans ta conversation.'), () => setNote('Copie impossible ici : sélectionne le texte à la main.'));
  return (
    <div className="c-share" data-guide="r.partager">
      {native ? <button type="button" className="c-btn" onClick={send}>Envoyer à mes amis</button>
        : <a className="c-btn" href={'https://wa.me/?text=' + encodeURIComponent(share.text)} target="_blank" rel="noopener" aria-label="Envoyer à mes amis par WhatsApp">Envoyer à mes amis</a>}
      <button type="button" className="c-link" onClick={copy}>Copier le message</button>
      {note ? <p className="c-muted c-small" role="status">{note}</p> : null}
      <p className="c-muted c-small">{native ? '' : 'Le message s’ouvre dans WhatsApp. '}{/Ta place \(/.test(share.text) ? 'Chaque ami reçoit le lien de sa propre place : il peut la voir, la déplacer ou l’annuler, rien d’autre. Toi, tu gardes la main sur toutes.' : 'Il donne le jour, l’heure et l’adresse. Toi, tu gardes la main sur chaque place.'}</p>
    </div>
  );
}

export function GroupCard({ g }: { g: Group }) {
  if (!g.organiser) {
    return <p className="c-muted c-small c-group-by" data-guide="r.groupe">{g.by ? 'Réservé par ' + g.by : 'Réservé avec d’autres personnes'} · groupe de {g.size}. Ce lien ouvre ta place, et seulement la tienne.</p>;
  }
  const sameDay = g.people.every((p) => p.day === g.people[0].day);
  return (
    <section className="c-card c-group" aria-labelledby="c-group-t" data-guide="r.groupe">
      <p className="c-k">Tu es l’organisateur</p>
      <h2 className="c-h2" id="c-group-t">Ton groupe · {g.size} personnes</h2>
      {sameDay ? <p className="c-muted">{cap(dates.dayLong(g.people[0].day))}</p> : null}
      <ul className="c-group-l">
        {g.people.map((p) => (
          <li key={p.token}>
            <span><b>{p.first}{p.organiser ? ' (toi)' : ''}</b><small>{p.services.join(' + ')} · {sameDay ? '' : dates.dayShort(p.day) + ' à '}{time(p.start)}{p.staff ? ' avec ' + p.staff : ''}</small></span>
            <span className="c-group-p">{(p.from ? 'dès ' : '') + eur(p.price)}{p.self ? null : <a className="c-link" href={'/r/' + p.token} aria-label={'Gérer la place de ' + p.first}>Gérer</a>}</span>
          </li>
        ))}
      </ul>
      <p className="c-group-t"><span>Total, à régler au salon</span><b>{eur(g.total)}</b></p>
      <ShareFriends share={g.share} />
    </section>
  );
}
