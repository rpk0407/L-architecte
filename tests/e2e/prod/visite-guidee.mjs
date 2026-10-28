// GUIDE-01a · The owner's guided tour on the salon he gets on the first deploy: no team, no client, no plan. He walks
// it to the end with « Suivant » only. A part the empty salon does not show is passed over, not explained in a centered
// card over a dimmed page; each page's count holds and the visit's bar only moves forward (walkTour). The Agenda shows
// what opens it (« Ajoute ton équipe »). Run by tests/e2e/prod.mjs on its own fresh salon.
import { walkTour } from '../demo/visite-guidee.mjs';

export const name = 'guided tour on an empty salon: nothing explained over nothing, the counts hold';

export default async ({ h, page }) => {
  await h.loginOwner(page);
  await page.getByRole('heading', { name: /^Bienvenue dans ton Comptoir/ }).waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Commencer la visite' }).click();
  const { seen, unlit } = await walkTour(page, (id) => (['agenda.noteam', 'caisse.free', 'clients.search'].includes(id) ? h.shot(page, 'tour-empty-' + id) : null));
  if (seen.length < 20) throw new Error('the empty salon’s tour is short: ' + seen.length + ' steps');
  if (!seen.includes('agenda.noteam')) throw new Error('the Agenda is not shown on an empty salon: ' + seen.join(' '));
  // nothing that needs a client, a member or a plan
  const none = seen.filter((id) => /^(clients\.(abonnes|members|file|rows)|caisse\.(member|chips|reward|offer|methods)|reglages\.abo-(preview|rhythm|missed|offer))/.test(id));
  if (none.length) throw new Error('the empty salon’s tour explains what is not there: ' + none.join(', '));
  if (unlit.length > 3) throw new Error(unlit.length + ' of ' + seen.length + ' steps point at a part but light nothing: ' + unlit.join(', '));
};
