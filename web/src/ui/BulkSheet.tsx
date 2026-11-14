// WP6 · The grouped action: « aperçu, puis envoyer ». One sheet for any action on several people: who (everyone ticked by
// the rule, the excluded explained in one line), what (the real text each one gets), one button stuck at the bottom,
// and a send held back 5 seconds with « Annuler » (nothing is posted before that). The preview is the confirmation:
// there is no second dialog.
import { useState, type ReactNode } from 'react';
import { plural } from '../lib/format';
import { Button, Sheet, toast } from './kit';

export type BulkPerson = { id: string; name: string; sub?: string; checked: boolean };
export type BulkMessage = { id: string; name: string; text: string };

/** How long the send waits, in ms, for « Annuler ». */
export const HOLD_MS = 5000;

/**
 * Hold a send back: a toast « Envoi dans 5 s · Annuler »; `run` is called once the delay has passed, never if the
 * person cancelled. Returns a function that cancels as well (for a caller that leaves the page).
 */
export function holdSend(o: { title: ReactNode; sub?: ReactNode; run: () => void | Promise<void>; onCancel?: () => void; ms?: number }): () => void {
  let live = true;
  const ms = o.ms ?? HOLD_MS;
  const stop = () => { if (!live) return; live = false; clearTimeout(timer); o.onCancel?.(); };
  const timer = setTimeout(() => { if (!live) return; live = false; void o.run(); }, ms);
  toast({ title: o.title, sub: o.sub, icon: 'sms', ttl: ms, action: { label: 'Annuler', run: stop } });
  return stop;
}

export function BulkSheet({ open, onClose, title, kicker, people, onToggle, messages, excluded, facts, edit, editLabel = 'Modifier le texte', action, disabled, onSend }: {
  open: boolean; onClose: () => void; title: ReactNode; kicker?: ReactNode;
  /** Everyone the rule proposes, ticked or not (the ticked ones are the ones that will get the message). */
  people: BulkPerson[]; onToggle: (id: string, on: boolean) => void;
  /** The exact message each ticked person gets, in the same order: the first three are shown, the rest counted. */
  messages: BulkMessage[];
  /** One line each: « 10 exclus : pas d’accord pour les bons plans ». */
  excluded: string[];
  /** What else is true about this send (SMS count, time of departure), shown as it is. */
  facts?: ReactNode[];
  /** The field that changes the text, folded behind a link. */
  edit?: ReactNode; editLabel?: string;
  /** The button's words: « Envoyer à 17 clients ». */
  action: string; disabled?: boolean; onSend: () => void;
}) {
  const [who, setWho] = useState(false);
  const [text, setText] = useState(false);
  const on = people.filter((p) => p.checked);
  const names = on.slice(0, 3).map((p) => p.name.split(' ')[0]).join(', ');
  const shown = messages.slice(0, 3);
  return (
    <Sheet open={open} onClose={onClose} title={title} kicker={kicker}
      footer={<Button variant="primary" size="lg" block icon="sms" disabled={disabled || !on.length} onClick={onSend}>{action}</Button>}>
      <section className="bk-sec" aria-label="Qui">
        <div className="bk-h"><b>{plural(on.length, 'client')}</b><button type="button" className="link" aria-expanded={who} onClick={() => setWho(!who)}>{who ? 'Refermer' : 'Choisir'}</button></div>
        <p className="faint bk-s">{on.length ? names + (on.length > 3 ? ' et ' + (on.length - 3) + (on.length - 3 > 1 ? ' autres' : ' autre') : '') : 'Personne n’est coché.'}</p>
        {who ? (
          <ul className="bk-who">
            {people.map((p) => (
              <li key={p.id}>
                <label><input type="checkbox" checked={p.checked} onChange={(e) => onToggle(p.id, e.target.checked)} /><span><b>{p.name}</b>{p.sub ? <small>{p.sub}</small> : null}</span></label>
              </li>
            ))}
          </ul>
        ) : null}
        {excluded.map((l) => <p key={l} className="bk-ex">{l}</p>)}
      </section>
      <section className="bk-sec" aria-label="Quoi">
        <div className="bk-h"><b>Le message</b>{edit ? <button type="button" className="link" aria-expanded={text} onClick={() => setText(!text)}>{text ? 'Refermer' : editLabel}</button> : null}</div>
        {text ? edit : null}
        {shown.length ? shown.map((m) => <div key={m.id} className="bubble bk-msg" data-msg={m.id}><small>Pour {m.name}</small><p>{m.text}</p></div>) : <p className="faint bk-s">Rien à envoyer.</p>}
        {messages.length > shown.length ? <p className="faint bk-s">et {messages.length - shown.length} {messages.length - shown.length > 1 ? 'autres messages' : 'autre message'}, avec le même texte.</p> : null}
        {(facts || []).map((f, i) => <p key={i} className="faint bk-s">{f}</p>)}
      </section>
    </Sheet>
  );
}
