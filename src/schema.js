const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { GraphQLError } = require('graphql');
const { createSchema } = require('graphql-yoga');
const { User, City, Rec, Vote, Visit, Plan, Report, Purchase, CityDay, MOODS, BUDGETS } = require('./models');
const algo = require('./algo');
const { walkingRoute } = require('./routing');
const payments = require('./payments');
const { setSession, clearSession } = require('./auth');

const typeDefs = /* GraphQL */ `
  type Query {
    me: User
    config: Config!
    cities: [City!]!
    allCities: [City!]!
    city(slug: String!): City
    cityRecs(slug: String!, plannedHour: String): CityRecs!
    rec(id: ID!): Rec
    popular: [PopularItem!]!
    pass: Pass
    walkingRoute(points: [PointInput!]!): Route!
    moderation(slug: String!): Moderation!
  }

  type Mutation {
    register(email: String!, password: String!, name: String!): User!
    login(email: String!, password: String!): User!
    logout: Boolean!
    updateProfile(name: String, interests: [String!], budget: String): User!
    becomeRecommender(homeCity: String!, localSince: Int!): User!
    buy(kind: String!, citySlug: String): PurchaseResult!
    unlockCity(slug: String!, using: String!): User!
    redeemCreditsForMonth: User!
    vote(recId: ID!, value: Int!): Rec!
    stampVisit(recId: ID!, note: String): Pass!
    addVisit(input: VisitInput!): Pass!
    removeVisit(id: ID!): Pass!
    planVisit(recId: ID!, hour: String!): Rec!
    createRec(input: RecInput!): Rec!
    report(recId: ID!, reason: String!, text: String): Boolean!
    reviewRec(recId: ID!, action: String!, note: String): Rec!
    handleReport(id: ID!, action: String!): Boolean!
    setCapacity(recId: ID!, capacity: Int!): Rec!
    appointModerator(slug: String!, email: String!): City!
    createCity(input: CityInput!): City!
  }

  type Config { paymentsMode: String!, moods: [String!]!, budgets: [String!]!, tileUrl: String!, tileAttribution: String! }

  type User {
    id: ID!
    name: String!
    email: String!
    isAdmin: Boolean!
    interests: [String!]!
    budget: String!
    homeCity: String
    localSince: Int
    isRecommender: Boolean!
    credits: Int!
    passTokens: Int!
    subscriptionUntil: String
    hasSubscription: Boolean!
    unlockedCities: [String!]!
    moderatorOf: [City!]!
    rewards: Rewards!
  }
  type Rewards { tier: String!, points: Float!, nextTier: String, pointsNeeded: Int, approved: Int! }
  type PublicUser { id: ID!, name: String!, homeCity: String, localSince: Int }

  type City {
    id: ID!
    slug: String!
    name: String!
    country: String!
    countryId: String!
    continent: String!
    region: String!
    lat: Float!
    lng: Float!
    zoom: Float!
    isOpen: Boolean!
    recCount: Int!
    walkCount: Int!
    moderators: [PublicUser!]!
    hasAccess: Boolean!
  }

  type Point { lat: Float!, lng: Float! }
  input PointInput { lat: Float!, lng: Float! }
  type Stop { name: String!, description: String!, priceLevel: Int!, lat: Float, lng: Float }
  input StopInput { name: String!, description: String, priceLevel: Int, lat: Float!, lng: Float! }

  type Rec {
    id: ID!
    kind: String!
    title: String!
    description: String!
    personalRating: Int!
    priceLevel: Int!
    category: String!
    moods: [String!]!
    bestTime: String!
    photoUrl: String!
    location: Point!
    path: [[Float!]!]!
    stops: [Stop!]!
    distanceKm: Float!
    durationMin: Int!
    author: PublicUser
    citySlug: String!
    up: Int!
    down: Int!
    score: Float!
    opacity: Float!
    myVote: Int!
    busy: String
    capacity: Int!
    status: String!
    reviewNote: String!
  }
  type CityRecs { city: City!, access: Boolean!, recs: [Rec!]!, preview: Rec }
  type Route { path: [[Float!]!]!, distanceKm: Float!, durationMin: Int!, snapped: Boolean! }
  type Visit { id: ID!, countryId: String!, countryName: String!, cityName: String!, lat: Float, lng: Float, source: String!, date: String!, note: String!, place: String }
  type Pass { visits: [Visit!]!, countries: Int!, cities: Int!, places: Int! }
  type PopularItem { kind: String!, title: String!, meta: String!, citySlug: String! }
  type ReportItem { id: ID!, reason: String!, text: String!, status: String!, recTitle: String!, recId: ID! }
  type Moderation { city: City!, pending: [Rec!]!, reports: [ReportItem!]!, live: [Rec!]!, approvedCount: Int! }
  type PurchaseResult { granted: Boolean!, checkoutUrl: String, mode: String!, me: User }

  input VisitInput { countryId: String!, countryName: String!, cityName: String, lat: Float, lng: Float, date: String, note: String }
  input RecInput {
    citySlug: String!
    kind: String!
    title: String!
    description: String!
    personalRating: Int!
    priceLevel: Int!
    category: String
    moods: [String!]
    bestTime: String
    photoUrl: String
    location: PointInput!
    destination: PointInput
    waypoints: [PointInput!]
    stops: [StopInput!]
  }
  input CityInput { slug: String!, name: String!, country: String!, countryId: String!, continent: String!, region: String!, lat: Float!, lng: Float!, zoom: Float }
`;

