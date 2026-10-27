// Copy text: the clipboard where the browser allows it (https, a recent browser), a selected textarea otherwise.
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* below */ }
  const t = document.createElement('textarea');
  t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.select();
  const ok = document.execCommand('copy');
  t.remove();
  if (!ok) throw new Error('Copie impossible sur ce navigateur : sélectionne le texte et copie-le.');
}
