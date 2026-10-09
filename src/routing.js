// Walking routes through an OSRM-compatible service (default: the FOSSGIS foot router for OpenStreetMap).
// Set ROUTING_URL to your own OSRM/GraphHopper-compatible endpoint for production traffic.
const ROUTING_URL = process.env.ROUTING_URL || 'https://routing.openstreetmap.de/routed-foot';
const WALK_KMH = 4.8;

function haversineKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function straightLine(points) {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  return { path: points.map((p) => [p.lng, p.lat]), distanceKm: km, durationMin: Math.round((km / WALK_KMH) * 60), snapped: false };
}

async function walkingRoute(points) {
  if (points.length < 2) throw new Error('A route needs a start and a destination.');
  if (points.length > 25) throw new Error('A route can have at most 25 points.');
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  try {
    const res = await fetch(`${ROUTING_URL}/route/v1/foot/${coords}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) throw new Error(`routing ${res.status}`);
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route) throw new Error('no route');
    const km = route.distance / 1000;
    return { path: route.geometry.coordinates, distanceKm: km, durationMin: Math.round((km / WALK_KMH) * 60), snapped: true };
  } catch (err) {
    console.warn('[routing] falling back to straight lines:', err.message);
    return straightLine(points);
  }
}

module.exports = { walkingRoute, haversineKm };
