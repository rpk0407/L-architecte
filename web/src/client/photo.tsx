// « Ta coupe en photo » on the page of a visit that is done and in the client space: pick or take a photo, see it in the
// salon's frame (square or story), then « Partager » (the phone's share sheet, with the image) or « Enregistrer ».
// The photo stays in this browser: read with createImageBitmap, drawn on a canvas, never uploaded (web/src/lib/photoframe.ts).
import { useEffect, useRef, useState } from 'react';
import { FRAME_SIZE, LOGO_SRC, drawFrame, frameFileName, type FrameFormat } from '../lib/photoframe';

const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const loadLogo = () => new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = LOGO_SRC.dark; });
const blobOf = (c: HTMLCanvasElement) => new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.92));

export function PhotoFrame({ shop, city = 'Marseille' }: { shop: string; city?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [photo, setPhoto] = useState<ImageBitmap | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [format, setFormat] = useState<FrameFormat>('square');
  const [note, setNote] = useState('');
  const name = shop && !/^barber /i.test(shop) ? shop : 'L’Architecte';
  useEffect(() => { loadLogo().then(setLogo); }, []);
  useEffect(() => {
    if (!photo || !canvas.current) return;
    drawFrame(canvas.current, { format, photo, logo, name, city });
  }, [photo, logo, format]);
  const pick = async (f: File | undefined) => {
    setNote('');
    if (!f) return;
    if (!/^image\//.test(f.type)) { setNote('Choisis une photo (JPEG, PNG ou HEIC).'); return; }
    try { setPhoto(await createImageBitmap(f)); }
    catch { setNote('Cette photo ne peut pas être lue ici. Essaie avec une autre, ou prends-la directement.'); }
  };
  const fileOf = async () => {
    const b = canvas.current ? await blobOf(canvas.current) : null;
    return b ? new File([b], frameFileName(today(), format), { type: 'image/jpeg' }) : null;
  };
  const save = async () => {
    const f = await fileOf();
    if (!f) return;
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setNote('Image enregistrée dans tes téléchargements.');
  };
  const share = async () => {
    const f = await fileOf();
    if (!f) return;
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (typeof nav.share === 'function' && nav.canShare && nav.canShare({ files: [f] })) {
      try { await nav.share({ files: [f], title: 'Ma coupe chez ' + name }); } catch (e: any) { if (e && e.name !== 'AbortError') save(); }
    } else save();
  };
  const size = FRAME_SIZE[format];
  return (
    <section className="c-card c-photo" aria-labelledby="c-photo-t" data-guide="r.photo">
      <p className="c-k">Ta coupe en photo</p>
      <h2 className="c-h2" id="c-photo-t">Montre ta coupe</h2>
      <p className="c-muted">Prends ou choisis une photo : elle se met dans le cadre du salon, prête à partager. Elle reste sur ton téléphone, rien n’est envoyé au salon.</p>
      <label className="c-btn ghost c-photo-pick">
        {photo ? 'Changer de photo' : 'Prendre ou choisir une photo'}
        <input type="file" accept="image/*" className="c-vh" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {photo ? (
        <>
          <div className="c-photo-fmt" role="radiogroup" aria-label="Format">
            {(['square', 'story'] as FrameFormat[]).map((k) => <button key={k} type="button" role="radio" aria-checked={format === k} className={'c-chip' + (format === k ? ' on' : '')} onClick={() => setFormat(k)}>{k === 'square' ? 'Carré' : 'Story'}</button>)}
          </div>
          <canvas ref={canvas} className={'c-photo-cv ' + format} width={size.w} height={size.h} role="img" aria-label={'Ta photo dans le cadre ' + name + ', format ' + (format === 'square' ? 'carré' : 'story')} />
          <div className="c-row c-photo-acts">
            <button type="button" className="c-btn" onClick={share}>Partager</button>
            <button type="button" className="c-link" onClick={save}>Enregistrer</button>
          </div>
        </>
      ) : null}
      {note ? <p className="c-muted c-small" role="status">{note}</p> : null}
    </section>
  );
}