/* ---------- helpers ---------- */

const fail = (message) => {
  throw new GraphQLError(message);
};
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

function needUser(ctx) {
  if (!ctx.user) fail('Log in first.');
  return ctx.user;
}
const isModerator = (user, city) => !!user && (user.isAdmin || city.moderators.some((m) => String(m._id || m) === String(user._id)));
function needModerator(ctx, city) {
  const user = needUser(ctx);
  if (!isModerator(user, city)) fail(`Only ${city.name}'s city moderators can do that.`);
  return user;
}
function hasAccess(user, city) {
  if (!user) return false;
  if (isModerator(user, city)) return true;
  if (user.subscriptionUntil && user.subscriptionUntil > new Date()) return true;
  return user.unlockedCities.some((c) => String(c) === String(city._id));
}

// Simple in-memory limiter for login and sign-up attempts.
const attempts = new Map();
function limit(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60e3);
  if (list.length >= 20) fail('Too many attempts. Wait a few minutes and try again.');
  list.push(now);
  attempts.set(ip, list);
}

async function cityStats() {
  // Grouped by city and kind (portable across MongoDB-compatible databases), then merged.
  const rows = await Rec.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: { city: '$city', kind: '$kind' }, n: { $sum: 1 } } }]);
  const map = new Map();
  for (const row of rows) {
    const key = String(row._id.city);
    const s = map.get(key) || { recs: 0, walks: 0 };
    s.recs += row.n;
    if (row._id.kind === 'walk') s.walks += row.n;
    map.set(key, s);
  }
  return map;
}

function cityOut(city, stats, user) {
  const s = stats.get(String(city._id)) || { recs: 0, walks: 0 };
  return {
    id: String(city._id),
    slug: city.slug,
    name: city.name,
    country: city.country,
    countryId: city.countryId,
    continent: city.continent,
    region: city.region,
    lat: city.lat,
    lng: city.lng,
    zoom: city.zoom,
    isOpen: city.moderators.length > 0 && s.recs >= 3,
    recCount: s.recs,
    walkCount: s.walks,
    moderators: (city.moderators || []).filter((m) => m && m.name).map(publicUser),
    hasAccess: hasAccess(user, city),
  };
}

const publicUser = (u) => (u && u._id ? { id: String(u._id), name: u.name, homeCity: u.homeCity || '', localSince: u.localSince || null } : null);

async function loadCity(slug) {
  const city = await City.findOne({ slug: str(slug, 60).toLowerCase() }).populate('moderators', 'name homeCity localSince');
  if (!city) fail('That city does not exist.');
  return city;
}

