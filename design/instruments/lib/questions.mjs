// Is a question answered by what a person can see? Shared by the street test (the first viewport) and the counters (a whole page).
/** @param {import('../../personas/schema.mjs').Question} q @param {{ text: string, links: { href: string, label: string }[] }} seen */
export function answered(q, seen) {
  const links = seen.links;
  switch (q.kind) {
    case 'text': return q.re.test(seen.text);
    case 'tel': return links.some((l) => /^tel:/i.test(l.href));
    case 'link': return links.some((l) => q.re.test(l.label) || q.re.test(l.href));
    case 'contact': return links.some((l) => /^(tel|mailto):/i.test(l.href));
    default: return false;
  }
}
