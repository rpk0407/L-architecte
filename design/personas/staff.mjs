// The three people who run the shop from the Comptoir. Fictional composites, not the demo salon’s staff.
// Staff weights are the share of the staff’s day each role carries, and add up to 1 among themselves.

/** @typedef {import('./schema.mjs').Persona} Persona */

/** @type {Persona[]} */
export const STAFF_PERSONAS = [
  {
    id: 'barbier', kind: 'staff', archetype: 'Le Barbier au fauteuil', name: 'Anis', age: 26, role: 'Barber, six years in the trade',
    headline: '« J’ai les mains pleines. Donne-moi le client suivant, rien d’autre. »',
    life: 'Twenty-five to forty-five minutes under a client’s eyes, hands wet, gloved or full of product. Between two clients he has sixty to ninety seconds: glance at who is next and what he had last time, tap « Il est là », tap « Au fauteuil ». He shares a tablet with three colleagues and never wants a client to read another client’s notes, or the till’s money. Software that makes him look slow in front of a client is software he stops using.',
    jobs: [
      'See the next client and the last cut’s note at a glance',
      'Change a status with one big tap',
      'Write a cut note in ten seconds',
      'See his own numbers, privately',
      'Sign in on a shared device in a few seconds'
    ],
    fears: [
      'The screen locking mid-cut',
      'A client reading money or other clients’ notes',
      'Targets too small for a wet thumb',
      'A network drop eating a note'
    ],
    delights: [
      '« Il est là » and « Au fauteuil » as the two biggest things on screen',
      '« La dernière fois » written by a colleague',
      'Amounts hidden until he asks',
      'A big, calm PIN keypad'
    ],
    says: ['mon prochain', 'il est là', 'au fauteuil', 'la note'],
    avoids: ['paramètres', 'rapport'],
    rhythm: 'A client every thirty to forty-five minutes, nine to eighteen thirty, five days',
    priority: 'core', weight: 0.5,
    why: 'Four chairs, four barbers: the people whose hands touch the product the most, and the ones who decide whether it lives or dies on the floor.',
    budget: { seconds: 10, taps: 2, chars: 0 },
    moments: ['S02', 'M10'],
    scenes: [
      { id: 'barbier.fauteuil', label: 'Between two clients, wet hands, a shared phone propped at the station', clock: 'mar-15h10', device: 'phone', network: 'wifi', scheme: 'dark',
        intent: 'Sign in with a PIN, see the next client, mark him arrived', trials: ['mains'], flow: 'barber' }
    ],
    success: 'Signed in in six taps, the next client and last time’s note on the first screen, status in one tap.',
    failure: 'He hunts for the next client, mis-taps, or a client reads the screen.',
    tells: 'Journal: status changes per appointment and their latency; cut notes written per barber; the lock events.',
    protect: [
      'The PIN keypad’s large keys',
      'The two big status buttons',
      'Amounts hidden by default on a shared device',
      '« La dernière fois » on the next-client card'
    ],
    evidence: [
      { claim: 'A barber has about a minute between clients, and wet or gloved hands.', cls: 'D', validate: 'Shadow two barbers through a Saturday morning: time the gaps, photograph the hands.' },
      { claim: 'The barber’s first screen shows the next client, the last visit’s note and two large status buttons, with amounts hidden on a shared device.', cls: 'O', source: 'web/src/comptoir/pages/Espace.tsx; trial mains', validate: 'npm run ux -- --only=mains' }
    ]
  },
  {
    id: 'accueil', kind: 'staff', archetype: 'L’Accueil', name: 'Lina', age: 23, role: 'Front desk: the phone, the door and the till at once',
    headline: '« Quatre choses en même temps, et il faut que ça tienne. »',
    life: 'She is the shop’s router: a phone ringing, a walk-in at the door, a client at the till, a barber asking if his 15:30 has arrived. Every screen she uses is glanced at, not read. She forgives a lot, but not a wrong tap on money or a dialog that swallows what she was doing.',
    jobs: [
      'Add a walk-in in two taps',
      'Move an appointment (the client is texted automatically)',
      'Check a client out in under thirty seconds',
      'See at a glance who is here, late, free'
    ],
    fears: [
      'A mis-tap on an amount or a refund',
      'A double booking',
      'Dialogs stacked on dialogs',
      'Losing her place after an interruption'
    ],
    delights: [
      '« P » for Passage; ⌘K to search anything',
      '« À encaisser » with the chair status',
      'A toast with an undo',
      'A till that deducts the deposit by itself'
    ],
    says: ['je le mets en caisse', 'il est arrivé', 'il est en retard', 'décale-le'],
    avoids: ['paramétrer'],
    rhythm: 'Eight hours of interruptions; the Saturday rush is the real test',
    priority: 'core', weight: 0.3,
    why: 'The one person who touches every screen in a day, under pressure, with a client watching.',
    budget: { seconds: 30, taps: 6, chars: 0 },
    moments: ['S01', 'S02', 'M11', 'M12'],
    scenes: [
      { id: 'accueil.coupdefeu', label: 'Saturday 09:40 at the desk: the opening rush, a tablet in landscape, a client at the till', clock: 'sam-09h40', device: 'tablet', network: 'wifi', scheme: 'dark',
        intent: 'Check out a finished client and move around the agenda without a mis-tap', trials: ['mains'], flow: 'desk' }
    ],
    success: 'Checkout in under thirty seconds, every control hittable at a glance.',
    failure: 'A secondary action the size of a text link causes a mis-tap on money.',
    tells: 'Journal: the time from « terminé » to « encaissé » per ticket; refunds and credit notes; undo toasts used.',
    protect: ['The « à encaisser » list', 'Deposits and memberships deducted automatically', 'Undo on every reversible action'],
    evidence: [
      { claim: 'The front desk is interrupted every minute or so and glances at screens rather than reading them.', cls: 'D', validate: 'Shadow the desk for a Saturday morning; count interruptions per hour.' },
      { claim: 'The till’s secondary actions are 34 px tall on a tablet, below the 44 px a hurried thumb needs.', cls: 'O', source: 'trial mains (mains.till.secondary)', validate: 'npm run ux -- --only=mains' }
    ]
  },
  {
    id: 'gerant', kind: 'staff', archetype: 'Le Gérant', name: 'Rachid', age: 45, role: 'Owner and barber; does the numbers at night',
    headline: '« Dis-moi si le mois tient, et si mes gars sont payés juste. »',
    life: 'He is a barber first and a business owner second, and the second job happens at 23:00 on a laptop or a phone with a cold coffee. He wants one answer (is the month on track?) in five seconds, and the proof behind it when his accountant asks. He is wary of anything he cannot audit, and of anything that exposes the shop’s money to a client’s eyes.',
    jobs: [
      'The month’s status against the goal in five seconds',
      'Cash certainty: the till’s Z, sealed',
      'Commission fairness for each barber',
      'No-shows and deposits at a glance',
      'Exports for the accountant without spreadsheet gymnastics'
    ],
    fears: [
      'A compliance fine (the certified-till rule)',
      'A number he cannot explain',
      'Complexity creeping in',
      'Staff seeing the shop’s money'
    ],
    delights: [
      'Pilotage’s tiles with a goal and a projection',
      'The journal’s integrity proof',
      'Privacy mode: amounts hidden',
      'Rules written in plain words'
    ],
    says: ['le mois', 'l’objectif', 'les gars', 'la clôture', 'le comptable'],
    avoids: ['paramétrage', 'module'],
    rhythm: 'Every evening, ten minutes; the month’s end, an hour',
    priority: 'core', weight: 0.2,
    why: 'He signs the product’s cheque, and he is the only persona who reads it as a business, not as a tool.',
    budget: { seconds: 5, taps: 0, chars: 0 },
    moments: ['S03', 'S04'],
    scenes: [
      { id: 'gerant.soir', label: '23:00 on a laptop, dark theme, a cold coffee, checking the month', clock: 'mar-23h12', device: 'laptop', network: 'wifi', scheme: 'dark',
        intent: 'See if the month is on track in five seconds', trials: ['mains'], flow: 'owner' }
    ],
    success: 'He knows whether the month holds before he finishes his coffee.',
    failure: 'Twelve tiles and no verdict; or a number he cannot trace.',
    tells: 'Journal: the owner’s sessions by hour; exports run; the Z closures and their gaps.',
    protect: ['Pilotage’s goal and projection', 'The journal’s integrity proof', 'Privacy mode for amounts'],
    evidence: [
      { claim: 'The owner reviews the numbers in the evening, away from the shop.', cls: 'H', validate: 'Journal: the owner’s session timestamps by hour for a month.' },
      { claim: 'Pilotage opens on tiles with a goal, a projection and comparisons « en cours · comparé à mardi dernier en entier ».', cls: 'O', source: 'web/src/comptoir/pages/Pilotage.tsx; trial mains', validate: 'npm run ux -- --only=mains' }
    ]
  }
];
