// Shapes returned by the API (see server/http/views.js).
export type Staff = { id: string; name: string; initials: string; color: string; role: 'owner' | 'manager' | 'desk' | 'barber'; roleLabel: string; chair: boolean; bookable: boolean; active: boolean; order: number; bio: string; instagram: string; photo?: number | null; photoSite?: boolean; email?: string; services?: 'all' | string[]; schedule?: Record<string, [number, number][]>; commission?: { service: number; product: number }; hasPwd?: boolean; hasPin?: boolean };
// TEAM-02: one's own Comptoir (server/projections/staffprefs.js); cards/hidden order Mon espace's cards (TEAM-04); cal: the
// calendar feed's generation (0: off); device.personal: one's own linked phone; Staff.photo: the photo's version
// GUIDE-01a: tour, his guided tour (v: the version offered, 0 never; at: the step id he stopped on; done: finished or skipped)
export type TourPrefs = { v: number; at: string; done: boolean };
// WP3 · the Accueil's own choices, all optional: homeCards the order pinned inside a group, homeHidden the cards masked,
// homeDay whose day it shows to someone with a chair and the salon's rights (absent: 'salon'), tabs the three phone tabs
// after « Accueil », views the saved lists (8 at most)
export type SavedView = { page: string; name: string; query: string };
// homeBlocks: the Accueil's own blocks he keeps in sight (absent: all, or this device's earlier choice)
export type Prefs = { homeBlocks?: { prochain: boolean; fauteuils: boolean; jour: boolean }; home: 'auto' | 'accueil' | 'espace' | 'agenda' | 'pilotage'; notify: 'mine' | 'all' | 'none'; buzz: boolean; cards: string[]; hidden: string[]; blur: 'auto' | 'on' | 'off'; cal: number; calName: boolean; tour?: TourPrefs; homeCards?: string[]; homeHidden?: string[]; homeDay?: 'salon' | 'moi'; tabs?: string[]; views?: SavedView[] };
export type Me = Staff & { caps: string[]; device: { id: string; name: string; personal?: boolean } | null; session: 'pwd' | 'pin'; prefs: Prefs };
export type Service = { id: string; slug: string | null; name: string; short: string; category: string; price: number; from: boolean; dur: number; buffer: number; online: boolean; deposit: number | null; vat: number; order: number; description: string; includes: string[]; pack: { credits: number; days: number; serviceIds?: string[]; weekly?: boolean; missed?: 'lost' | 'once' } | null; tag?: string; active: boolean };
export type Product = { id: string; name: string; price: number; cost: number; stock: number; low: number; vat: number; sku: string; category: string; active: boolean };
export type Settings = any;
export type Boot = { me: Me; mode: 'demo' | 'production'; today: string; now: number; version: number; cfg: number; settings: Settings; staff: Staff[]; services: Service[]; products: Product[]; providers: { payments: string; paymentsLive: boolean; sms: string | null; store: string }; warnings: string[]; alerts?: string[] };

