// Demo content for the Dutch launch (Nijmegen first, then the largest Dutch cities).
// Seed accounts get random passwords, so nobody can log into them.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { User, City, Rec, Vote, Visit, Plan, Report, CityDay } = require('./models');

const DOMAIN = 'seed.blendin.invalid';
const NL = { country: 'Netherlands', countryId: '528', continent: 'Europe' };

const cities = [
  { slug: 'nijmegen', name: 'Nijmegen', region: 'Gelderland', lat: 51.8426, lng: 5.8528, zoom: 15 },
  { slug: 'amsterdam', name: 'Amsterdam', region: 'Noord-Holland', lat: 52.3728, lng: 4.8936, zoom: 14 },
  { slug: 'rotterdam', name: 'Rotterdam', region: 'Zuid-Holland', lat: 51.9225, lng: 4.4792, zoom: 14 },
  { slug: 'the-hague', name: 'The Hague', region: 'Zuid-Holland', lat: 52.0705, lng: 4.3007, zoom: 13 },
  { slug: 'utrecht', name: 'Utrecht', region: 'Utrecht', lat: 52.0907, lng: 5.1214, zoom: 15 },
  { slug: 'eindhoven', name: 'Eindhoven', region: 'Noord-Brabant', lat: 51.4416, lng: 5.4697, zoom: 14 },
];

const people = [
  { key: 'sanne', name: 'Sanne de Vries', homeCity: 'Nijmegen', localSince: 2004, moderates: 'nijmegen' },
  { key: 'thomas', name: 'Thomas Hendriks', homeCity: 'Nijmegen', localSince: 2012 },
  { key: 'daan', name: 'Daan Visser', homeCity: 'Amsterdam', localSince: 1999, moderates: 'amsterdam' },
  { key: 'yara', name: 'Yara Bakker', homeCity: 'Rotterdam', localSince: 2010, moderates: 'rotterdam' },
  { key: 'femke', name: 'Femke Jansen', homeCity: 'The Hague', localSince: 2007, moderates: 'the-hague' },
  { key: 'ruben', name: 'Ruben de Wit', homeCity: 'Utrecht', localSince: 2003, moderates: 'utrecht' },
  { key: 'milan', name: 'Milan Peters', homeCity: 'Eindhoven', localSince: 2015, moderates: 'eindhoven' },
];

