const mongoose = require('mongoose');
const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

const MOODS = ['slow-mornings', 'golden-hour', 'hidden-history', 'good-food', 'green-escapes', 'by-the-water', 'art-making', 'live-music', 'late-nights'];
const BUDGETS = ['free', 'low', 'medium', 'high'];

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    passwordHash: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    interests: [{ type: String, enum: MOODS }],
    budget: { type: String, enum: BUDGETS, default: 'medium' },
    // Recommender (passive guide) profile
    homeCity: { type: String, trim: true, maxlength: 60, default: '' },
    localSince: { type: Number, min: 1900, max: 2100 },
    // Access and rewards
    unlockedCities: [{ type: ObjectId, ref: 'City' }],
    passTokens: { type: Number, default: 0 }, // from trip passes: each unlocks one city
    credits: { type: Number, default: 0 }, // from approved recommendations
    subscriptionUntil: { type: Date },
    stripeCustomerId: { type: String },
  },
  { timestamps: true }
);

const citySchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    countryId: { type: String, required: true }, // ISO 3166-1 numeric, matches world-atlas ids
    continent: { type: String, required: true },
    region: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    zoom: { type: Number, default: 14 },
    moderators: [{ type: ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

const pointSchema = new Schema({ lat: Number, lng: Number }, { _id: false });
const stopSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    priceLevel: { type: Number, min: 0, max: 3, default: 0 },
    lat: Number,
    lng: Number,
  },
  { _id: false }
);

const recSchema = new Schema(
  {
    city: { type: ObjectId, ref: 'City', required: true, index: true },
    author: { type: ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['spot', 'walk'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 90 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    personalRating: { type: Number, min: 1, max: 5, required: true },
    priceLevel: { type: Number, min: 0, max: 3, default: 0 }, // 0 free, 1 €, 2 €€, 3 €€€
    category: { type: String, trim: true, maxlength: 40, default: 'sightseeing' },
    moods: [{ type: String, enum: MOODS }],
    bestTime: { type: String, trim: true, maxlength: 60, default: '' },
    photoUrl: { type: String, trim: true, maxlength: 500, default: '' },
    location: { type: pointSchema, required: true }, // spot position, or walk start
    destination: { type: pointSchema },
    waypoints: { type: [pointSchema], default: [] },
    path: { type: [pointSchema], default: [] }, // walking route as points (nested arrays are avoided for portability)
    stops: { type: [stopSchema], default: [] },
    distanceKm: { type: Number, default: 0 },
    durationMin: { type: Number, default: 0 },
    capacity: { type: Number, default: 40, min: 1 }, // K: extra visitors per hour, set by moderators
    status: { type: String, enum: ['pending', 'approved', 'changes', 'rejected', 'hidden'], default: 'pending', index: true },
    reviewNote: { type: String, default: '' },
    credited: { type: Boolean, default: false }, // author already received the approval credit
  },
  { timestamps: true }
);
recSchema.index({ city: 1, status: 1 });

const voteSchema = new Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true },
    rec: { type: ObjectId, ref: 'Rec', required: true, index: true },
    value: { type: Number, enum: [1, -1], required: true },
    weight: { type: Number, default: 1 },
  },
  { timestamps: true }
);
voteSchema.index({ user: 1, rec: 1 }, { unique: true });

// Travel pass entries: a visited country, optionally a city and a place.
const visitSchema = new Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true, index: true },
    countryId: { type: String, required: true },
    countryName: { type: String, required: true },
    cityName: { type: String, default: '' },
    city: { type: ObjectId, ref: 'City' },
    rec: { type: ObjectId, ref: 'Rec' },
    lat: Number,
    lng: Number,
    source: { type: String, enum: ['stamp', 'manual', 'tour'], default: 'manual' },
    date: { type: Date, default: Date.now },
    note: { type: String, trim: true, maxlength: 280, default: '' },
  },
  { timestamps: true }
);

const planSchema = new Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true },
    rec: { type: ObjectId, ref: 'Rec', required: true },
    hour: { type: Date, required: true }, // truncated to the hour
  },
  { timestamps: true }
);
planSchema.index({ rec: 1, hour: 1 });
planSchema.index({ user: 1, rec: 1, hour: 1 }, { unique: true });

const reportSchema = new Schema(
  {
    rec: { type: ObjectId, ref: 'Rec', required: true },
    city: { type: ObjectId, ref: 'City', required: true, index: true },
    user: { type: ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: ['closed', 'outdated', 'unsafe', 'discriminatory', 'fake', 'other'], required: true },
    text: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: ['open', 'hidden', 'dismissed', 'escalated'], default: 'open' },
  },
  { timestamps: true }
);

const purchaseSchema = new Schema(
  {
    user: { type: ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['bundle', 'pass5', 'pass10', 'monthly', 'yearly'], required: true },
    city: { type: ObjectId, ref: 'City' },
    amountCents: { type: Number, required: true },
    provider: { type: String, enum: ['demo', 'stripe'], required: true },
    stripeSessionId: { type: String, index: true },
  },
  { timestamps: true }
);

// Daily counters per city, used for popularity (vote ageing) and the "popular right now" panel.
const cityDaySchema = new Schema({
  city: { type: ObjectId, ref: 'City', required: true },
  day: { type: String, required: true }, // YYYY-MM-DD
  views: { type: Number, default: 0 },
  purchases: { type: Number, default: 0 },
});
cityDaySchema.index({ city: 1, day: 1 }, { unique: true });

module.exports = {
  MOODS,
  BUDGETS,
  User: mongoose.model('User', userSchema),
  City: mongoose.model('City', citySchema),
  Rec: mongoose.model('Rec', recSchema),
  Vote: mongoose.model('Vote', voteSchema),
  Visit: mongoose.model('Visit', visitSchema),
  Plan: mongoose.model('Plan', planSchema),
  Report: mongoose.model('Report', reportSchema),
  Purchase: mongoose.model('Purchase', purchaseSchema),
  CityDay: mongoose.model('CityDay', cityDaySchema),
};