async function voteTotals(recIds, user) {
  const votes = await Vote.find({ rec: { $in: recIds } });
  const map = new Map();
  for (const v of votes) {
    const k = String(v.rec);
    const t = map.get(k) || { up: 0, down: 0, wUp: 0, wDown: 0, mine: 0 };
    if (v.value > 0) { t.up++; t.wUp += v.weight; } else { t.down++; t.wDown += v.weight; }
    if (user && String(v.user) === String(user._id)) t.mine = v.value;
    map.set(k, t);
  }
  return map;
}

function hourKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) fail('That time is not valid.');
  d.setMinutes(0, 0, 0);
  return d;
}

async function rankRecs(recs, user, citySlug, plannedHour) {
  const totals = await voteTotals(recs.map((r) => r._id), user);
  let loads = new Map();
  if (plannedHour) {
    const hour = hourKey(plannedHour);
    const rows = await Plan.aggregate([{ $match: { rec: { $in: recs.map((r) => r._id) }, hour } }, { $group: { _id: '$rec', n: { $sum: 1 } } }]);
    loads = new Map(rows.map((r) => [String(r._id), r.n]));
  }
  const out = recs.map((r) => {
    const t = totals.get(String(r._id)) || { up: 0, down: 0, wUp: 0, wDown: 0, mine: 0 };
    const W = algo.wilson(t.wUp, t.wDown);
    let S = algo.personalised(W, r, user, false);
    let busy = null;
    if (plannedHour) {
      const c = algo.crowd(loads.get(String(r._id)) || 0, r.capacity);
      S *= c.factor;
      busy = c.label;
    }
    return { r, t, S, busy, votes: t.up + t.down };
  });
  out.sort((a, b) => b.S - a.S || b.votes - a.votes);
  // Exploration: every fifth position shows a recommendation with fewer than 10 votes.
  const fresh = out.filter((x, i) => x.votes < 10 && i >= 4);
  for (let pos = 4; pos < out.length && fresh.length; pos += 5) {
    const item = fresh.shift();
    out.splice(out.indexOf(item), 1);
    out.splice(pos, 0, item);
  }
  const maxS = Math.max(0, ...out.map((x) => x.S));
  return out.map((x) => recOut(x.r, citySlug, { ...x.t, score: x.S, opacity: algo.opacity(x.S, maxS), busy: x.busy }));
}

function recOut(r, citySlug, extra = {}) {
  return {
    id: String(r._id),
    kind: r.kind,
    title: r.title,
    description: r.description,
    personalRating: r.personalRating,
    priceLevel: r.priceLevel,
    category: r.category,
    moods: r.moods || [],
    bestTime: r.bestTime || '',
    photoUrl: r.photoUrl || '',
    location: r.location,
    path: (r.path || []).map((p) => [p.lng, p.lat]),
    stops: r.stops || [],
    distanceKm: r.distanceKm || 0,
    durationMin: r.durationMin || 0,
    author: publicUser(r.author),
    citySlug,
    up: extra.up || 0,
    down: extra.down || 0,
    score: extra.score || 0,
    opacity: extra.opacity == null ? 1 : extra.opacity,
    myVote: extra.mine || 0,
    busy: extra.busy || null,
    capacity: r.capacity,
    status: r.status,
    reviewNote: r.reviewNote || '',
  };
}

async function passFor(user) {
  const visits = await Visit.find({ user: user._id }).sort({ date: -1 }).populate('rec', 'title');
  return {
    visits: visits.map((v) => ({ id: String(v._id), countryId: v.countryId, countryName: v.countryName, cityName: v.cityName || '', lat: v.lat, lng: v.lng, source: v.source, date: v.date.toISOString(), note: v.note || '', place: v.rec ? v.rec.title : null })),
    countries: new Set(visits.map((v) => v.countryId)).size,
    cities: new Set(visits.filter((v) => v.cityName).map((v) => v.countryId + ':' + v.cityName.toLowerCase())).size,
    places: visits.filter((v) => v.rec).length,
  };
}

