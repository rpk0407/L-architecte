// @ts-check
// What passes for an e-mail address, read the same way by the server and by the import wizard's preview.
// Strict on purpose: an address that came in from the old site ends up in a `mailto:` link and in a message header, so
// nothing that could add a parameter (? & = %), a quote, a bracket or a second address (; ,) is accepted, nor `..`.

/** @param {any} e */
export function isEmail(e) {
  const s = String(e || '');
  if (s.length > 254 || s.includes('..')) return false;
  return /^[^@\s?&=%"'<>;,()[\]\\]{1,64}@([a-z0-9-]+\.)+[a-z0-9-]{2,}$/i.test(s);
}
