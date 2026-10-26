import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../../server/core/state.js';
import { renderTemplate, whenWords } from '../../server/domain/messages.js';

// GSM 03.38: what fits in one 160-character SMS
const GSM = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà');
const EXT = new Set('^{}\\[~]|€');
const length = (t) => [...t].reduce((n, c) => n + (EXT.has(c) ? 2 : 1), 0);

test('default texts stay in one plain SMS with realistic values', () => {
  const vars = {
    prenom: 'Maximilien', ...whenWords('2026-11-12', 870), barbier: 'Le Soldat', prestation: 'Coupe', prix: '30 €', salon: 'Barber L’Architecte',
    lien: 'https://l-architecte.vercel.app/r/LA-7K2P.Ab3dEf9hIj2kLm4nOp6q', avis: 'https://search.google.com/local/writereview?placeid=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
    jours: '134', ticket: 'T001042', montant: '1 230,00 €'
  };
  for (const [k, tpl] of Object.entries(TEMPLATES)) {
    const sms = renderTemplate(tpl, vars);
    const odd = [...sms].filter((c) => !GSM.has(c) && !EXT.has(c));
    assert.deepEqual(odd, [], k + ' uses characters outside the SMS alphabet');
    assert.ok(length(sms) <= 160, k + ' is ' + length(sms) + ' characters');
  }
});

test('typographic quotes and dashes from the owner are made SMS-friendly', () => {
  assert.equal(renderTemplate('L’Architecte — « {prenom} »', { prenom: 'Karim' }), 'L\'Architecte - "Karim"');
  assert.equal(renderTemplate('à {heure}', whenWords('2026-11-12', 870)), 'à 14 h 30');
});
