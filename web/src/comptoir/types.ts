// Shapes returned by the API (see server/http/views.js).
export type Staff = { id: string; name: string; initials: string; color: string; role: 'owner' | 'manager' | 'desk' | 'barber'; roleLabel: string; chair: boolean; bookable: boolean; active: boolean; order: number; bio: string; instagram: string; photo?: number | null; email?: string; services?: 'all' | string[]; schedule?: Record<string, [number, number][]>; commission?: { service: number; product: number }; hasPwd?: boolean; hasPin?: boolean };
// TEAM-02: one's own Comptoir (server/projections/staffprefs.js); cards/hidden order Mon espace's cards (TEAM-04); cal: the
// calendar feed's generation (0: off); device.personal: one's own linked phone; Staff.photo: the photo's version
export type Prefs = { home: 'auto' | 'espace' | 'agenda' | 'pilotage'; notify: 'mine' | 'all' | 'none'; buzz: boolean; cards: string[]; hidden: string[]; blur: 'auto' | 'on' | 'off'; cal: number; calName: boolean };
export type Me = Staff & { caps: string[]; device: { id: string; name: string; personal?: boolean } | null; session: 'pwd' | 'pin'; prefs: Prefs };
export type Service = { id: string; slug: string | null; name: string; short: string; category: string; price: number; from: boolean; dur: number; buffer: number; online: boolean; deposit: number | null; vat: number; order: number; description: string; includes: string[]; pack: { credits: number; days: number; serviceIds?: string[] } | null; tag?: string; active: boolean };
export type Product = { id: string; name: string; price: number; cost: number; stock: number; low: number; vat: number; sku: string; category: string; active: boolean };
export type Settings = any;
export type Boot = { me: Me; mode: 'demo' | 'production'; today: string; now: number; version: number; cfg: number; settings: Settings; staff: Staff[]; services: Service[]; products: Product[]; providers: { payments: string; paymentsLive: boolean; sms: string | null; store: string }; warnings: string[] };

export type ClientCard = { id: string; first: string; last: string; name: string; phone: string; hasPhone: boolean; badges: string[]; visits: number; lastDay: string | null; sinceLast: number | null; cadence: number | null; spend: number; noShows: number; next: { id: string; day: string; start: number; staffId: string } | null; overdue: boolean; dueIn: number | null; tech: string; sms: boolean; packs: { id: string; name: string; used: number; total: number; expires: string; serviceIds: string[] }[] };
export type ClientFull = ClientCard & { email: string; notes: string; birthday: string; tags: string[]; marketing: boolean; source: string; createdAt: number; erased: boolean };
export type ApptService = { id: string; name: string; price: number; from: boolean; dur: number };
export type Appt = { id: string; code: string; staffId: string; anyStaff: boolean; day: string; start: number; dur: number; services: ApptService[]; price: number; status: 'pending' | 'booked' | 'arrived' | 'in_chair' | 'done' | 'no_show' | 'cancelled'; source: string; note: string; name: string; client: ClientCard | null; deposit: { amount: number; paid: number; paymentId: string | null } | null; saleId: string | null; createdAt: number; statusAt: Record<string, number>; cancel: any; moves: number; demo: boolean; legacy?: boolean };
export type Lane = Staff & { work: [number, number][] };
export type Block = { id: string; staffId: string; day: string; start: number; dur: number; label: string };
export type Hold = { id: string; staffId: string; start: number; dur: number; exp: number; by: string };
export type QueueItem = { id: string; name: string; hasPhone: boolean; serviceId: string; staffId: string; status: 'waiting' | 'called'; at: number; calledAt: number | null };
export type Wait = { id: string; first: string; staffId: string; serviceId: string; from: number; to: number; status: string; offer: any; at: number };
export type Kpis = { total: number; done: number; noShows: number; upcoming: number; revenue: number | null; tips: number | null; planned: number | null; fill: number; scope: 'own' | 'shop' | 'desk' };
export type Agenda = { day: string; lanes: Lane[]; appts: Appt[]; blocks: Block[]; holds: Hold[]; waitlist: Wait[]; queue: QueueItem[]; closed: boolean; closure: any; kpis: Kpis; walkin: { minutes: number | null; queued: number } | null; drawer: { open: boolean; since?: number } };
// staffId: the chair a line is about (a barber's own toasts); null on a line only for the cap it names, which may name
// its subject in aboutStaffId (an absence told to the team holders)
export type FeedItem = { v: number; at: number; by: string; kind: string; title: string; sub: string; apptId?: string; saleId?: string; day?: string; money?: boolean; staffId?: string | null; aboutStaffId?: string };
export type Pulse = { version: number; cfg: number; now: number; today: string; min: number; feed: FeedItem[]; badges: { toPay: number; queue: number; relances: number; waitlist: number; retention?: number } };
export type SaleLine = { kind: 'service' | 'product' | 'giftcard' | 'pack' | 'fee'; ref: string | null; name: string; qty: number; unit: number; discount: number; net: number; staffId: string | null; vat: number; packId: string | null };
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
export type GoalView = { staffId: string | null; month: string; target: number; auto: boolean; done: number; pct: number; perDay: number; openDaysLeft: number; week: { from: string; to: string; target: number; done: number }; days: number; elapsed: number };
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
export type CutNoteView = { id: string; apptId: string; day: string; staff: string; mine: boolean; text: string; edited: boolean };
export type EspaceNext = {
  id: string; start: number; dur: number; name: string; services: string[]; status: EspaceStatus; late: number; paid: boolean; note: string; tech: string;
  client: {
    id: string; name: string; visits: number; withMe: number; firstVisit: boolean; usual: boolean; lastCut: { day: string; staffName: string } | null; cadence: number | null;
    birthdaySoon: { inDays: number; day: string } | null; noShows: number; member: { kind: 'member' | 'carnet'; label: string; used: number; of: number } | null; prefersMe: boolean;
  } | null;
  cutNotes: CutNoteView[]; myNote: string | null; canNote: boolean; lateNotice: { min: number | null; at: number | null } | null;
};
export type EspaceRow = { id: string; start: number; dur: number; name: string; clientId: string | null; services: string[]; status: EspaceStatus; late: number; firstVisit: boolean; paid: boolean; noted: boolean; needsNote: boolean };
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