async function rewardsFor(user) {
  const recs = await Rec.find({ author: user._id, status: 'approved' }, '_id city');
  if (!recs.length) return { tier: 'None yet', points: 0, nextTier: 'Local', pointsNeeded: 0, approved: 0 };
  const since = daysAgo(30);
  const views = await CityDay.aggregate([{ $match: { day: { $gte: since } } }, { $group: { _id: '$city', v: { $sum: '$views' } } }]);
  const viewMap = new Map(views.map((v) => [String(v._id), v.v]));
  const mean = views.length ? views.reduce((s, v) => s + v.v, 0) / views.length : 0;
  const votes = await Vote.find({ rec: { $in: recs.map((r) => r._id) } });
  let points = 0;
  for (const r of recs) {
    const h = algo.halfLife(viewMap.get(String(r.city)) || 0, mean);
    points += algo.recPoints(votes.filter((v) => String(v.rec) === String(r._id)), h);
  }
  const next = algo.nextTier(points);
  return { tier: algo.tierFor(points, recs.length), points: Math.round(points * 10) / 10, nextTier: next && next.name, pointsNeeded: next && next.needs, approved: recs.length };
}

/* ---------- resolvers ---------- */

const resolvers = {
  User: {
    id: (u) => String(u._id),
    isRecommender: (u) => !!(u.homeCity && u.localSince),
    subscriptionUntil: (u) => (u.subscriptionUntil ? u.subscriptionUntil.toISOString() : null),
    hasSubscription: (u) => !!(u.subscriptionUntil && u.subscriptionUntil > new Date()),
    unlockedCities: async (u) => (await City.find({ _id: { $in: u.unlockedCities } }, 'slug')).map((c) => c.slug),
    moderatorOf: async (u, _a, ctx) => {
      const cities = await City.find(u.isAdmin ? {} : { moderators: u._id }).populate('moderators', 'name homeCity localSince');
      const stats = await cityStats();
      return cities.map((c) => cityOut(c, stats, ctx.user));
    },
    rewards: (u) => rewardsFor(u),
  },

  Query: {
    me: (_p, _a, ctx) => ctx.user,
    config: () => ({
      paymentsMode: payments.mode(), moods: MOODS, budgets: BUDGETS,
      tileUrl: process.env.TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      tileAttribution: process.env.TILE_ATTRIBUTION || '&copy; OpenStreetMap contributors',
    }),
    cities: async (_p, _a, ctx) => {
      const [cities, stats] = await Promise.all([City.find().populate('moderators', 'name homeCity localSince'), cityStats()]);
      return cities.map((c) => cityOut(c, stats, ctx.user)).filter((c) => c.isOpen);
    },
    allCities: async (_p, _a, ctx) => {
      const [cities, stats] = await Promise.all([City.find().sort({ name: 1 }).populate('moderators', 'name homeCity localSince'), cityStats()]);
      return cities.map((c) => cityOut(c, stats, ctx.user));
    },
    city: async (_p, { slug }, ctx) => cityOut(await loadCity(slug), await cityStats(), ctx.user),
    cityRecs: async (_p, { slug, plannedHour }, ctx) => {
      const city = await loadCity(slug);
      const stats = await cityStats();
      await CityDay.updateOne({ city: city._id, day: today() }, { $inc: { views: 1 } }, { upsert: true });
      const access = hasAccess(ctx.user, city);
      const recs = await Rec.find({ city: city._id, status: 'approved' }).populate('author', 'name homeCity localSince');
      if (!access) {
        const pick = recs.length ? recs[Math.floor(Math.random() * recs.length)] : null;
        const preview = pick ? (await rankRecs([pick], ctx.user, city.slug, null))[0] : null;
        return { city: cityOut(city, stats, ctx.user), access, recs: [], preview };
      }
      return { city: cityOut(city, stats, ctx.user), access, recs: await rankRecs(recs, ctx.user, city.slug, plannedHour), preview: null };
    },
    rec: async (_p, { id }, ctx) => {
      if (!isId(id)) return null;
      const r = await Rec.findById(id).populate('author', 'name homeCity localSince').populate('city');
      if (!r) return null;
      const own = ctx.user && String(r.author._id) === String(ctx.user._id);
      if (r.status !== 'approved' && !own && !isModerator(ctx.user, r.city)) return null;
      if (r.status === 'approved' && !own && !hasAccess(ctx.user, r.city)) fail('Unlock this city to see the full recommendation.');
      return (await rankRecs([r], ctx.user, r.city.slug, null))[0];
    },
    popular: async () => {
      const since = daysAgo(7);
      const items = [];
      const top = await CityDay.aggregate([{ $match: { day: { $gte: since } } }, { $group: { _id: '$city', p: { $sum: '$purchases' }, v: { $sum: '$views' } } }, { $sort: { p: -1, v: -1 } }, { $limit: 3 }]);
      const stats = await cityStats();
      const cityIds = top.map((t) => t._id);
      const cities = await City.find(cityIds.length ? { _id: { $in: cityIds } } : {}).populate('moderators', 'name');
      for (const c of cities.slice(0, 3)) {
        const out = cityOut(c, stats, null);
        if (out.isOpen) items.push({ kind: 'Bundle', title: c.name, meta: `${out.recCount} recommendations, €2.99`, citySlug: c.slug });
      }
      const voted = await Vote.aggregate([{ $match: { value: 1, createdAt: { $gte: new Date(Date.now() - 30 * 864e5) } } }, { $group: { _id: '$rec', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 2 }]);
      const recs = await Rec.find({ _id: { $in: voted.map((v) => v._id) }, status: 'approved' }).populate('city', 'slug name');
      for (const r of recs) {
        const n = (voted.find((v) => String(v._id) === String(r._id)) || {}).n || 0;
        items.push({ kind: r.kind === 'walk' ? 'Walk' : 'Spot', title: `${r.title}`, meta: `${r.city.name}, ▲ ${n} this month`, citySlug: r.city.slug });
      }
      return items;
    },
    pass: async (_p, _a, ctx) => (ctx.user ? passFor(ctx.user) : null),
    walkingRoute: async (_p, { points }) => walkingRoute(points),
    moderation: async (_p, { slug }, ctx) => {
      const city = await loadCity(slug);
      needModerator(ctx, city);
      const [pending, live, reports, stats] = await Promise.all([
        Rec.find({ city: city._id, status: 'pending' }).sort({ createdAt: 1 }).populate('author', 'name homeCity localSince'),
        Rec.find({ city: city._id, status: 'approved' }).sort({ title: 1 }).populate('author', 'name homeCity localSince'),
        Report.find({ city: city._id, status: 'open' }).sort({ createdAt: -1 }).populate('rec', 'title'),
        cityStats(),
      ]);
      return {
        city: cityOut(city, stats, ctx.user),
        pending: pending.map((r) => recOut(r, city.slug)),
        live: live.map((r) => recOut(r, city.slug)),
        reports: reports.filter((r) => r.rec).map((r) => ({ id: String(r._id), reason: r.reason, text: r.text, status: r.status, recTitle: r.rec.title, recId: String(r.rec._id) })),
        approvedCount: live.length,
      };
    },
  },

  Mutation: {
    register: async (_p, args, ctx) => {
      limit(ctx.req.ip);
      const email = str(args.email, 120).toLowerCase();
      const name = str(args.name, 60);
      if (!name) fail('Add your name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('That email address looks incomplete.');
      if (typeof args.password !== 'string' || args.password.length < 8) fail('Use a password of at least 8 characters.');
      if (await User.exists({ email })) fail('That email already has an account. Log in instead.');
      const user = await User.create({ email, name, passwordHash: await bcrypt.hash(args.password, 11), isAdmin: !!process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.toLowerCase() });
      setSession(ctx.res, user);
      return user;
    },
    login: async (_p, args, ctx) => {
      limit(ctx.req.ip);
      const user = await User.findOne({ email: str(args.email, 120).toLowerCase() });
      if (!user || !(await bcrypt.compare(String(args.password || ''), user.passwordHash))) fail('Email or password is wrong.');
      if (process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL.toLowerCase() && !user.isAdmin) {
        user.isAdmin = true;
        await user.save();
      }
      setSession(ctx.res, user);
      return user;
    },
    logout: (_p, _a, ctx) => {
      clearSession(ctx.res);
      return true;
    },
    updateProfile: async (_p, args, ctx) => {
      const user = needUser(ctx);
      if (args.name != null) {
        const name = str(args.name, 60);
        if (!name) fail('Add your name.');
        user.name = name;
      }
      if (args.interests) user.interests = [...new Set(args.interests.filter((m) => MOODS.includes(m)))];
      if (args.budget != null) {
        if (!BUDGETS.includes(args.budget)) fail('Pick a budget: free, low, medium or high.');
        user.budget = args.budget;
      }
      await user.save();
      return user;
    },
    becomeRecommender: async (_p, { homeCity, localSince }, ctx) => {
      const user = needUser(ctx);
      const city = str(homeCity, 60);
      if (!city) fail('Add the city you are a local of.');
      if (!(localSince >= 1900 && localSince <= new Date().getFullYear())) fail('Add the year you became a local there.');
      user.homeCity = city;
      user.localSince = localSince;
      await user.save();
      return user;
    },
    buy: async (_p, { kind, citySlug }, ctx) => {
      const user = needUser(ctx);
      const city = citySlug ? await loadCity(citySlug) : null;
      const origin = `${ctx.req.protocol}://${ctx.req.get('host')}`;
      const result = await payments.startPurchase(user, kind, city, origin);
      return { ...result, me: await User.findById(user._id) };
    },
    unlockCity: async (_p, { slug, using }, ctx) => {
      const user = needUser(ctx);
      const city = await loadCity(slug);
      if (hasAccess(user, city)) return user;
      if (using === 'pass') {
        if (user.passTokens < 1) fail('Your trip pass has no cities left.');
        user.passTokens -= 1;
      } else if (using === 'credit') {
        if (user.credits < 1) fail('You have no credits yet. Each approved recommendation earns one.');
        user.credits -= 1;
      } else fail('Choose a trip pass city or a credit.');
      user.unlockedCities.addToSet(city._id);
      await user.save();
      return user;
    },
    redeemCreditsForMonth: async (_p, _a, ctx) => {
      const user = needUser(ctx);
      if (user.credits < 3) fail('A month of the subscription costs 3 credits.');
      user.credits -= 3;
      const base = user.subscriptionUntil && user.subscriptionUntil > new Date() ? new Date(user.subscriptionUntil) : new Date();
      base.setMonth(base.getMonth() + 1);
      user.subscriptionUntil = base;
      await user.save();
      return user;
    },
    vote: async (_p, { recId, value }, ctx) => {
      const user = needUser(ctx);
      if (!isId(recId) || ![1, -1, 0].includes(value)) fail('That vote is not valid.');
      const r = await Rec.findById(recId).populate('city').populate('author', 'name homeCity localSince');
      if (!r || r.status !== 'approved') fail('That recommendation is not available.');
      if (!hasAccess(user, r.city)) fail('Unlock this city to vote on its recommendations.');
      if (String(r.author._id) === String(user._id)) fail('You cannot vote on your own recommendation.');
      if (value === 0) await Vote.deleteOne({ user: user._id, rec: r._id });
      else {
        const weight = Date.now() - user.createdAt.getTime() < 30 * 864e5 ? 0.5 : 1;
        await Vote.updateOne({ user: user._id, rec: r._id }, { $set: { value, weight } }, { upsert: true });
      }
      return (await rankRecs([r], user, r.city.slug, null))[0];
    },
    stampVisit: async (_p, { recId, note }, ctx) => {
      const user = needUser(ctx);
      if (!isId(recId)) fail('That place does not exist.');
      const r = await Rec.findById(recId).populate('city');
      if (!r || r.status !== 'approved') fail('That place does not exist.');
      if (!hasAccess(user, r.city)) fail('Unlock this city first.');
      if (!(await Visit.exists({ user: user._id, rec: r._id }))) {
        await Visit.create({ user: user._id, countryId: r.city.countryId, countryName: r.city.country, cityName: r.city.name, city: r.city._id, rec: r._id, lat: r.location.lat, lng: r.location.lng, source: 'stamp', note: str(note, 280) });
      }
      return passFor(user);
    },
    addVisit: async (_p, { input }, ctx) => {
      const user = needUser(ctx);
      const countryId = str(input.countryId, 8);
      const countryName = str(input.countryName, 80);
      if (!countryId || !countryName) fail('Pick a country.');
      const date = input.date ? new Date(input.date) : new Date();
      if (Number.isNaN(date.getTime())) fail('That date is not valid.');
      await Visit.create({ user: user._id, countryId, countryName, cityName: str(input.cityName, 80), lat: input.lat, lng: input.lng, source: 'manual', date, note: str(input.note, 280) });
      return passFor(user);
    },
    removeVisit: async (_p, { id }, ctx) => {
      const user = needUser(ctx);
      if (isId(id)) await Visit.deleteOne({ _id: id, user: user._id });
      return passFor(user);
    },
    planVisit: async (_p, { recId, hour }, ctx) => {
      const user = needUser(ctx);
      if (!isId(recId)) fail('That place does not exist.');
      const r = await Rec.findById(recId).populate('city').populate('author', 'name homeCity localSince');
      if (!r || !hasAccess(user, r.city)) fail('Unlock this city first.');
      const h = hourKey(hour);
      await Plan.updateOne({ user: user._id, rec: r._id, hour: h }, { $setOnInsert: { user: user._id, rec: r._id, hour: h } }, { upsert: true });
      return (await rankRecs([r], user, r.city.slug, hour))[0];
    },
    createRec: async (_p, { input }, ctx) => {
      const user = needUser(ctx);
      if (!user.homeCity || !user.localSince) fail('Set up your local profile first: your city and since when you have lived there.');
      const city = await loadCity(input.citySlug);
      const kind = input.kind;
      if (!['spot', 'walk'].includes(kind)) fail('Choose a spot or a walk.');
      const title = str(input.title, 90);
      const description = str(input.description, 2000);
      if (!title) fail('Give it a title.');
      if (description.length < 20) fail('Describe it in a couple of sentences at least.');
      if (!(input.personalRating >= 1 && input.personalRating <= 5)) fail('Give it your own rating from 1 to 5.');
      if (!(input.priceLevel >= 0 && input.priceLevel <= 3)) fail('Pick a price.');
      const near = (p) => p && Math.abs(p.lat - city.lat) < 0.5 && Math.abs(p.lng - city.lng) < 0.8;
      if (!near(input.location)) fail(`Place the pin inside ${city.name}.`);
      const photo = str(input.photoUrl, 500);
      if (photo && !/^https:\/\/\S+$/i.test(photo)) fail('Photo links must start with https://');
      const doc = {
        city: city._id, author: user._id, kind, title, description,
        personalRating: Math.round(input.personalRating), priceLevel: Math.round(input.priceLevel),
        category: str(input.category, 40) || (kind === 'walk' ? 'walk' : 'sightseeing'),
        moods: (input.moods || []).filter((m) => MOODS.includes(m)).slice(0, 3),
        bestTime: str(input.bestTime, 60), photoUrl: photo, location: input.location,
      };
      if (kind === 'walk') {
        if (!near(input.destination)) fail(`Place the destination inside ${city.name}.`);
        const waypoints = (input.waypoints || []).filter(near).slice(0, 20);
        const route = await walkingRoute([input.location, ...waypoints, input.destination]);
        Object.assign(doc, { destination: input.destination, waypoints, path: route.path.map(([lng, lat]) => ({ lng, lat })), distanceKm: Math.round(route.distanceKm * 10) / 10, durationMin: route.durationMin });
        doc.stops = (input.stops || []).filter(near).slice(0, 12).map((s) => ({ name: str(s.name, 80), description: str(s.description, 300), priceLevel: Math.max(0, Math.min(3, s.priceLevel || 0)), lat: s.lat, lng: s.lng })).filter((s) => s.name);
      }
      const rec = await Rec.create(doc);
      await rec.populate('author', 'name homeCity localSince');
      return recOut(rec, city.slug);
    },
    report: async (_p, { recId, reason, text }, ctx) => {
      const user = needUser(ctx);
      if (!isId(recId)) fail('That place does not exist.');
      const r = await Rec.findById(recId);
      if (!r) fail('That place does not exist.');
      if (!['closed', 'outdated', 'unsafe', 'discriminatory', 'fake', 'other'].includes(reason)) fail('Pick a reason.');
      await Report.create({ rec: r._id, city: r.city, user: user._id, reason, text: str(text, 500) });
      return true;
    },
    reviewRec: async (_p, { recId, action, note }, ctx) => {
      if (!isId(recId)) fail('That recommendation does not exist.');
      const r = await Rec.findById(recId).populate('author', 'name homeCity localSince');
      if (!r) fail('That recommendation does not exist.');
      const city = await City.findById(r.city);
      const user = needModerator(ctx, city);
      if (String(r.author._id) === String(user._id)) fail('Another moderator has to review your own recommendations.');
      const next = { approve: 'approved', changes: 'changes', reject: 'rejected', hide: 'hidden' }[action];
      if (!next) fail('Choose approve, changes, reject or hide.');
      const firstApproval = next === 'approved' && !r.credited;
      r.status = next;
      r.reviewNote = str(note, 300);
      if (firstApproval) r.credited = true;
      await r.save();
      if (firstApproval) await User.updateOne({ _id: r.author._id }, { $inc: { credits: 1 } });
      return recOut(r, city.slug);
    },
    handleReport: async (_p, { id, action }, ctx) => {
      if (!isId(id)) fail('That report does not exist.');
      const report = await Report.findById(id);
      if (!report) fail('That report does not exist.');
      const city = await City.findById(report.city);
      needModerator(ctx, city);
      const status = { hide: 'hidden', dismiss: 'dismissed', escalate: 'escalated' }[action];
      if (!status) fail('Choose hide, dismiss or escalate.');
      report.status = status;
      await report.save();
      if (status === 'hidden') await Rec.updateOne({ _id: report.rec }, { $set: { status: 'hidden' } });
      return true;
    },
    setCapacity: async (_p, { recId, capacity }, ctx) => {
      if (!isId(recId)) fail('That place does not exist.');
      const r = await Rec.findById(recId).populate('author', 'name homeCity localSince');
      if (!r) fail('That place does not exist.');
      const city = await City.findById(r.city);
      needModerator(ctx, city);
      if (!(capacity >= 1 && capacity <= 5000)) fail('Capacity must be between 1 and 5000 visitors an hour.');
      r.capacity = capacity;
      await r.save();
      return recOut(r, city.slug);
    },
    appointModerator: async (_p, { slug, email }, ctx) => {
      const user = needUser(ctx);
      if (!user.isAdmin) fail('Only admins can appoint city moderators.');
      const city = await loadCity(slug);
      const mod = await User.findOne({ email: str(email, 120).toLowerCase() });
      if (!mod) fail('No account uses that email yet. Ask them to sign up first.');
      await City.updateOne({ _id: city._id }, { $addToSet: { moderators: mod._id } });
      return cityOut(await loadCity(slug), await cityStats(), user);
    },
    createCity: async (_p, { input }, ctx) => {
      const user = needUser(ctx);
      if (!user.isAdmin) fail('Only admins can add cities.');
      const slug = str(input.slug, 60).toLowerCase();
      if (!/^[a-z0-9-]+$/.test(slug)) fail('Use lowercase letters, numbers and dashes for the address.');
      if (await City.exists({ slug })) fail('A city with that address already exists.');
      const city = await City.create({ ...input, slug, zoom: input.zoom || 14 });
      return cityOut(await City.findById(city._id).populate('moderators', 'name'), await cityStats(), user);
    },
  },
};

module.exports = { schema: createSchema({ typeDefs, resolvers }) };
