// Algorithms from the requirements specification ("Ranking and reward algorithm").

const Z = 1.96;
const BUDGET_LEVEL = { free: 0, low: 1, medium: 2, high: 3 };
const TIERS = [
  { name: 'City Ambassador', min: 250 },
  { name: 'Insider', min: 50 },
  { name: 'Local', min: 0 },
];

// Wilson score lower bound of the share of people who would upvote.
function wilson(up, down) {
  const n = up + down;
  if (n <= 0) return 0;
  const p = up / n;
  const z2 = Z * Z;
  return (p + z2 / (2 * n) - Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

// Personalised score S = W * (1 + 0.5 M + 0.3 B + 0.2 T)
function personalised(W, rec, user, open) {
  const moods = rec.moods || [];
  const interests = new Set((user && user.interests) || []);
  const M = moods.length ? moods.filter((m) => interests.has(m)).length / moods.length : 0;
  const B = user ? (rec.priceLevel <= BUDGET_LEVEL[user.budget || 'medium'] ? 1 : 0) : 0;
  const T = open ? 1 : 0;
  return W * (1 + 0.5 * M + 0.3 * B + 0.2 * T);
}

// Crowding: rho = L / K, S' = S * min(1, 1 / rho)
function crowd(load, capacity) {
  const rho = capacity > 0 ? load / capacity : 0;
  const label = rho < 0.7 ? 'quiet' : rho <= 1 ? 'busy' : 'very busy';
  return { rho, factor: Math.min(1, rho > 0 ? 1 / rho : 1), label };
}

// Map emphasis: alpha = 0.15 + 0.85 * S / max S
function opacity(S, maxS) {
  return maxS > 0 ? 0.15 + 0.85 * (S / maxS) : 0.15;
}

// City half-life in months: h = max(3, 24 / (1 + pi)), pi = V_c / mean V
function halfLife(cityViews, meanViews) {
  const pi = meanViews > 0 ? cityViews / meanViews : 1;
  return Math.max(3, 24 / (1 + pi));
}

// Tier points of one recommendation: net weighted votes, fading with age.
function recPoints(votes, h, now = Date.now()) {
  let sum = 0;
  for (const v of votes) {
    const ageMonths = (now - new Date(v.createdAt).getTime()) / (30.44 * 864e5);
    sum += v.value * (v.weight || 1) * Math.pow(2, -ageMonths / h);
  }
  return Math.max(0, sum);
}

function tierFor(points, approvedCount) {
  if (!approvedCount) return 'None yet';
  return TIERS.find((t) => points >= t.min).name;
}

function nextTier(points) {
  if (points < 50) return { name: 'Insider', needs: Math.ceil(50 - points) };
  if (points < 250) return { name: 'City Ambassador', needs: Math.ceil(250 - points) };
  return null;
}

module.exports = { wilson, personalised, crowd, opacity, halfLife, recPoints, tierFor, nextTier, BUDGET_LEVEL };