export type ClientCard = { id: string; first: string; last: string; name: string; phone: string; hasPhone: boolean; hasEmail: boolean; badges: string[]; visits: number; lastDay: string | null; sinceLast: number | null; cadence: number | null; spend: number; noShows: number; next: { id: string; day: string; start: number; staffId: string } | null; overdue: boolean; dueIn: number | null; tech: string; sms: boolean; marketing?: boolean; packs: { id: string; name: string; used: number; total: number; expires: string; serviceIds: string[] }[]; memberships: MemberCard[] };
export type ClientFull = ClientCard & { email: string; notes: string; birthday: string; tags: string[]; marketing: boolean; source: string; createdAt: number; erased: boolean };
// PAY-02/05: the monthly membership. MemberCard rides on a client's card (views.js memberCards); MemberRow is a line of
// Clients › Abonnés (routes-membership.js rowOf); a barber's rows never carry a payment in trouble, the card or the refund.
export type MemberStatus = 'pending' | 'active' | 'grace' | 'unpaid' | 'paused' | 'ending' | 'ended';
// PAY-07: a weekly plan (rhythm 'week') says its rule and this calendar week's covered cuts; absent, the plan is monthly
export type MemberWeek = { start: string; end: string; used: number; of: number };
export type MemberCard = { id: string; plan: string; planId: string; status: MemberStatus; used: number; of: number; until: string | null; cancelAt: string | null; card: string; rhythm?: 'week'; perWeek?: number; missed?: 'lost' | 'month' | 'free'; week?: MemberWeek | null };
/** A week of the member's billing month on the board (domain/membership.js weeksOf): came, or still to come. */
export type MemberWeekDot = { start: string; end: string; came: boolean; cuts: number; future: boolean };
export type MemberRow = {
  /** price, next, refund, card, pastDueSince, disputed: who manages the contracts only (price null, next null for the others) */
  id: string; clientId: string | null; first: string; plan: string; planId: string; price: number | null; status: MemberStatus; channel: string; used: number; of: number; until: string | null;
  cancelAt: string | null; cancelVerified: boolean | null; pastDueSince: number | null; card: string; disputed: boolean; since: number | null; endedAt: number | null; endReason: string;
  next: string | null; refund: number;
  // PAY-07: his rule, this week, the weeks of his billing month, his last visit (a covered cut or any visit done)
  rhythm: 'month' | 'week'; perWeek?: number; missed?: 'lost' | 'month' | 'free'; week: (MemberWeek & { came: boolean }) | null; weeks: MemberWeekDot[]; lastVisit: string | null;
};
export type MemberSummary = {
  day: string; pending: number; active: number; grace: number; unpaid: number; ending: number; paused: number; disputed: number; live: number; mrr: number; graceDays: number;
  days30: { joined: number; left: number; churn: number }; troubled: number; month: { month: string; cuts: number; value: number; collected: number };
  /** PAY-07: the weekly members' weeks over their billing month (rate: attended of elapsed, %) */
  weeks?: { members: number; attended: number; elapsed: number; missed: number; notYet: number; rate: number };
};
/** GET /api/v1/memberships/:id/cover: the till's dry check (routes-membership.js). */
export type Cover = { ok: boolean; why: 'ended' | 'paused' | 'unpaid' | 'service' | 'quota' | 'soon' | 'week' | null; used: number; of: number; until: string | null; next: string | null; label: string; words: string; force: boolean; plan: string };
/** settings.membership.plans (server/settings/membership.js) */
export type Plan = { id: string; name: string; price: number; cuts: number; minDays: number; serviceIds: string[]; vat?: number; online: boolean; blurb: string; active: boolean; rhythm?: 'month' | 'week'; perWeek?: number; missed?: 'lost' | 'month' | 'free' };
export type ApptService = { id: string; name: string; price: number; from: boolean; dur: number };
export type Appt = { id: string; code: string; staffId: string; anyStaff: boolean; day: string; start: number; dur: number; services: ApptService[]; price: number; status: 'pending' | 'booked' | 'arrived' | 'in_chair' | 'done' | 'no_show' | 'cancelled'; source: string; note: string; name: string; client: ClientCard | null; deposit: { amount: number; paid: number; paymentId: string | null } | null; saleId: string | null; createdAt: number; statusAt: Record<string, number>; cancel: any; moves: number; demo: boolean; legacy?: boolean ; /** a deposit paid on the old site, to settle at the till once (« Payé sur l’ancien site ») */ paidOld?: number;
  /** a date of a carnet bought with its dates: « coupe n sur of »; sell: the carnet is still to pay, this ticket sells it; deposit: its price paid online, for that ticket; packId: the carnet that pays the cut */
  formule?: ApptFormule };
