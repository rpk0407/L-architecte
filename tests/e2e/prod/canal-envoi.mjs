// MSG-02 · Réglages › Messages › Messages aux clients on a production salon whose texts leave from the salon's own phone:
// the way in use, the test text through a stubbed SMS Gateway (Basic auth, the owner's number), no key, token nor
// password on the page, the automatic WhatsApp mode chosen and saved with its four templates, and a client's answer to
// the phone landing in Relances › Demandes.
// Run by tests/e2e/prod.mjs on its own fresh salon.
import { createServer } from 'node:http';
import { webhookKey } from '../../../server/messaging/sms.js';

export const name = 'Messages aux clients: the salon phone tested through a stub, WhatsApp automatique chosen, an answer in Demandes';

// the salon's phone, as its cloud API answers: 202 and an id; every request kept for the checks
const calls = [];
const stub = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body: body ? JSON.parse(body) : null });
    res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'stub-' + calls.length, state: 'Pending' }));
  });
});
await new Promise((ok) => stub.listen(0, '127.0.0.1', ok));
const port = /** @type {any} */ (stub.address()).port;
const SECRETS = ['gate-pass-SECRET', 'xkeysib-SECRET', 'GATEUSER', 'EAAG-SECRET'];

export const env = {
  SMS_PROVIDER: 'gateway', SMSGATE_USERNAME: 'GATEUSER', SMSGATE_PASSWORD: 'gate-pass-SECRET', SMSGATE_URL: 'http://127.0.0.1:' + port + '/3rdparty/v1',
  BREVO_API_KEY: 'xkeysib-SECRET', WHATSAPP_SENDER: '+33491000000', WHATSAPP_TOKEN: 'EAAG-SECRET', WHATSAPP_PHONE_ID: '106540352242922', CRON_SECRET: 'cron-e2e-0123456789'
};
const PHONE = { width: 390, height: 844 };
const noSecret = async (page, where) => {
  const html = await page.content();
  for (const x of SECRETS) if (html.includes(x)) throw new Error(where + ' shows a secret: ' + x);
};

export default async ({ h, page }) => {
  try {
    await h.loginOwner(page);
    const api = await h.api('/api/v1/messages/channels');
    for (const x of SECRETS) if (api.text.includes(x)) throw new Error('the channels API gives a secret away: ' + x);

    await page.goto(h.base + '/comptoir/reglages/messages');
    const card = page.locator('section.card', { has: page.getByRole('heading', { name: 'Messages aux clients' }) });
    await card.waitFor({ timeout: 10000 });
    await card.locator('.card-h .badge', { hasText: 'SMS' }).waitFor({ timeout: 5000 });
    await card.locator('.cn-mode.on', { hasText: 'En service : Téléphone du salon (SMS).' }).waitFor({ timeout: 5000 });
    await noSecret(page, 'Réglages › Messages');
    await h.shot(page, 'canal-desktop');

    // the test through the salon's phone: the stub gets one text, to the owner's number, with the app's credentials
    await page.fill('#cn-phone', '06 12 34 56 78');
    const gw = card.locator('.cn-route', { hasText: 'Téléphone du salon' });
    await gw.getByRole('button', { name: 'Envoyer un test' }).click();
    await h.expectText(page, 'Test envoyé au 06 •• •• •• 78');
    if (calls.length !== 1) throw new Error('the stub got ' + calls.length + ' requests');
    const c = calls[0];
    if (c.method !== 'POST' || c.url !== '/3rdparty/v1/messages') throw new Error('wrong request ' + c.method + ' ' + c.url);
    if (c.auth !== 'Basic ' + Buffer.from('GATEUSER:gate-pass-SECRET').toString('base64')) throw new Error('wrong auth');
    if (JSON.stringify(c.body.phoneNumbers) !== '["+33612345678"]' || !/par le téléphone du salon/.test(c.body.textMessage.text)) throw new Error('wrong body ' + JSON.stringify(c.body));

    // WhatsApp automatique: plugged (the token and the number's id are in the environment), chosen, saved with the four
    // templates under their names; the texts to paste at Meta are on the page
    const auto = card.locator('.cn-mode', { hasText: 'WhatsApp automatique' });
    await auto.getByText('Branché, depuis le 04 91 00 00 00.').waitFor({ timeout: 3000 });
    await auto.getByText('Meta facture chaque message', { exact: false }).waitFor({ timeout: 3000 });
    await auto.getByRole('radio').check();
    await card.getByRole('button', { name: 'Enregistrer' }).click();
    await h.expectText(page, 'Messages aux clients : enregistré');
    await card.locator('.card-h .badge', { hasText: 'WhatsApp automatique' }).waitFor({ timeout: 5000 });
    const saved = (await h.api('/api/v1/settings')).json.settings.messages.whatsapp;
    if (saved.mode !== 'auto' || !saved.enabled || saved.templates.confirmation.name !== 'rdv_confirmation' || saved.templates.confirmation.params.join() !== 'prenom,date,heure,barbier,lien' || saved.templates.moved.name !== 'rdv_deplace') throw new Error('not saved: ' + JSON.stringify(saved));
    await card.getByRole('button', { name: /Rappel la veille/ }).click();
    await card.getByText('Rappel de L\'Architecte : on t\'attend demain à {{heure}} avec {{barbier}}.', { exact: false }).waitFor({ timeout: 3000 });
    await noSecret(page, 'Réglages › Messages, WhatsApp automatique');

    // the phone, on a phone
    const mobile = await h.newPage({ viewport: PHONE });
    await mobile.context().addCookies(await page.context().cookies());
    await mobile.goto(h.base + '/comptoir/reglages/messages');
    await mobile.getByRole('heading', { name: 'Messages aux clients' }).waitFor({ timeout: 10000 });
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error('the page scrolls sideways on a phone (' + overflow + ' px)');
    await noSecret(mobile, 'Réglages › Messages on a phone');
    await mobile.getByRole('heading', { name: 'Messages aux clients' }).scrollIntoViewIfNeeded();
    await h.shot(mobile, 'canal-phone');

    // a client answers the salon's phone: the app posts it to the webhook, the owner reads it in Demandes
    const hook = await h.api('/api/sms/webhook?k=' + webhookKey(env.CRON_SECRET), { session: false, body: { deviceId: 'd', event: 'sms:received', id: 'e2e-1', webhookId: 'w', payload: { messageId: 'm1', message: 'Je serai là à 10 h 15, désolé', sender: '+33622334455' } } });
    if (!hook.ok || !hook.json.replied) throw new Error('webhook: ' + hook.status + ' ' + hook.text);
    await page.goto(h.base + '/comptoir/relances/demandes');
    await h.expectText(page, 'Je serai là à 10 h 15, désolé');
    await h.expectText(page, 'Réponse SMS');
  } finally {
    await new Promise((ok) => stub.close(ok));
  }
};
