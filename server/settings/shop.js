// @ts-check
// Le salon: who and where the shop is, shown on the site, the tickets and the messages.
import { str, opt, obj } from '../lib/validate.js';

const url = () => str({ max: 300, pattern: /^https:\/\/[^\s]+$/ });

export default /** @type {const} */ ({
  key: 'shop',
  defaults: () => ({
    name: 'Barber L’Architecte', address: '16, place Pélabon', zip: '13013', city: 'Marseille',
    phone: '', email: 'larchitectebarber@gmail.com', siret: '', vatNumber: '', legalName: '',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=L%27Architecte%20coiffeur&query_place_id=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
    reviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
    instagram: 'https://www.instagram.com/barbershoplarchitecte/'
  }),
  schema: obj({
    name: opt(str({ min: 2, max: 80 })), legalName: opt(str({ max: 120 })), address: opt(str({ max: 120 })), zip: opt(str({ max: 10 })), city: opt(str({ max: 60 })),
    phone: opt(str({ max: 20 })), email: opt(str({ max: 120 })), siret: opt(str({ max: 20, pattern: /^[\d ]*$/ })), vatNumber: opt(str({ max: 20 })),
    mapsUrl: opt(url()), reviewUrl: opt(url()), instagram: opt(url())
  })
});
