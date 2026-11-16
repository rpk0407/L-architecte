// @ts-check
// Paiements: what the till accepts, tips, default VAT (basis points) and the ticket's last line.
// selfPay: the client may pay his cut himself on his own page once he is at the salon (commands/selfpay.js).
import { str, int, bool, opt, obj, arr, money } from '../lib/validate.js';

export default /** @type {const} */ ({
  key: 'payments',
  defaults: () => ({ card: true, cash: true, qr: true, giftcard: true, selfPay: false, tips: true, tipPresets: [200, 500, 1000], vat: 2000, receiptFooter: 'Merci et à bientôt !' }),
  schema: obj({
    card: opt(bool()), cash: opt(bool()), qr: opt(bool()), giftcard: opt(bool()), selfPay: opt(bool()), tips: opt(bool()),
    tipPresets: opt(arr(money(10000), { max: 4 })), vat: opt(int({ min: 0, max: 3000 })), receiptFooter: opt(str({ max: 160 }))
  })
});