const P = (lat, lng) => ({ lat, lng });
const recs = [
  // Nijmegen
  { city: 'nijmegen', by: 'sanne', kind: 'walk', title: 'Waalkade to the Valkhof at sunset', description: 'Start on the riverfront of the oldest city in the Netherlands, climb into the Valkhofpark for the view from the lookout tower, then wind down through the old town to finish on Lange Hezelstraat.', personalRating: 5, priceLevel: 0, moods: ['golden-hour', 'by-the-water', 'hidden-history'], bestTime: 'The hour before sunset',
    stops: [['Waalkade', 'River promenade; start here with the bridge ahead.', 0, 51.8492, 5.8668], ['Belvédère, Valkhofpark', 'Lookout tower over the Waal.', 1, 51.8478, 5.8722], ['Grote Markt', 'The old market square below the Stevenskerk.', 0, 51.8469, 5.8636], ['Lange Hezelstraat', 'Old shopping street with small shops and places to eat.', 1, 51.8463, 5.8590]] },
  { city: 'nijmegen', by: 'thomas', kind: 'walk', title: 'Kronenburgerpark and the old city wall', description: 'A short loop around one of the last towers of the medieval wall, through the quietest park in the centre, and back along what is left of the fortifications.', personalRating: 4, priceLevel: 0, moods: ['green-escapes', 'hidden-history'], bestTime: 'Weekday mornings',
    stops: [['Kronenburgerpark', 'Park built around a tower of the city wall.', 0, 51.8487, 5.8547], ['Old city wall', 'Follow the line of the walls back to the centre.', 0, 51.8470, 5.8575]] },
  { city: 'nijmegen', by: 'sanne', kind: 'walk', title: 'Across the Waalbrug to the Spiegelwaal', description: 'Cross the arch bridge on foot for the best view back at the old town, then loop around the island made when the river was widened. Beaches in summer, wind in winter.', personalRating: 4, priceLevel: 0, moods: ['by-the-water', 'green-escapes'], bestTime: 'Late afternoon',
    stops: [['Waalbrug', 'Walk over the arch bridge.', 0, 51.8517, 5.8715], ['Spiegelwaal', 'The new river channel and its island.', 0, 51.8560, 5.8620]] },
  { city: 'nijmegen', by: 'thomas', kind: 'spot', title: 'Museum Het Valkhof', description: 'Roman Nijmegen in one building, from helmets to coins found in the river. Go early on a weekday and you will have the Roman rooms to yourself.', personalRating: 4, priceLevel: 2, moods: ['hidden-history', 'art-making'], bestTime: 'Weekday mornings', at: [51.8466, 5.8705] },
  { city: 'nijmegen', by: 'thomas', kind: 'spot', title: 'Up the Stevenskerk tower', description: 'Climb the tower of the big church on the Grote Markt for a view over the river and the roofs of the old town.', personalRating: 4, priceLevel: 1, moods: ['hidden-history'], bestTime: 'Clear afternoons', at: [51.8477, 5.8650] },
  { city: 'nijmegen', by: 'sanne', kind: 'spot', title: 'Lunch on the Molenstraat', description: 'The street where Nijmegen students actually eat: cheap lunches, good bakeries and terraces that catch the midday sun.', personalRating: 4, priceLevel: 1, moods: ['good-food'], bestTime: 'Lunch', at: [51.8445, 5.8620] },
  // Amsterdam
  { city: 'amsterdam', by: 'daan', kind: 'spot', title: 'Noordermarkt on a Saturday morning', description: 'Organic market stalls, apple pie from the corner café, and the Jordaan before the crowds arrive.', personalRating: 5, priceLevel: 1, moods: ['slow-mornings', 'good-food'], bestTime: 'Saturday before 10am', at: [52.3788, 4.8865] },
  { city: 'amsterdam', by: 'daan', kind: 'spot', title: 'The free ferry to NDSM', description: 'Take the free ferry behind Centraal Station to the old shipyard: street art, a flea market some weekends, and the best skyline view back at the city.', personalRating: 5, priceLevel: 0, moods: ['by-the-water', 'art-making'], bestTime: 'Sunset', at: [52.4010, 4.8930] },
  { city: 'amsterdam', by: 'daan', kind: 'spot', title: 'Vondelpark early, before the bikes', description: 'Walk the park while the city is still waking up. Bring coffee and claim a bench by the pond.', personalRating: 4, priceLevel: 0, moods: ['green-escapes', 'slow-mornings'], bestTime: 'Before 8am', at: [52.3580, 4.8686] },
  // Rotterdam
  { city: 'rotterdam', by: 'yara', kind: 'spot', title: 'Markthal, then the old harbour', description: 'Graze under the painted arch of the Markthal, then walk five minutes to sit by the boats in the Oude Haven.', personalRating: 4, priceLevel: 1, moods: ['good-food', 'by-the-water'], bestTime: 'Late morning', at: [51.9200, 4.4866] },
  { city: 'rotterdam', by: 'yara', kind: 'spot', title: 'Erasmusbrug at golden hour', description: 'Walk onto the bridge as the sun drops behind the harbour cranes. Locals call it the Swan.', personalRating: 5, priceLevel: 0, moods: ['golden-hour', 'by-the-water'], bestTime: 'Sunset', at: [51.9094, 4.4868] },
  { city: 'rotterdam', by: 'yara', kind: 'spot', title: 'Het Park below the Euromast', description: 'English-style park with a pond and a tea house, right next to the tower most visitors queue for.', personalRating: 4, priceLevel: 0, moods: ['green-escapes'], bestTime: 'Sunny afternoons', at: [51.9054, 4.4666] },
  // The Hague
  { city: 'the-hague', by: 'femke', kind: 'spot', title: 'Scheveningen pier at sunset, then fish on the boulevard', description: 'Walk out over the North Sea, then eat fried fish from a stall on the boulevard while the sun goes down.', personalRating: 5, priceLevel: 1, moods: ['by-the-water', 'golden-hour', 'good-food'], bestTime: 'Sunset', at: [52.1146, 4.2795] },
  { city: 'the-hague', by: 'femke', kind: 'spot', title: 'Around the Hofvijver', description: 'The pond in front of the parliament buildings, where locals sit on the edge at lunch.', personalRating: 4, priceLevel: 0, moods: ['hidden-history', 'by-the-water'], bestTime: 'Lunch', at: [52.0799, 4.3133] },
  { city: 'the-hague', by: 'femke', kind: 'spot', title: 'The Haagse Markt', description: 'One of the biggest open-air markets in Europe: spices, fabric and snacks from everywhere.', personalRating: 4, priceLevel: 1, moods: ['good-food'], bestTime: 'Saturday morning', at: [52.0640, 4.2960] },
  // Utrecht
  { city: 'utrecht', by: 'ruben', kind: 'spot', title: 'The wharf cellars along the Oudegracht', description: 'Take the steps down to the water-level wharves and have coffee in a cellar that used to store goods off the boats.', personalRating: 5, priceLevel: 1, moods: ['by-the-water', 'hidden-history'], bestTime: 'Weekday afternoons', at: [52.0900, 5.1200] },
  { city: 'utrecht', by: 'ruben', kind: 'spot', title: 'Dom tower climb', description: 'The tallest church tower in the country. Book the guided climb and look out over the whole province.', personalRating: 4, priceLevel: 2, moods: ['hidden-history'], bestTime: 'Clear mornings', at: [52.0907, 5.1214] },
  { city: 'utrecht', by: 'ruben', kind: 'spot', title: 'Griftpark on a summer evening', description: 'Former gasworks turned park, with locals grilling and playing football until dark.', personalRating: 4, priceLevel: 0, moods: ['green-escapes', 'late-nights'], bestTime: 'Summer evenings', at: [52.0985, 5.1240] },
  // Eindhoven
  { city: 'eindhoven', by: 'milan', kind: 'spot', title: 'Strijp-S on a Sunday', description: 'Old Philips factory district with design shops, a food hall and climbing walls in the old halls.', personalRating: 4, priceLevel: 1, moods: ['art-making', 'good-food'], bestTime: 'Sunday afternoon', at: [51.4486, 5.4560] },
  { city: 'eindhoven', by: 'milan', kind: 'spot', title: 'Van Abbemuseum', description: 'Modern art in a building that is half old brick, half grey tower. Quiet on weekday mornings.', personalRating: 4, priceLevel: 2, moods: ['art-making'], bestTime: 'Weekday mornings', at: [51.4344, 5.4818] },
  { city: 'eindhoven', by: 'milan', kind: 'spot', title: 'Genneper Parken by bike', description: 'Rent a bike and follow the river Dommel south into the parks, past a watermill and farm cafés.', personalRating: 4, priceLevel: 0, moods: ['green-escapes'], bestTime: 'Weekend mornings', at: [51.4130, 5.4730] },
];

