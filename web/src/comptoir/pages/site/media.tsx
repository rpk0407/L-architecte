// Photos for the site: resized in the browser (1600 px at most, so a phone photo of 6 MB leaves as ~400 KB), sent raw to
// POST /api/v1/uploads, or picked from the old WordPress site's media library (copied by the server). Used by Le site
// and by each barber's profile in Équipe.
import { useRef, useState } from 'react';
import { api, ApiError, uuid } from '../../../lib/api';
import { Icon } from '../../../ui/Icon';
import { Button, Field, Note, Sheet, toastError } from '../../../ui/kit';
import '../site.css';

export type Picked = { url: string; alt?: string; caption?: string };
type WpItem = { wp: number; url: string; alt: string; caption: string; title: string; width: number | null; height: number | null };
type WpAnswer = { items: WpItem[]; total: number; failed: number; left: number };

const MAX_SIDE = 1600;
const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** A photo the server takes: at most 1600 px on its longest side, JPEG unless it already fits as it is. */
export async function shrink(file: Blob): Promise<Blob> {
  // createImageBitmap applies the EXIF orientation: a portrait shot stays upright
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('Ce navigateur ne lit pas ce format de photo : choisis une photo JPEG ou PNG.'); });
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size <= MAX_BYTES && TYPES.includes(file.type)) { bmp.close(); return file; }
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d');
  if (!g) throw new Error('Ce navigateur ne sait pas réduire la photo.');
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  for (const q of [0.86, 0.75, 0.6]) {
    const out = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', q));
    if (out && out.size <= MAX_BYTES) return out;
  }
  throw new Error('Photo trop lourde, même réduite.');
}