export type ApptFormule = { id: string; n: number; of: number; pay: 'paid' | 'online' | 'pending' | 'due'; packId: string | null; sell: { serviceId: string; name: string; price: number } | null; deposit: { paymentId: string; paid: number } | null };
/** « coupe 3 sur 5 » */
export const serieWords = (f?: { n: number; of: number } | null) => (f ? 'coupe ' + f.n + ' sur ' + f.of : '');
export type Lane = Staff & { work: [number, number][] };
export type Block = { id: string; staffId: string; day: string; start: number; dur: number; label: string };
export type Hold = { id: string; staffId: string; start: number; dur: number; exp: number; by: string };
export type QueueItem = { id: string; name: string; hasPhone: boolean; serviceId: string; staffId: string; status: 'waiting' | 'called'; at: number; calledAt: number | null };
export type Wait = { id: string; first: string; staffId: string; serviceId: string; from: number; to: number; status: string; offer: any; at: number };
export type Kpis = { total: number; done: number; noShows: number; upcoming: number; revenue: number | null; tips: number | null; planned: number | null; fill: number; scope: 'own' | 'shop' | 'desk' };
export type Agenda = { day: string; lanes: Lane[]; appts: Appt[]; blocks: Block[]; holds: Hold[]; waitlist: Wait[]; queue: QueueItem[]; closed: boolean; closure: any; kpis: Kpis; walkin: { minutes: number | null; queued: number } | null; drawer: { open: boolean; since?: number };
  // « À rappeler »: clients still booked on the chair of a barber who is away that day (for whoever edits every chair)
  toCall?: { staffId: string; timeoffId: string | null; rows: { id: string; start: number; dur: number; name: string; services: string[]; phone: string }[] }[] };
// staffId: the chair a line is about (a barber's own toasts); null on a line only for the cap it names, which may name
// its subject in aboutStaffId (an absence told to the team holders)
export type FeedItem = { v: number; at: number; by: string; kind: string; title: string; sub: string; apptId?: string; saleId?: string; day?: string; money?: boolean; staffId?: string | null; aboutStaffId?: string };
export type Pulse = { version: number; cfg: number; now: number; today: string; min: number; feed: FeedItem[]; badges: { toPay: number; queue: number; relances: number; waitlist: number; retention?: number; requests?: number; hand?: number; handOn?: boolean }; alerts?: string[] };
export type SaleLine = { kind: 'service' | 'product' | 'giftcard' | 'pack' | 'fee' | 'membership'; ref: string | null; name: string; qty: number; unit: number; discount: number; net: number; staffId: string | null; vat: number; packId: string | null; memberId?: string | null };
export type Sale = { id: string; number: number; ref: string; day: string; at: number; apptId: string | null; clientId: string | null; client: string | null; cashier: string; lines: SaleLine[]; discount: { amount: number; reason: string } | null; tip: { amount: number; staffId: string } | null; totals: { gross: number; discount: number; total: number; tip: number; due: number; revenue: number; revenueHT: number; liability: number; vat: { rate: number; base: number; tax: number }[] }; payments: { method: string; amount: number; given?: number; change?: number; last4?: string }[]; refunded: number; refunds: { id: string; ref: string; amount: number; method: string; reason: string; at: number }[]; note: string };
// GET /api/v1/reports in own scope (TEAM-01): the salon's progress (goalPct a whole %, null without a goal; fill 0..1),
// and each barber's figures with report.team, never commission, rates or tips.
export type TeamRow = { id: string; name: string; color: string; revenue: number; done: number; occupancy: number; rebookRate: number; noShows: number; avgTicket: number };
export type OwnSide = { salon?: { goalPct: number | null; fill: number }; team?: TeamRow[] };
// TEAM-03: a person's row of GET /api/v1/reports (shop and own scope). revenue is his Chiffre réalisé: refunds deducted on
// their day, carnet and membership cuts credited at their value; commission on base 'ttc' or 'ht'.
export type Count = { n: number; net: number };
export type StaffRow = {
  id: string; name: string; color: string; chair: boolean; revenue: number; revenueHT: number; serviceRevenue: number; productRevenue: number; services: number;
  tips: number; tipsCard: number; tipsCash: number; tickets: number; clients: number; avgTicket: number; done: number; noShows: number; occupancy: number; rebookRate: number;
  commission: number; rates: { service: number; product: number }; base: 'ttc' | 'ht'; walkins: number; walkinOverrides: number; newClients: number; newToMe: number;
  discounts: number; refunds: number; refundCount: number; cutsCarnet: { n: number; value: number; estimated: number; unpriced?: number }; cutsMember: { n: number; value: number };
  rewards: { n: number; value: number }; paid: { services: Count; products: Count; fees: Count; packs: Count };
  capMin: number; idleMin: number; perHour: number; returned60: number; returned60Mine: number; returned60Base: number;
};
/** Why the team's Chiffre réalisé is not Encaissé: carnets and memberships sold and used, free loyalty cuts, lines without a barber. */
export type Gap = { prepaidSold: number; prepaidUsed: number; rewards: number; unassigned: number };
/** goalOf (server/domain/insights.js), with the month's length and the days gone for the Rapports card. */
/** « À ce rythme » (goalOf, server/domain/insights.js): one projection for Pilotage and Rapports. pace: open days elapsed (today pro rata
 *  of its opening hours already past) of the month's open days; expected: where the bar should be by now (0..1). Optional: an older server. */
