// GraphQL client and small shared helpers.
export async function gql(query, variables = {}) {
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'blend-in' },
    credentials: 'same-origin',
    body: JSON.stringify({ query, variables }),
  });
  let body;
  try { body = await res.json(); } catch { throw new Error(`The server answered ${res.status}. Try again.`); }
  if (body.errors && body.errors.length) throw new Error(body.errors[0].message === 'Unexpected error.' ? 'Something went wrong on our side. Try again in a moment.' : body.errors[0].message);
  return body.data;
}

export const state = { me: null, config: null, cities: [], atlas: null };

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const price = (lvl) => ['Free', '€', '€€', '€€€'][lvl] || 'Free';
export const moodLabel = (m) => m.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

export const ME_FIELDS = `id name email isAdmin interests budget homeCity localSince isRecommender credits passTokens subscriptionUntil hasSubscription unlockedCities moderatorOf { slug name } rewards { tier points nextTier pointsNeeded approved }`;
export const CITY_FIELDS = `id slug name country countryId continent region lat lng zoom isOpen recCount walkCount hasAccess moderators { name }`;
export const REC_FIELDS = `id kind title description personalRating priceLevel category moods bestTime photoUrl location { lat lng } path stops { name description priceLevel lat lng } distanceKm durationMin author { name homeCity localSince } citySlug up down score opacity myVote busy capacity status reviewNote`;

export async function loadAtlas() {
  if (state.atlas) return state.atlas;
  const topo = await (await fetch('/data/countries.json')).json();
  const countries = topojson.feature(topo, topo.objects.countries).features;
  const borders = topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
  state.atlas = { countries, borders };
  return state.atlas;
}

export function busyClass(b) {
  return b === 'quiet' ? 'quiet' : b === 'busy' ? 'busy-1' : b === 'very busy' ? 'very' : '';
}
