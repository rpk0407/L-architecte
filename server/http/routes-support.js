// @ts-check
// « Accès prestataire » (commands/support.js):
// - GET  /api/v1/support        the accesses still open, for the owner
// - POST /api/v1/support        { demande, password }: accept a request, 24 hours, with the owner's password
// - DELETE /api/v1/support/:id  remove one (the prestataire: his own)
// - GET  /api/v1/support/me     what a prestataire's key opens (for his own check)
import { HttpError, guard, failureGuard } from './kit.js';
import { verifySecret, verifyDummy } from '../auth/password.js';
import { grantSupport, revokeSupport, openSupport, supportCode, SUPPORT_HOURS } from '../commands/support.js';

const ownerOnly = (r) => { if (r.me.role !== 'owner') throw new HttpError(403, 'forbidden', 'Réservé au gérant.'); };

export function supportRoutes(app) {
  app.get('/api/v1/support', (r) => {
    ownerOnly(r);
    return { hours: SUPPORT_HOURS, items: openSupport(r.s, r.now).map((g) => ({ id: g.id, at: g.at, exp: g.exp, label: g.label, code: supportCode(g.hash), current: !!r.support && r.support.id === g.id })) };
  }, { cap: 'settings' });
  app.get('/api/v1/support/me', (r) => {
    if (!r.support) throw new HttpError(404, 'not_found', 'Pas d’accès prestataire.');
    return { id: r.support.id, exp: r.support.exp, for: r.me.name, caps: [...r.caps] };
  });
  app.post('/api/v1/support', async (r) => {
    ownerOnly(r);
    if (r.support) throw new HttpError(403, 'forbidden', 'Un accès prestataire ne peut pas en ouvrir un autre.');
    guard('support|' + r.me.id, 10, 15 * 60000);
    const acct = failureGuard('support-pwd|' + r.me.id, 5, 15 * 60000, 'Trop d’essais. Réessaie dans un quart d’heure.');
    const creds = r.s.creds.get(r.me.id);
    const ok = creds && creds.pwd ? await verifySecret(String(r.body.password || ''), creds.pwd) : await verifyDummy(String(r.body.password || ''));
    if (!ok) { acct.fail(); throw new HttpError(401, 'bad_login', 'Mot de passe incorrect.'); }
    acct.done();
    return r.run(grantSupport, { hash: r.body.demande });
  }, { cap: 'settings' });
  app.del('/api/v1/support/:id', (r) => { ownerOnly(r); return r.run(revokeSupport, { id: r.params.id }); }, { cap: 'settings' });
}