export type GoalPace = { projection?: number | null; pace?: { elapsed: number; total: number }; expected?: number };
export type GoalView = { staffId: string | null; month: string; target: number; auto: boolean; done: number; pct: number; perDay: number; openDaysLeft: number; week: { from: string; to: string; target: number; done: number }; days: number; elapsed: number } & GoalPace;
/** GET /api/v1/statements: a barber's month (server/domain/statement.js). */
export type Statement = {
  month: string; from: string; to: string; label: string; provisional: boolean; staff: { id: string; name: string; color: string };
  base: 'ttc' | 'ht'; rates: { service: number; product: number }; cutCredit: 'performer' | 'seller'; memberCredit: 'split' | 'zero' | 'list'; rewardCredit: 'list' | 'net';
  performed: number; performedHt: number; commission: number; services: Count; products: Count; fees: Count; packs: Count;
  cuts: { carnet: { n: number; value: number; estimated: number; unpriced?: number }; member: { n: number; value: number } }; rewards: { n: number; value: number };
  refunds: number; refundCount: number; tips: { card: number; cash: number }; discountsGiven: number; done: number; noShows: number; walkins: number;
  absenceDays: number; workedDays: number; warnings: string[];
};

// TEAM-04: GET /api/v1/espace (server/domain/espace.js), a barber's own home. Only his appointments, his figures and the
// salon in percent; `now` and `next` are today's (null on another day).
export type EspaceStatus = 'pending' | 'booked' | 'arrived' | 'in_chair' | 'done' | 'no_show';
export type EspaceNow =
  | { min: number; status: 'free'; until: number }
  | { min: number; status: 'busy'; phase: 'chair' | 'arrived' | 'expected'; with: string; until: number }
  | { min: number; status: 'busy'; phase: 'block'; label: string; until: number }
  | { min: number; status: 'off'; kind: 'none' | 'before' | 'break' | 'after'; until: number | null };
export type CutNoteView = { id: string; apptId: string; day: string; staff: string; by?: string; mine: boolean; text: string; edited: boolean };
export type EspaceNext = {
  id: string; start: number; dur: number; name: string; services: string[]; status: EspaceStatus; late: number; paid: boolean; note: string; tech: string; serie?: string;
  client: {
    id: string; name: string; visits: number; withMe: number; firstVisit: boolean; usual: boolean; lastCut: { day: string; staffName: string; services: string[] } | null; cadence: number | null;
    birthdaySoon: { inDays: number; day: string } | null; noShows: number; member: { kind: 'member' | 'carnet'; label: string; used: number; of: number; rhythm?: 'week'; perWeek?: number; missed?: 'lost' | 'month' | 'free'; week?: MemberWeek | null } | null; prefersMe: boolean;
  } | null;
  cutNotes: CutNoteView[]; myNote: string | null; canNote: boolean; lateNotice: { min: number | null; at: number | null } | null;
};
export type EspaceRow = { id: string; start: number; dur: number; name: string; clientId: string | null; services: string[]; status: EspaceStatus; late: number; firstVisit: boolean; paid: boolean; noted: boolean; needsNote: boolean; /** « coupe 3 sur 5 » of a carnet bought with its dates */ serie?: string };
export type EspaceFigures = { from: string; to: string; performed: number; commission: number; tips: number; done: number; fill: number; avgTicket: number; rebookRate: number };
export type EspaceData = {
  day: string; today: string; now: EspaceNow | null; next: EspaceNext | null; list: EspaceRow[];
  gaps: { start: number; end: number; dur: number }[]; walkins: { waiting: number; mineNext: boolean | null };
  figures: { day: EspaceFigures; week: EspaceFigures; month: EspaceFigures; goal: GoalView | null } | null;
  birthdays: { id: string; name: string; inDays: number; day: string }[]; reviews: { sent: number; opened: number } | null;
  absences: { next: { id: string; from: string; to: string } | null; pending: { id: string; from: string; to: string }[] };
  salon: { goalPct: number | null; fill: number; team?: { id: string; name: string; color: string; done: number; occupancy: number }[] } | null;
};
/** What a card of Mon espace is: `export const meta` and a default component in web/src/comptoir/pages/espace/cards/*.tsx. */
export type EspaceCardMeta = { id: string; title: string; chairOnly?: boolean };
export type NoteTarget = { id: string; name: string; text?: string | null };
/** reload: fetch the page again (after an action); note: open the cut note sheet for an appointment. */
export type EspaceCardProps = { data: EspaceData; reload: () => Promise<void>; note: (t: NoteTarget) => void };