async function makeUser(p) {
  return User.create({ email: `${p.key}@${DOMAIN}`, name: p.name, passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 8), homeCity: p.homeCity, localSince: p.localSince });
}

async function removeSeed() {
  const users = await User.find({ email: new RegExp(`@${DOMAIN.replace(/\./g, '\\.')}$`) }, '_id');
  const ids = users.map((u) => u._id);
  const recIds = (await Rec.find({ author: { $in: ids } }, '_id')).map((r) => r._id);
  await Promise.all([
    Vote.deleteMany({ $or: [{ user: { $in: ids } }, { rec: { $in: recIds } }] }),
    Plan.deleteMany({ rec: { $in: recIds } }),
    Report.deleteMany({ rec: { $in: recIds } }),
    Visit.deleteMany({ rec: { $in: recIds } }),
  ]);
  await Rec.deleteMany({ _id: { $in: recIds } });
  await City.updateMany({}, { $pull: { moderators: { $in: ids } } });
  await User.deleteMany({ _id: { $in: ids } });
}

async function seed() {
  const cityBySlug = {};
  for (const c of cities) {
    cityBySlug[c.slug] = (await City.findOne({ slug: c.slug })) || (await City.create({ ...NL, ...c }));
  }
  const userByKey = {};
  for (const p of people) {
    userByKey[p.key] = await makeUser(p);
    if (p.moderates) await City.updateOne({ slug: p.moderates }, { $addToSet: { moderators: userByKey[p.key]._id } });
  }
  const voters = [];
  for (let i = 0; i < 12; i++) voters.push(await makeUser({ key: `voter${i}`, name: `Traveller ${i + 1}` }));

  let n = 0;
  for (const r of recs) {
    const city = cityBySlug[r.city];
    const doc = { city: city._id, author: userByKey[r.by]._id, kind: r.kind, title: r.title, description: r.description, personalRating: r.personalRating, priceLevel: r.priceLevel, moods: r.moods, bestTime: r.bestTime, status: 'approved', credited: true };
    if (r.kind === 'walk') {
      const stops = r.stops.map(([name, description, priceLevel, lat, lng]) => ({ name, description, priceLevel, lat, lng }));
      Object.assign(doc, { category: 'walk', stops, location: P(stops[0].lat, stops[0].lng), destination: P(stops[stops.length - 1].lat, stops[stops.length - 1].lng), path: stops.map((s) => ({ lat: s.lat, lng: s.lng })), distanceKm: 1.5 + stops.length * 0.3, durationMin: 30 + stops.length * 15 });
    } else {
      Object.assign(doc, { category: 'sightseeing', location: P(r.at[0], r.at[1]) });
    }
    const rec = await Rec.create(doc);
    // Upvotes fall with list position so each city has a clear ranking.
    const ups = Math.max(2, 12 - (n % 6) * 2);
    for (let i = 0; i < voters.length; i++) {
      if (i < ups) await Vote.create({ user: voters[i]._id, rec: rec._id, value: 1 });
      else if (i === ups && n % 3 === 0) await Vote.create({ user: voters[i]._id, rec: rec._id, value: -1 });
    }
    n++;
  }
  return recs.length;
}

async function seedIfEmpty() {
  if (process.env.SEED_DEMO === 'false') return;
  if (await City.estimatedDocumentCount()) return;
  const count = await seed();
  console.log(`[seed] Database was empty: added ${cities.length} cities and ${count} recommendations. Set SEED_DEMO=false to skip.`);
}

module.exports = { seed, seedIfEmpty, removeSeed };

if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');
  (async () => {
    if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI first (see .env.example).');
    await mongoose.connect(process.env.MONGODB_URI);
    await removeSeed();
    if (process.argv.includes('--remove')) console.log('[seed] Removed demo accounts and their recommendations.');
    else console.log(`[seed] Added ${await seed()} recommendations.`);
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
