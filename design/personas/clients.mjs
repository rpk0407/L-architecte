// The ten people who touch Barber L’Architecte from the outside. Fictional composites, not real clients.
//
// `weight` is the Cabinet’s assumption of each persona’s share of the shop’s visits, pending the salon’s own journal (see
// programme/08-hypotheses.md): replace these numbers with the shares you measure. They add up to 1 and feed the persona view of
// the score, so a wrong weight skews the headline, not the individual findings.
import { STREET, GIFT, TRAINING, EXIT } from './questions.mjs';

/** @typedef {import('./schema.mjs').Persona} Persona */

/** @type {Persona[]} */
export const CLIENTS = [
  {
    id: 'fidele', kind: 'client', archetype: 'Le Fidèle', name: 'Sofiane', age: 34, role: 'Logistics coordinator, lives in the 13th',
    headline: '« Le même que d’hab, dans trois semaines. »',
    life: 'Six years in the same chair, the same Thursday slot after work. He no longer describes his cut: he says « comme d’hab ». His loyalty is to a person, not to a shop: if his barber leaves, he leaves. He books with one thumb, from the tram or from the chair itself, and he notices within a second when something that used to work has moved.',
    jobs: [
      'Rebook the usual cut with the usual barber in two taps',
      'Be recognised: no re-typing, no “create an account”',
      'Know before he plans if his barber is away',
      'Move his slot when life moves, from the SMS, without phoning'
    ],
    fears: [
      'His barber fully booked, and being handed to a stranger without being asked',
      'A site that has forgotten him since last time',
      'A price that changed without warning',
      'Being nudged towards a membership he never asked for'
    ],
    delights: [
      '« Comme la dernière fois ? » as the first thing he sees',
      'His barber’s name on the confirmation',
      'A reminder with a link to move it',
      'The barber remembering last time’s note'
    ],
    says: ['mon barbier', 'comme d’hab', 'le même', 'jeudi, après le taf', 'une place'],
    avoids: ['prestation', 'formule', 'créer un compte'],
    rhythm: 'Every three weeks, same weekday, same hour (hypothesis)',
    priority: 'core', weight: 0.25,
    why: 'Regulars are the base of a four-chair shop; every other persona is a regular in the making or a stranger on the way to one.',
    budget: { seconds: 20, taps: 4, chars: 0 },
    moments: ['M12', 'M13', 'M04', 'M03', 'M08'],
    scenes: [
      { id: 'fidele.tram', label: 'On the tram home, rebooking his usual', clock: 'mer-18h05', device: 'phone', network: '4g', scheme: 'light',
        intent: 'Book the usual cut again as a returning client, three weeks out', trials: ['chrono'], flow: 'rebook' }
    ],
    success: 'Booked in under twenty seconds without typing a character; the confirmation names his barber.',
    failure: 'He is asked who he is again, or shown a stranger’s name. He phones, or he does not rebook.',
    tells: 'Journal: three or more visits with the same staffId at gaps clustered around 14–28 days; Clients › segment « fidèles »; a high « repris avant de partir » rate in Pilotage.',
    protect: [
      '« Comme la dernière fois ? » (the rebook card)',
      'Each barber shown by name with their next free time beside it',
      'The held slot: « Créneau gardé pour toi »'
    ],
    evidence: [
      { claim: 'Regulars return on a steady personal rhythm of about two to four weeks.', cls: 'D', validate: 'Clients › segments: the median gap between visits per client; expect clusters near 14, 21 and 28 days.' },
      { claim: 'Loyalty is to the barber more than to the shop.', cls: 'D', validate: 'Share of a client’s visits with the same staffId (Rapports › équipe); ask five regulars what they would do if he left.' },
      { claim: 'A returning client on the same phone is greeted and offered last time’s visit.', cls: 'O', source: 'public/site.html (hasRebook, « Comme la dernière fois ? »)', validate: 'npm run ux -- --only=chrono (flow rebook)' }
    ]
  },
  {
    id: 'nouveau', kind: 'client', archetype: 'Le Nouveau', name: 'Yanis', age: 22, role: 'Apprentice electrician, three weeks in Marseille',
    headline: '« Je veux pas me faire arnaquer, ni me faire raser la tête. »',
    life: 'He has a photo saved from Instagram and no words for it. On his lunch break he types « barbier près de moi », opens three tabs, and decides in the time it takes to eat a sandwich. He is not hunting for the best barber in Marseille; he wants the one that will not embarrass him, at a price he can read.',
    jobs: [
      'Judge quality in five seconds: real work, real people, a rating he can trust',
      'See the price before anything else',
      'Know if he can come now or soon, and how to get in',
      'Describe the cut without sounding clueless'
    ],
    fears: [
      'A bad cut he will wear for a month',
      'A price that grows at the till',
      'Being judged for not knowing the vocabulary',
      'Arriving at a closed door'
    ],
    delights: [
      '« Les prix, sans surprise. »',
      '« Sans préférence » presented as a normal answer',
      '« Un mot pour ton barbier » to say what he wants in his own words',
      'Photos that are clearly this shop’s'
    ],
    says: ['une coupe', 'un dégradé', 'c’est combien', 'y a de la place aujourd’hui ?', 'près de moi'],
    avoids: ['sabot', 'tapering', 'formule premium', 'sur devis'],
    rhythm: 'One first visit; then every four to five weeks if it goes well (hypothesis)',
    priority: 'core', weight: 0.20,
    why: 'Every regular was a stranger once. The first impression is the acquisition funnel of a shop that lives on word of mouth and Google Maps.',
    budget: { seconds: 60, taps: 8, chars: 20 },
    moments: ['M01', 'M02', 'M03', 'M09'],
    scenes: [
      { id: 'nouveau.rue', label: 'Standing in the square at lunch, Google Maps in one hand, a weak signal', clock: 'sam-12h40', device: 'phone', network: 'slow-4g', scheme: 'light',
        intent: 'Decide in five seconds whether to walk in or to book', trials: ['rue'], questions: STREET },
      { id: 'nouveau.premiere', label: 'His first booking, on the same phone, once he has decided', clock: 'sam-12h40', device: 'phone', network: '4g', scheme: 'light',
        intent: 'Book a first cut as a stranger and know what it costs before committing', trials: ['chrono'], flow: 'first-visit' }
    ],
    success: 'He knows where, how much and when within five seconds, and books without ever feeling stupid.',
    failure: 'He closes the tab and opens the next shop’s.',
    tells: 'Journal: first appointment, source « site » or Google; Clients › segment « nouveaux »; the first-visit no-show rate.',
    protect: [
      'The price in the main button (« Réserver · dès 15 € »)',
      'The live « Prochain créneau » on the hero',
      'The rating next to the address',
      '« Sans préférence · Le plus tôt » as the first choice'
    ],
    evidence: [
      { claim: 'Strangers decide within seconds, on three signals: real work, price, and whether they can get in soon.', cls: 'D', validate: 'Add a one-question exit poll at the till for a month (« qu’est-ce qui t’a décidé ? ») and tally the answers.' },
      { claim: 'The first viewport carries the price, the live next slot, the rating and the place; it does not carry the open status, a phone number or directions.', cls: 'O', source: 'trial rue (rue.q.*)', validate: 'npm run ux -- --only=rue' },
      { claim: 'Online booking weighs on the choice of a barbershop (one vendor survey: 37% most likely to choose a shop that offers it).', cls: 'V', source: 'https://www.zenoti.com/thecheckin/barbershop/barbershop-client-insights', validate: 'Ask new clients how they found and how they booked; compare with the journal’s source field.' }
    ]
  },
  {
    id: 'presse', kind: 'client', archetype: 'Le Pressé', name: 'Julien', age: 41, role: 'Sales director, sixty-hour weeks',
    headline: '« Donne-moi la prochaine place. N’importe quel barbier. »',
    life: 'He books his cut the way he books a train: late, in bed, in under a minute, or in a car park between two calls. He does not browse. He has no loyalty to a chair, only to the shop that makes it frictionless, and he will abandon on the first field he does not understand. He will never create an account.',
    jobs: [
      'The next available slot with anyone, in under forty-five seconds',
      'No account, the fewest possible fields',
      'A confirmation he can forward to his assistant',
      'Cancel by SMS link at 7 a.m. when a meeting moves'
    ],
    fears: [
      'A form longer than his patience',
      'A slot that disappears while he types',
      'Being forced to choose between things he has no opinion about',
      'A wall of text about deposits'
    ],
    delights: [
      '« Prochain créneau » on the home page',
      '« Sans préférence · Le plus tôt » as the first option',
      'The hold timer (he trusts the slot)',
      'The SMS with the move link'
    ],
    says: ['dispo', 'le plus tôt', 'vendredi soir', 'n’importe qui', 'annuler'],
    avoids: ['créer un compte', 'newsletter', 'choisir parmi onze'],
    rhythm: 'Every three to four weeks, booked two to seven days ahead (hypothesis)',
    priority: 'core', weight: 0.18,
    why: 'The persona who most rewards a frictionless flow, and the one who punishes any ceremony. He is the stress test of the happy path.',
    budget: { seconds: 45, taps: 6, chars: 20 },
    moments: ['M04', 'M05', 'M07', 'M08'],
    scenes: [
      { id: 'presse.nuit', label: '23:12 in bed, dark mode, one thumb, the shop is closed', clock: 'mar-23h12', device: 'phone', network: '4g', scheme: 'dark',
        intent: 'Book the earliest slot with anyone, then survive the keyboard and a dropped signal', trials: ['chrono', 'nuit', 'clavier', 'tram', 'retour'], flow: 'fastest' }
    ],
    success: 'Booked in under forty-five seconds, five taps and a first name and a number.',
    failure: 'He backs out at the form, or at a choice he did not want to make.',
    tells: 'Journal: source « site », booking timestamp after 21:00, appointment within 7 days, no preferred barber.',
    protect: [
      '« Prochain créneau » on the home page',
      '« Sans préférence · Le plus tôt » and the « Le plus tôt · Choisir » shortcut',
      'Two required fields, the rest labelled « facultatif »',
      'The five-minute held slot, visible'
    ],
    evidence: [
      { claim: 'A large share of bookings are made outside opening hours, on a phone, at night.', cls: 'D', validate: 'Rapports: hour of the booking timestamp for source « site »; expect a bump after 21:00.' },
      { claim: 'The path he needs exists: next slot on the home page, « Sans préférence · Le plus tôt », a quick-pick, no account.', cls: 'O', source: 'public/site.html (hr-next, wh « Sans préférence », .fast)', validate: 'npm run ux -- --only=chrono (flow fastest)' },
      { claim: 'Deposits cut no-shows sharply while costing few conversions (a vendor’s figures: 40–60% fewer no-shows, 3–5% fewer bookings).', cls: 'V', source: 'https://bookedin.com/?p=16018', validate: 'Compare the no-show rate on the long services before and after the deposit (journal appt.noshow); needs weeks of data.' }
    ]
  },
  {
    id: 'parent', kind: 'client', archetype: 'Le Parent', name: 'Nadia', age: 36, role: 'Night-shift nurse; two sons (8 and 11) and a husband',
    headline: '« Trois têtes à faire, une seule soirée de libre. »',
    life: 'The person who books is not the person who sits in the chair. She plans on Sunday evening with an iPad on her knees, interrupted every ninety seconds. She wants the boys one after the other, or with two barbers at once, and one text to say so. Every flow built for one person costs her three bookings and a good deal of goodwill.',
    jobs: [
      'Book two or three people back to back, in one go',
      'Know the price and the time of each (a child’s cut is shorter)',
      'One confirmation, one SMS, one link to move them all',
      'Put the tablet down for five minutes and find everything where she left it'
    ],
    fears: [
      'Booking three separate appointments on three different days',
      'A barber with no patience for an eight-year-old',
      'Losing the form when a child shouts',
      'A hold timer that expires mid-argument'
    ],
    delights: [
      '« Ajouter une personne » (it does not exist yet)',
      'A suggestion of consecutive slots',
      'A child’s price stated plainly',
      'One reminder that lists everyone'
    ],
    says: ['les garçons', 'mon mari et mes fils', 'à la suite', 'pour mon fils'],
    avoids: ['un seul client par réservation'],
    rhythm: 'Each child every four to six weeks, the father every three (hypothesis)',
    priority: 'growth', weight: 0.09,
    why: 'The booker is not the client: each parent is two or three clients at once, and the gap is structural, not cosmetic.',
    budget: { seconds: 120, taps: 14, chars: 50 },
    moments: ['M03', 'M04', 'M05', 'M07'],
    scenes: [
      { id: 'parent.dimanche', label: 'Sunday 20:30 on the sofa, an iPad, interrupted every ninety seconds', clock: 'dim-20h30', device: 'tablet-portrait', network: 'wifi', scheme: 'light',
        intent: 'Book a father and his son back to back; be interrupted for six minutes and come back', trials: ['duo', 'tram'], flow: 'duo' }
    ],
    success: 'Two people booked back to back in one sitting, one confirmation for both.',
    failure: 'She books one, forgets the other, and phones.',
    tells: 'Journal: pairs of appointments by different clients on the same booking phone, within ten minutes of each other, same day.',
    protect: ['The held slot and its visible timer', 'Nothing typed lost when the screen is left'],
    evidence: [
      { claim: 'Parents book for several people in one sitting.', cls: 'D', validate: 'Journal: pairs of appointments, different clients, same booking phone, created within ten minutes.' },
      { claim: 'The booking sheet takes one person per booking and offers no « add a person ».', cls: 'O', source: 'trial duo (duo.capability)', validate: 'npm run ux -- --only=duo' }
    ]
  },
  {
    id: 'occasion', kind: 'client', archetype: 'L’Occasion', name: 'Théo', age: 27, role: 'Wedding witness, Saturday',
    headline: '« Samedi, c’est le grand jour. Je dois être irréprochable. »',
    life: 'Once or twice a year something happens (a wedding, an interview, a new job, a break-up) and he wants a different head. He has the most to lose, spends the most and reads everything. For him a clear deposit rule and a named diagnostic are reassurance, not friction.',
    jobs: [
      'Secure the right transformation slot before Friday',
      'Understand what is included and how long it really takes',
      'Understand the deposit: how much, why, what if he cancels',
      'See that the shop has done this before'
    ],
    fears: [
      'An irreversible colour result',
      'No slot left by Thursday',
      'Losing a deposit he did not understand',
      'Not being heard: nobody to ask'
    ],
    delights: [
      '« Diagnostic · Étude de faisabilité · Coupe » in plain words',
      'A deposit line that says why, once',
      '« Un mot pour ton barbier »',
      'Before-and-after photos of similar work'
    ],
    says: ['décoloration', 'blond', 'pour un mariage', 'c’est faisable ?', 'combien de temps ça prend'],
    avoids: ['frais de dossier', 'pénalité'],
    rhythm: 'Once or twice a year, with a hard deadline (hypothesis)',
    priority: 'growth', weight: 0.07,
    why: 'The highest ticket per visit (Transformation 50 €, Silver 100 €) and the likeliest to tell the story afterwards.',
    budget: { seconds: 120, taps: 9, chars: 25 },
    moments: ['M02', 'M04', 'M06', 'M07'],
    scenes: [
      { id: 'occasion.lundi', label: 'Monday 21:00, the wedding is Saturday and the shop is closed', clock: 'lun-21h00', device: 'phone', network: '4g', scheme: 'light',
        intent: 'Book a Transformation and understand the deposit before paying', trials: ['chrono'], flow: 'deposit' }
    ],
    success: 'He books the right service, understands the deposit before the button, and trusts the slot.',
    failure: 'He discovers the deposit at the payment step and feels trapped.',
    tells: 'Journal: Transformation, Décoloration or Silver booked within seven days of the appointment; deposit paid.',
    protect: ['The service names that say what is included', 'The deposit line before the confirm button'],
    evidence: [
      { claim: 'Occasion-driven clients buy the longest, dearest services and have a hard deadline.', cls: 'D', validate: 'Rapports: share of Transformation, Décoloration and Silver bookings made within seven days of the appointment.' },
      { claim: 'The deposit is explained on the details step, before the confirm button.', cls: 'O', source: 'public/site.html (.dep, depLine)', validate: 'npm run ux -- --only=chrono (flow deposit)' }
    ]
  },
  {
    id: 'passionne', kind: 'client', archetype: 'Le Passionné', name: 'Mehdi', age: 19, role: 'Student, plays football, follows barbers on Instagram',
    headline: '« C’est qui qui fait les dégradés à blanc ici ? »',
    life: 'He knows the names of the fade styles and of the barbers who invented them. He reads a barbershop’s site the way a designer reads a portfolio: the photography, the type, how it moves. He books a barber, not a shop; if the site looks like a template, he assumes the cuts do too. He is also the one who shares: his story on Friday night is the shop’s best advertising.',
    jobs: [
      'See each barber’s hand: portfolio, specialty, Instagram',
      'Book that barber, and nobody else',
      'Feel that the shop has taste, in motion, photography and copy',
      'Share a booking or a result without friction'
    ],
    fears: [
      'Stock photography',
      'A slow, heavy, over-animated page',
      'Marketing language',
      'Not being able to tell who does what'
    ],
    delights: [
      'Real work in the gallery',
      'A barber’s name that opens onto their hand and their Instagram',
      'Motion with a point',
      'A moment worth sharing'
    ],
    says: ['fade', 'skin fade', 'dégradé à blanc', 'le barber', 'le rendu'],
    avoids: ['coupe homme classique', 'formule', 'prestation'],
    rhythm: 'Every two to three weeks, to keep the fade sharp (hypothesis)',
    priority: 'growth', weight: 0.08,
    why: 'Small revenue, large reach: the ambassador, and the toughest design critic who will ever open the site.',
    budget: { seconds: 90, taps: 6, chars: 0 },
    moments: ['M01', 'M02', 'M03'],
    scenes: [
      { id: 'passionne.vendredi', label: 'Friday 17:00 on a laptop, scrolling slowly, judging', clock: 'ven-17h00', device: 'desktop', network: 'wifi', scheme: 'light',
        intent: 'Judge the craft: type, motion, photography, performance', trials: ['atelier'] }
    ],
    success: 'He thinks « ils savent ce qu’ils font », follows a barber and books.',
    failure: 'He decides it is a template and goes where his friends go.',
    tells: 'Journal: a named barber chosen, age under 25, frequent short-gap visits; the note field names a style.',
    protect: ['Real photography of the shop’s own work', 'Motion that respects reduced-motion', 'Self-hosted fonts and no third-party requests'],
    evidence: [
      { claim: 'Young clients choose a barber by name and by style, mostly through Instagram.', cls: 'D', validate: 'Count the barbers named in the booking note field; ask « comment as-tu connu ton barbier ? » for a month.' },
      { claim: 'The roster’s avatars are initials in halftone discs, not portraits.', cls: 'O', source: 'public/site.html #barbiers (screenshot: design trial atelier)', validate: 'npm run ux -- --only=atelier; panel: art-director, persona-voice(passionne)' }
    ]
  },
  {
    id: 'ancien', kind: 'client', archetype: 'L’Ancien', name: 'Gérard', age: 67, role: 'Retired technician, grandfather of three',
    headline: '« Je préfère téléphoner, mais montrez-moi comment faire. »',
    life: 'His grandson showed him the site. He has had his hair cut by someone he knew for thirty years and is wary of anything that needs a screen. His eyes tire at small grey text, and his thumb is wider than the icon. He needs to see that it worked (the day, the hour and the barber in words) and a number to call if it did not.',
    jobs: [
      'Find the opening hours and a phone number at once',
      'Read everything without squinting or zooming',
      'Never make an irreversible mistake with a tap',
      'Keep a confirmation he can show or reread'
    ],
    fears: [
      'Tapping the wrong thing',
      'A countdown that makes him feel rushed',
      'Icons without words',
      'Being treated as a problem'
    ],
    delights: [
      'Large, plain type',
      'A phone number that dials on tap',
      'A confirmation in full words',
      'A person answering at the shop'
    ],
    says: ['le salon', 'prendre rendez-vous', 'mardi prochain', 'le matin', 'téléphoner'],
    avoids: ['icônes sans mots', 'compte à rebours', 'jargon'],
    rhythm: 'Every four weeks, mornings (hypothesis)',
    priority: 'edge', weight: 0.05,
    why: 'A small share, but the persona that exposes every shortcut in accessibility, and the grandfather who brings three generations through the door.',
    budget: { seconds: 180, taps: 10, chars: 20 },
    moments: ['M01', 'M07', 'M08', 'M09', 'M14'],
    scenes: [
      { id: 'ancien.jeudi', label: 'Thursday 10:00, large print, looking for a phone number', clock: 'mar-15h10', device: 'phone-tiny', network: '4g', scheme: 'light',
        intent: 'Find the hours and a number to call; read without squinting; book without a mistake', trials: ['ancien'] }
    ],
    success: 'He finds a number or books, and holds a confirmation he can read aloud.',
    failure: 'He cannot find how to reach a person, so he walks in or does not come.',
    tells: 'Journal: source « phone » or « walkin », age over 60 (birth date is kept for birthdays); interviews with three clients over sixty.',
    protect: ['Plain labels on controls', 'Nothing breaks at 320 px', 'The cancellation page reachable from every footer'],
    evidence: [
      { claim: 'Older clients prefer to phone and need larger, higher-contrast text.', cls: 'D', validate: 'Journal: share of appointments with source « phone » by age band; interview three clients over sixty.' },
      { claim: 'The salon’s phone number is configured, yet the site offers no tap-to-call outside an error state.', cls: 'O', source: 'public/site.html (contactHref, only when there is no menu); the demo seed sets 04 91 00 00 00', validate: 'npm run ux -- --only=ancien (ancien.phone)' }
    ]
  },
  {
    id: 'abonne', kind: 'client', archetype: 'L’Abonné', name: 'Maxime', age: 29, role: 'Field technician, always on the road',
    headline: '« Je paye pour ne plus y penser. »',
    life: 'He pays monthly so that a cut is never an event. He wants to know how many are left, when the next charge is, and that he can stop whenever he wants without a conversation. He measures the shop by how little it asks of him, and by how it behaves on the day he leaves.',
    jobs: [
      'Book with no payment friction',
      'Know the cuts left and the next charge',
      'Understand the rule in plain words (lost, month, free)',
      'Cancel with dignity'
    ],
    fears: [
      'Paying for cuts he cannot use',
      'A lock-in he cannot undo',
      'A rule he understood only after losing a cut',
      'An unexplained charge'
    ],
    delights: [
      '« Réservé avec ton abonnement : rien n’est demandé en ligne »',
      'A member page that says what is left',
      'An honest, one-tap cancellation',
      'The rule said in words'
    ],
    says: ['mon abonnement', 'ma coupe de la semaine', 'résilier', 'prélèvement'],
    avoids: ['engagement', 'période de rétractation (unexplained)'],
    rhythm: 'Every week or two, on his own day (hypothesis)',
    priority: 'growth', weight: 0.04,
    why: 'Recurring revenue, and the only persona with a legal right to leave that the product already honours.',
    budget: { seconds: 30, taps: 5, chars: 0 },
    moments: ['M04', 'M14'],
    scenes: [
      { id: 'abonne.sortie', label: 'He wants out: from the footer, on his phone, with no account', clock: 'mar-15h10', device: 'phone', network: '4g', scheme: 'light',
        intent: 'Find how to cancel his membership and understand what happens next', trials: ['guichet'], flow: 'questions', route: '/resilier', via: /r[ée]silier/i, questions: EXIT }
    ],
    success: 'He cancels in a few taps and is told exactly what happens next.',
    failure: 'He is made to justify himself, or cannot find the door.',
    tells: 'Journal: Clients › Abonnés; the cancellation rate and the reason field; the 14-day withdrawals.',
    protect: ['« Résilier mon abonnement » in every footer', 'The member page’s plain-words rule', '« Renoncer au contrat ici » for the 14-day right'],
    evidence: [
      { claim: 'French consumer law now expects cancelling online to be as easy as subscribing; the salon’s counsel should confirm the exact scope.', cls: 'D', validate: 'Ask the salon’s counsel; the product already ships /resilier, the footer link and the 14-day withdrawal.' },
      { claim: 'A cancellation path exists without an account, linked from the site’s footer.', cls: 'O', source: 'public/resilier.html; public/site.html footer', validate: 'npm run ux -- --only=guichet' }
    ]
  },
  {
    id: 'cadeau', kind: 'client', archetype: 'Le Cadeau', name: 'Camille', age: 31, role: 'Buys for her father’s birthday; has never set foot in the shop',
    headline: '« Je veux offrir quelque chose de beau, sans me tromper. »',
    life: 'She is not a client; she is a gift-giver buying for someone who is. She needs to choose an amount, add a few words and have it arrive in minutes, looking like a gift and not a voucher. She comes twice a year (Father’s Day, Christmas) and is the cheapest customer the shop will ever acquire.',
    jobs: [
      'Choose an amount and a message in under two minutes',
      'Have it arrive at once and look beautiful',
      'Know how it will be used and how long it lasts',
      'Pay once, with trust, a shop she has never seen'
    ],
    fears: [
      'A cheap-looking voucher',
      'Choosing the wrong amount',
      'The recipient not knowing how to use it',
      'A shop she cannot judge'
    ],
    delights: [
      'A preview of the card',
      'Amounts tied to real services',
      'Instant delivery',
      'A personal message'
    ],
    says: ['une carte cadeau', 'pour mon père', 'offrir', 'bon d’achat'],
    avoids: ['bon d’achat anonyme', 'frais cachés'],
    rhythm: 'Twice a year, around Father’s Day and Christmas (hypothesis)',
    priority: 'edge', weight: 0.02,
    why: 'Small and seasonal, but a gift card is a new client who arrives already persuaded by someone they trust.',
    budget: { seconds: 120, taps: 8, chars: 80 },
    moments: ['M02', 'M07'],
    scenes: [
      { id: 'cadeau.soir', label: 'A weekday evening on a phone, buying for her father', clock: 'lun-21h00', device: 'phone', network: '4g', scheme: 'light',
        intent: 'Buy a gift card and know it worked', trials: ['guichet'], flow: 'questions', route: '/carte-cadeau', questions: GIFT }
    ],
    success: 'She buys, sees the card, and knows exactly what her father will receive.',
    failure: 'She is unsure what he gets, and buys flowers instead.',
    tells: 'Journal: gift-card sales by month (Catalogue › Cartes cadeaux); redemptions by first-time clients.',
    protect: ['A four-step order with one button', 'Self-hosted fonts on the gift page too'],
    evidence: [
      { claim: 'Gift cards sell in two seasonal peaks, around Father’s Day and Christmas.', cls: 'D', validate: 'Catalogue › Cartes cadeaux: sales by month over a year.' },
      { claim: 'The gift page is a four-step order with one button.', cls: 'O', source: 'public/carte-cadeau.html', validate: 'npm run ux -- --only=guichet' }
    ]
  },
  {
    id: 'futur', kind: 'client', archetype: 'Le Futur Barbier', name: 'Nassim', age: 18, role: 'Wants to become a barber; his mother reads over his shoulder',
    headline: '« Je veux apprendre le dégradé, pas regarder des vidéos. »',
    life: 'He has practised on his friends for two years. He has found that the shop is an approved training centre, and he wants three answers: what it costs, when, and whether it leads to a diploma. His mother wants the same answers in writing, and a person to talk to.',
    jobs: [
      'Know the modules, who teaches, the cost and the dates',
      'Know whether it is certified',
      'Ask a question and be answered by a person',
      'See the work of the people who would teach him'
    ],
    fears: [
      'A scam school',
      '« Sur devis » meaning « trop cher pour le dire »',
      'Silence after he sends his details',
      'Not being taken seriously at eighteen'
    ],
    delights: [
      'Named modules with real content',
      '« Salon formateur agréé » with a proof',
      'A short form with a promised reply time',
      'A visible human'
    ],
    says: ['formation', 'apprendre', 'stage', 'diplôme', 'agrément'],
    avoids: ['sur devis (without a range)', 'sur demande (without a date)'],
    rhythm: 'A single enquiry, once, with a long decision (hypothesis)',
    priority: 'edge', weight: 0.02,
    why: 'A different business line (training, quoted) with a different funnel (an enquiry form): small volume, high margin.',
    budget: { seconds: 120, taps: 6, chars: 200 },
    moments: ['M01', 'M02'],
    scenes: [
      { id: 'futur.formations', label: 'After class, on a phone, with his mother', clock: 'ven-17h00', device: 'phone', network: '4g', scheme: 'light',
        intent: 'Understand the training offer and ask a question', trials: ['guichet'], flow: 'questions', route: '/formations', questions: TRAINING }
    ],
    success: 'He knows what, whether certified, and how to ask; the form promises a reply.',
    failure: 'He cannot tell what it costs or when, and does not write.',
    tells: 'Journal: the enquiries inbox (Réglages › Demandes); the share that mention a diploma or an apprenticeship.',
    protect: ['Named modules with real content', '« Titulaire d’un agrément de formateur » stated up front'],
    evidence: [
      { claim: 'The training offer is quoted on request: the prices and the next sessions are not published.', cls: 'O', source: 'public/formations.html (« Sur devis », « Sur demande »)', validate: 'npm run ux -- --only=guichet' },
      { claim: 'A prospective trainee needs a price range and a date before he writes.', cls: 'H', validate: 'Count enquiries that ask « combien » or « quand » as their first line; A/B a price range on one module.' }
    ]
  }
];