// TEAM-05a: GET /api/v1/cockpit (server/domain/cockpit.js), the owner's Pilotage. `upTo` is the last day read (today while the
// period runs); the previous figures cover the same number of days at the start of the period before.
export type CockpitRange = 'day' | 'week' | 'month';
export type CockpitGoal = { target: number; done: number; pct: number; perDay: number; openDaysLeft: number; week: { from: string; to: string; target: number; done: number }; projection: number | null; pace: { elapsed: number; total: number }; expected: number; monthLabel: string; month: string };
export type CockpitTeamRow = StaffRow & {
  active: boolean; photo: number | null; goalPct: number | null; goal: { target: number; done: number; auto: boolean; perDay: number; openDaysLeft: number } | null;
  week: { from: string; to: string; minutes: number; off: { id: string; from: string; to: string; status: 'approved' | 'pending' }[] };
};
export type CockpitEquity = { staffId: string; kind: 'new' | 'walkin' | 'any' | 'idle'; text: string };
export type CockpitCash = {
  drawer: 'open' | 'counted' | 'none'; lastDiff: number | null; unpaid: number; z: 'done' | 'due' | 'missed' | 'none'; missedDay: string | null;
  closesAt: number | null; remaining: number; warnings: string[];
};
/** What the deltas compare, like for like (compareOf, server/domain/cockpit.js): a null side means no delta is shown. */
export type CockpitCompare = { cur: { from: string; to: string } | null; prev: { from: string; to: string } | null; curDays: number; prevDays: number; soft: boolean; words: string };
export type CockpitSide = { cashed: number; performed: number; fill: number; clients: number; newClients: number; noShows: number; noShowRate: number; avgTicket: number; rebookRate: number; returned60: number; tips: number; discounts: number; refunds: number; lost: number };
/** Today before it happens: minutes worked, booked and still free to sell, per chair; gap: his longest free stretch (an hour or more). */
export type CockpitToday = {
  day: string; open: boolean; opensAt: number | null; closesAt: number | null; started: boolean; over: boolean;
  count: number; planned: number; left: number; expected: number; firstAt: number | null; capMin: number; bookedMin: number; fill: number; freeMin: number;
  chairs: { id: string; name: string; color: string; capMin: number; bookedMin: number; fill: number; count: number; freeMin: number; gap: [number, number] | null; off: boolean; away: boolean }[];
};
/** The next seven days: the salon's day by day, and each chair's fill per day (null: he does not work that day). */
export type CockpitAhead = {
  from: string; to: string; capMin: number; bookedMin: number; fill: number; freeMin: number; count: number; planned: number;
  days: { day: string; label: string; open: boolean; capMin: number; bookedMin: number; fill: number; freeMin: number; count: number; planned: number }[];
  chairs: { id: string; name: string; color: string; fill: number; freeMin: number; days: (number | null)[] }[];
};
export type Cockpit = {
  asOf: number;
  range: { kind: CockpitRange; day: string; from: string; to: string; upTo: string; label: string; prevLabel: string; prev: { from: string; to: string }; today: string; live: boolean; partial: boolean; closed: boolean; compare: CockpitCompare };
  kpis: {
    /** value: the revenue (Chiffre d’affaires TTC); takings: the money that came in (the Z's); served: tickets with a cut or a product */
    cashed: { value: number; valueHT: number; prev: number; tickets: number; served: number; prepaidSold: number; takings: number; goal: CockpitGoal | null; series: number[] };
    performed: number; gap: Gap;
    fill: { value: number; prev: number; chairs: { id: string; name: string; color: string; value: number }[] };
    clients: { total: number; new: number; returning: number };
    noShows: { count: number; rate: number; lost: number };
    lateCancels: number; avgTicket: number; rebookRate: number; returned60: number; tips: number; discounts: number; refunds: number;
    outstanding: { giftcards: number; giftcardCount: number; carnets: number; carnetCount: number; cuts: number };
    /** the two sides the deltas read (range.compare); null when nothing compares yet */
    cmp: CockpitSide | null; prev: CockpitSide | null;
  };
  team: CockpitTeamRow[]; cash: CockpitCash; equity: CockpitEquity[]; today: CockpitToday; ahead: CockpitAhead;
};
/** What a tile of Pilotage is: `export const meta` and a default component in web/src/comptoir/pages/pilotage/tiles/*.tsx.
 *  A tile fetches its own route and renders nothing when it answers 403 or 404; from/to are the days read. */
