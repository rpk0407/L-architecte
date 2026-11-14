// @ts-check
// The weekly carnet bought with its dates (« 5 coupes sur 5 semaines d'affilée »): which appointments belong to one
// purchase, who pays how, and the carnet (s.packs) it becomes once the 80 € are on a ticket.
//   formule.booked    { id, clientId, serviceId, coverId, apptIds, credits, days, missed, pay, source, guest?, renewOf? }
//   formule.apptAdded { id, apptId }            a week booked later (« réserver cette semaine »)
//   formule.started   { id, packId, startDay, expires, saleId }   the carnet is paid: its validity runs from startDay
//   formule.released  { id, reason }            the first cut was missed and nothing was paid: the other dates are freed
// s.formules: id → row; s.formuleByAppt: appointment id → formule id. No personal data here (ids only).
// Registered in core/extensions.js; commands in commands/formule.js; reads in domain/formule.js.
// No import of the engine or the state here (see core/extensions.js).

/** @type {import('../core/extensions.js').Extension} */
export const formulesExtension = {
  init(s) { s.formules = new Map(); s.formuleByAppt = new Map(); },
  on: {
    'formule.booked': (s, e, d) => {
      s.formules.set(d.id, {
        id: d.id, clientId: d.clientId, serviceId: d.serviceId, coverId: d.coverId, apptIds: [...(d.apptIds || [])], credits: d.credits, days: d.days,
        missed: d.missed === 'once' ? 'once' : 'lost', pay: d.pay === 'online' ? 'online' : 'salon', source: d.source || 'site', guest: d.guest || null,
        renewOf: d.renewOf || null, createdAt: e.at, packId: d.packId || null, startDay: d.startDay || null, expires: d.expires || null, status: 'open', released: null
      });
      for (const id of d.apptIds || []) s.formuleByAppt.set(id, d.id);
      // a carnet already paid at the desk, its dates fixed after: its validity now runs from the first date
      const pk = d.packId ? s.packs.get(d.packId) : null;
      if (pk && d.expires) pk.expires = d.expires;
    },
    'formule.apptAdded': (s, e, d) => {
      const f = s.formules.get(d.id);
      if (!f || f.apptIds.includes(d.apptId)) return;
      f.apptIds.push(d.apptId);
      s.formuleByAppt.set(d.apptId, f.id);
    },
    'formule.started': (s, e, d) => {
      const f = s.formules.get(d.id);
      if (!f) return;
      Object.assign(f, { packId: d.packId, startDay: d.startDay, expires: d.expires, saleId: d.saleId || null });
    },
    'formule.released': (s, e, d) => {
      const f = s.formules.get(d.id);
      if (f) Object.assign(f, { status: 'released', released: { at: e.at, reason: d.reason || '' } });
    }
  }
};