/** Send a photo as it is (already resized): the server answers with its address on the site. */
export async function uploadPhoto(blob: Blob): Promise<{ url: string }> {
  let res: Response;
  try { res = await fetch('/api/v1/uploads', { method: 'POST', headers: { 'content-type': blob.type, 'x-request-id': uuid(), accept: 'application/json' }, body: blob, credentials: 'same-origin' }); }
  catch { throw new ApiError(0, 'network', 'Pas de connexion. Vérifie le Wi-Fi, on réessaie.'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || 'http', data?.error?.message || 'Erreur ' + res.status);
  return data;
}

// the old site's photos, copied once per visit of the Comptoir: the sheet reopens on them
let wpCache: { base: string; items: WpItem[]; left: number; failed: number } | null = null;

/** Copy the old site's media library; asks again while the server says some are left (it stops at 20 s a call). */
export async function fetchWordpress(base: string, onProgress?: (n: number) => void) {
  const prev = wpCache && wpCache.base === base ? wpCache.items : [];
  const items = [...prev];
  let left = 0, failed = 0;
  for (let round = 0; round < 6; round++) {
    const r = await api.post<WpAnswer>('/api/v1/uploads/wordpress', { base, skip: items.map((x) => x.wp) });
    items.push(...r.items.filter((x) => !items.some((y) => y.wp === x.wp)));
    left = r.left; failed = r.failed;
    onProgress?.(items.length);
    if (!left || !r.items.length) break;
  }
  wpCache = { base, items, left, failed };
  return wpCache;
}

/** Pick a photo: from this device (resized and uploaded) or from the old site. */
export function PhotoPicker({ open, onClose, onPick, title = 'Choisir une photo' }: { open: boolean; onClose: () => void; onPick: (p: Picked) => void; title?: string }) {
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const take = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try { const r = await uploadPhoto(await shrink(f)); onPick({ url: r.url, alt: '' }); onClose(); }
    catch (e) { toastError(e); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  return (
    <Sheet open={open} onClose={onClose} title={title} wide>
      <div className="si-pick-device">
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => take(e.target.files?.[0])} />
        <Button variant="primary" icon="plus" busy={busy} onClick={() => file.current?.click()}>Depuis cet appareil</Button>
        <span className="faint">JPEG, PNG ou WebP. Réduite à 1600 px avant l’envoi.</span>
      </div>
      <WordpressPhotos onPick={(p) => { onPick(p); onClose(); }} />
    </Sheet>
  );
}

/** The old site's photos: the address, one tap to copy them all, then a grid to pick from. */
export function WordpressPhotos({ onPick, pickLabel = 'Choisir' }: { onPick?: (p: Picked) => void; pickLabel?: string }) {
  const [base, setBase] = useState(wpCache?.base || 'https://barberlarchitecte.com');
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  const [got, setGot] = useState(wpCache);
  const go = async () => {
    setBusy(true); setN(0);
    try { setGot(await fetchWordpress(base.trim(), setN)); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <section className="si-wp">
      <p className="section-k">De l’ancien site</p>
      <div className="si-wp-row">
        <Field label="Adresse de l’ancien site WordPress" htmlFor="si-wp-b" hint="Avant de basculer le domaine sur le Comptoir, ou à son adresse de secours (ancien.barberlarchitecte.com) ensuite.">
          <input id="si-wp-b" className="input" inputMode="url" value={base} onChange={(e) => setBase(e.target.value)} />
        </Field>
        <Button variant="subtle" icon="download" busy={busy} disabled={base.trim().length < 5} onClick={go}>{got ? 'Récupérer à nouveau' : 'Récupérer les photos de l’ancien site'}</Button>
      </div>
      {busy ? <p className="faint" role="status">Copie en cours… {n ? n + ' photo' + (n > 1 ? 's' : '') : ''}</p> : null}
      {got ? (
        got.items.length ? (
          <>
            <p className="faint" role="status">{got.items.length} photo{got.items.length > 1 ? 's' : ''} copiée{got.items.length > 1 ? 's' : ''} dans le Comptoir{got.failed ? ' · ' + got.failed + ' ignorée' + (got.failed > 1 ? 's' : '') + ' (trop lourde, autre format ou hébergée ailleurs)' : ''}{got.left ? ' · ' + got.left + ' restante' + (got.left > 1 ? 's' : '') + ' : relance' : ''}.</p>
            <ul className="si-wp-grid">
              {got.items.map((x) => (
                <li key={x.wp}>
                  {onPick ? (
                    <button type="button" className="si-thumb" onClick={() => onPick({ url: x.url, alt: x.alt, caption: x.caption })} aria-label={pickLabel + ' : ' + (x.alt || x.title || 'photo ' + x.wp)}>
                      <img src={x.url} alt="" loading="lazy" /><span>{pickLabel}</span>
                    </button>
                  ) : <span className="si-thumb"><img src={x.url} alt={x.alt} loading="lazy" /></span>}
                </li>
              ))}
            </ul>
          </>
        ) : <Note icon="info">Aucune photo trouvée à cette adresse.</Note>
      ) : null}
    </section>
  );
}

/** A photo slot: the picture, change, remove. */
export function PhotoSlot({ url, alt, onPick, onRemove, label, tall }: { url: string | null; alt?: string; onPick: (p: Picked) => void; onRemove?: () => void; label: string; tall?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={'si-slot' + (tall ? ' tall' : '')}>
      <button type="button" className="si-slot-ph" onClick={() => setOpen(true)} aria-label={(url ? 'Changer : ' : 'Ajouter : ') + label}>
        {url ? <img src={url} alt={alt || ''} /> : <span className="si-slot-empty"><Icon name="plus" size={20} />Ajouter</span>}
      </button>
      <div className="row" style={{ gap: 6 }}>
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{url ? 'Changer' : 'Choisir'}</Button>
        {url && onRemove ? <Button size="sm" variant="ghost" icon="trash" aria-label={'Retirer : ' + label} onClick={onRemove} /> : null}
      </div>
      <PhotoPicker open={open} onClose={() => setOpen(false)} onPick={onPick} title={label} />
    </div>
  );
}