// WP3 · GET /api/v1/home (server/domain/home.js): the Accueil in one read, for every role. Amounts (`amount`, a fact in
// 'eur') only reach someone with report.shop; a barber's `day` is his own chair and his own appointments.
export type HomeMoment = 'avant' | 'pendant' | 'apres' | 'ferme';
/** k: a stable key ('rdv', 'prevus', 'libres', 'encaisse', 'a-venir', 'a-encaisser', 'restants', 'reference', 'pourboires', 'semaine', 'rdv-7j', 'libres-7j'); label: the words to show; v: a count, minutes ('min') or cents ('eur') */
export type HomeFact = { k: string; label: string; v: number; unit?: 'eur' | 'min' | 'pct' };
export type HomeLine = { label: string; facts: HomeFact[]; note?: string };
/** client: first name and initial, as the agenda shows it; services: the short labels, joined; start and dur in minutes */
export type HomeAppt = { id: string; start: number; dur: number; client: string; services: string; staffId: string; status: 'pending' | 'booked' | 'arrived' | 'in_chair' };
export type HomeChairState = 'libre' | 'occupe' | 'absent' | 'ferme';
/** until: the minute of the day this state ends (null: not today, or a client still in the chair past his slot); freeMin: free
 *  minutes from now (0 unless 'libre'); canTake: the services that fit now, in the catalogue's order, 3 at most */
export type HomeChair = { staffId: string; name: string; state: HomeChairState; until: number | null; freeMin: number; canTake: { serviceId: string; short: string }[] };
export type HomeDay = { scope: 'salon' | 'moi'; canSwitch: boolean; appts: HomeAppt[]; more: number; next: HomeAppt | null; chairs: HomeChair[] };
export type HomeCardId = 'z' | 'encaisser' | 'prochain' | 'messages' | 'absence-demande' | 'orphelins' | 'demandes' | 'relances' | 'semaine' | 'echecs' | 'stock' | 'purge' | 'comptable' | 'objectif';
export type HomeCardGroup = 'bloque' | 'attend' | 'rapporte' | 'entretien';
/** to: a path under /comptoir (kind 'go' and 'bulk'); ref: the object a sheet opens on (a time-off id, 'objectif') */
export type HomeAction = { kind: 'go' | 'sheet' | 'bulk'; label: string; to?: string; ref?: string };
export type HomeCard = { id: HomeCardId; group: HomeCardGroup; count: number; amount?: number; title: string; why: string; preview: { id: string; text: string }[]; action: HomeAction; canHide: boolean };
export type Home = { asOf: number; moment: HomeMoment; finDeMois: boolean; line: HomeLine; day: HomeDay; cards: HomeCard[]; quiet: string[] };

export type PilotageTileMeta = { id: string; cap?: string };
export type PilotageTileProps = { from: string; to: string };
