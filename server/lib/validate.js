// @ts-check
// A tiny schema validator. Every request body goes through one of these before it reaches the domain,
// so handlers only ever see well-formed, bounded values. Unknown keys are dropped.
import { isDay } from '../../shared/dates.js';

export class InvalidInput extends Error {
  constructor(path, msg) { super((path ? path + ' : ' : '') + msg); this.path = path; this.status = 400; this.code = 'invalid'; }
}

/** @template T @typedef {{ parse: (x: any, path: string) => T, optional?: boolean }} Schema */

/** @returns {Schema<string>} */
export const str = ({ min = 0, max = 200, pattern = /** @type {RegExp|null} */ (null), trim = true, lower = false } = {}) => ({
  parse(x, p) {
    if (typeof x !== 'string') throw new InvalidInput(p, 'texte attendu');
    let v = trim ? x.trim() : x;
    if (lower) v = v.toLowerCase();
    // strip control characters, keep newlines and tabs
    v = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    if (v.length < min) throw new InvalidInput(p, min === 1 ? 'obligatoire' : `au moins ${min} caractères`);
    if (v.length > max) throw new InvalidInput(p, `${max} caractères maximum`);
    if (pattern && !pattern.test(v)) throw new InvalidInput(p, 'format invalide');
    return v;
  }
});
/** @returns {Schema<number>} */
export const int = ({ min = -2147483648, max = 2147483647 } = {}) => ({
  parse(x, p) {
    const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
    if (typeof n !== 'number' || !Number.isInteger(n)) throw new InvalidInput(p, 'nombre entier attendu');
    if (n < min || n > max) throw new InvalidInput(p, `entre ${min} et ${max}`);
    return n;
  }
});
/** @returns {Schema<boolean>} */
export const bool = () => ({ parse(x, p) { if (typeof x !== 'boolean') throw new InvalidInput(p, 'vrai/faux attendu'); return x; } });
/** @template {string} T @param {readonly T[]} values @returns {Schema<T>} */
export const oneOf = (values) => ({ parse(x, p) { if (!values.includes(x)) throw new InvalidInput(p, 'valeur non permise'); return x; } });
/** @returns {Schema<string>} */
export const day = () => ({ parse(x, p) { if (!isDay(x)) throw new InvalidInput(p, 'date AAAA-MM-JJ attendue'); return x; } });
/** @returns {Schema<string>} */
export const id = () => str({ min: 1, max: 64, pattern: /^[A-Za-z0-9_:-]+$/ });
/** @template T @param {Schema<T>} item @returns {Schema<T[]>} */
export const arr = (item, { min = 0, max = 100 } = {}) => ({
  parse(x, p) {
    if (!Array.isArray(x)) throw new InvalidInput(p, 'liste attendue');
    if (x.length < min || x.length > max) throw new InvalidInput(p, `de ${min} à ${max} éléments`);
    return x.map((v, i) => item.parse(v, p + '[' + i + ']'));
  }
});
/** @template T @param {Schema<T>} s @returns {Schema<T|undefined>} */
export const opt = (s) => ({ optional: true, parse(x, p) { return x === undefined || x === null ? undefined : s.parse(x, p); } });
/** @template T @param {Schema<T>} s @returns {Schema<T|null>} */
export const nullable = (s) => ({ optional: true, parse(x, p) { return x === null ? null : x === undefined ? undefined : s.parse(x, p); } });
/** @template T @param {Schema<T>[]} list @returns {Schema<T>} */
export const either = (list) => ({
  parse(x, p) {
    let last;
    for (const s of list) { try { return s.parse(x, p); } catch (e) { last = e; } }
    throw last || new InvalidInput(p, 'valeur invalide');
  }
});
/**
 * @template {Record<string, Schema<any>>} S
 * @param {S} shape
 * @returns {Schema<{ [K in keyof S]: ReturnType<S[K]['parse']> }>}
 */
export const obj = (shape) => ({
  parse(x, p) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw new InvalidInput(p, 'objet attendu');
    /** @type {any} */
    const out = {};
    for (const k of Object.keys(shape)) {
      const v = shape[k].parse(x[k], p ? p + '.' + k : k);
      if (v === undefined && !shape[k].optional) throw new InvalidInput(p ? p + '.' + k : k, 'obligatoire');
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
});
/** Record with free keys (e.g. weekday → intervals). */
export const record = (keyPattern, val, { max = 20 } = {}) => ({
  parse(x, p) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw new InvalidInput(p, 'objet attendu');
    const keys = Object.keys(x);
    if (keys.length > max) throw new InvalidInput(p, 'trop de clés');
    /** @type {any} */
    const out = {};
    for (const k of keys) { if (!keyPattern.test(k)) throw new InvalidInput(p + '.' + k, 'clé invalide'); out[k] = val.parse(x[k], p + '.' + k); }
    return out;
  }
});

/** Opening intervals: [[540, 780], [810, 1110]] */
export const intervals = () => arr(arr(int({ min: 0, max: 1440 }), { min: 2, max: 2 }), { max: 4 });
export const week = () => record(/^[0-6]$/, intervals(), { max: 7 });
export const money = (max = 1000000) => int({ min: 0, max });

/** @template T @param {Schema<T>} schema @returns {T} */
export function parse(schema, input) { return schema.parse(input, ''); }
