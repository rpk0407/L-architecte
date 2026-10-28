// @ts-check
// CSV for Excel and the accountant's tools (CPT-03): ';' by default, a BOM so Excel reads UTF-8, CRLF lines. A cell
// typed by someone (a client's name, a reason) that starts like a formula would run as one in Excel (CSV injection):
// it gets a leading quote, which Excel shows as text. Amounts written with a decimal comma ('-12,50') stay numbers.

const FORMULA = /^[=+\-@\t\r]/;
const NUMBER = /^-?\d+(,\d+)?$/;

/** One cell: a formula-like text neutralised, then quoted when it holds the separator, a quote or a line break. */
function cell(v, sep) {
  let t = v == null ? '' : String(v);
  if (typeof v === 'string' && FORMULA.test(t) && !NUMBER.test(t)) t = "'" + t;
  return t.includes(sep) || /["\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

/**
 * @param {any[][]} rows
 * @param {{ sep?: string, bom?: boolean }} [opt]
 */
export function csv(rows, { sep = ';', bom = true } = {}) {
  return (bom ? '﻿' : '') + rows.map((r) => r.map((v) => cell(v, sep)).join(sep)).join('\r\n') + '\r\n';
}
