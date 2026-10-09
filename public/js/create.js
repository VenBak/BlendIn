import { state, esc, $, $$, gql, toast, moodLabel, CITY_FIELDS } from './api.js';

export async function mountCreate(root, slug, { onLogin, refreshMe }) {
  if (!state.me) {
    root.innerHTML = `<div class="paywall"><h1 style="margin:0;color:var(--ink)">Log in to add a recommendation</h1><p style="margin:0">Recommendations come from locals, so we ask who you are first.</p><button class="btn btn-violet" type="button" id="li">Log in or sign up</button></div>`;
    $('#li', root).addEventListener('click', onLogin);
    return;
  }
  if (!state.me.isRecommender) {
    root.innerHTML = `<div class="paywall"><h1 style="margin:0;color:var(--ink)">Tell us where you are a local</h1>
      <p style="margin:0">Your recommendations show your city and how long you have lived there.</p>
      <form class="card stack" id="local"><div class="row2"><label class="field">Your city<input name="city" required maxlength="60"></label><label class="field">Local since<input name="since" type="number" min="1900" max="${new Date().getFullYear()}" required placeholder="e.g. 2014"></label></div>
      <p class="form-error" id="lerr"></p><button class="btn btn-violet" type="submit">Continue</button></form></div>`;
    $('#local', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await gql(`mutation($c:String!,$y:Int!){ becomeRecommender(homeCity:$c, localSince:$y){ id } }`, { c: e.target.city.value, y: +e.target.since.value });
        await refreshMe();
        mountCreate(root, slug, { onLogin, refreshMe });
      } catch (err) { $('#lerr', root).textContent = err.message; }
    });
    return;
  }

  const { allCities } = await gql(`{ allCities { ${CITY_FIELDS} } }`);
  const city = allCities.find((c) => c.slug === slug) || allCities[0];
  const f = { kind: 'walk', rating: 5, moods: new Set(), spot: null, start: null, dest: null, waypoints: [], stops: [], route: null, addingStop: false };

  root.innerHTML = `
    <div class="app">
      <form class="app-side" id="form" novalidate>
        <div class="card stack">
          <h1>Add a recommendation</h1>
          <label class="field">City<select name="city">${allCities.map((c) => `<option value="${c.slug}" ${c.slug === city.slug ? 'selected' : ''}>${esc(c.name)}${c.isOpen ? '' : ' (not open yet)'}</option>`).join('')}</select></label>
          <div class="seg" role="radiogroup" aria-label="What are you adding?"><button type="button" role="radio" data-kind="spot">A spot</button><button type="button" role="radio" data-kind="walk">A walk</button></div>
          <p id="how" style="margin:0;font-size:14px"></p>
          <div class="actions" id="route-tools"></div>
          <div id="route-info" style="font-size:14px"></div>
        </div>
        <div class="card stack">
          <label class="field">Title<input name="title" maxlength="90" required></label>
          <label class="field">Description<textarea name="description" rows="4" maxlength="2000" required placeholder="Why it matters to you, and how to do it."></textarea></label>
          <div class="field">Your rating<div class="stars-input" role="radiogroup" aria-label="Your rating" id="stars"></div></div>
          <div class="row2"><label class="field">Price<select name="price"><option value="0">Free</option><option value="1">€ (under €10)</option><option value="2">€€ (€10 to €25)</option><option value="3">€€€ (over €25)</option></select></label>
          <label class="field">Best time<input name="bestTime" maxlength="60" placeholder="e.g. Before sunset"></label></div>
          <div class="field">Mood (up to 3)<div class="chips" id="moods"></div></div>
          <label class="field">Photo link<input name="photo" maxlength="500" placeholder="https://… (optional)"></label>
          <p class="form-error" id="err"></p>
          <button class="btn btn-violet" type="submit">Send for review</button>
          <small style="color:var(--muted)" id="mods"></small>
        </div>
      </form>
      <section class="app-main"><div class="map" id="map" aria-label="Map for placing your recommendation"></div></section>
    </div>`;

  const map = L.map($('#map', root)).setView([city.lat, city.lng], city.zoom);
  L.tileLayer(state.config.tileUrl, { attribution: state.config.tileAttribution, maxZoom: 19 }).addTo(map);
  const marks = L.layerGroup().addTo(map);
  const form = $('#form', root);

  form.city.addEventListener('change', () => { location.hash = `#/create/${form.city.value}`; });
  $('#mods', root).textContent = city.moderators.length ? `${city.moderators.map((m) => m.name).join(', ')} will review it before it goes live.` : 'This city has no moderator yet; the Blend In team will review it.';

  const pin = (latlng, label, color) => L.circleMarker(latlng, { radius: 11, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).bindTooltip(label, { permanent: true, direction: 'right', offset: [10, 0] });

  function drawMarks() {
    marks.clearLayers();
    if (f.kind === 'spot' && f.spot) pin(f.spot, 'Your spot', '#5f00ba').addTo(marks);
    if (f.kind === 'walk') {
      if (f.route) L.polyline(f.route.path.map(([lng, lat]) => [lat, lng]), { color: '#5f00ba', weight: 6, opacity: 0.9 }).addTo(marks);
      if (f.start) pin(f.start, 'Start', '#5f00ba').addTo(marks);
      if (f.dest) pin(f.dest, 'Destination', '#1d1a2e').addTo(marks);
      f.waypoints.forEach((w, i) => L.circleMarker(w, { radius: 8, color: '#5f00ba', weight: 3, fillColor: '#ceec97', fillOpacity: 1 }).bindTooltip(`Point ${i + 1}: click to remove`).on('click', (e) => { L.DomEvent.stop(e); f.waypoints.splice(i, 1); reroute(); }).addTo(marks));
      f.stops.forEach((s) => L.circleMarker(s.latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#9297c4', fillOpacity: 1 }).bindTooltip(s.name || 'Stop').addTo(marks));
    }
    renderTools();
  }

  function renderTools() {
    const how = $('#how', root);
    const tools = $('#route-tools', root);
    const info = $('#route-info', root);
    $$('[data-kind]', root).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === f.kind)));
    if (f.kind === 'spot') {
      how.textContent = f.spot ? 'Pin placed. Click the map again to move it.' : 'Click the map to place your spot.';
      tools.innerHTML = '';
      info.innerHTML = '';
      return;
    }
    how.textContent = !f.start ? 'Click the map to set the start.' : !f.dest ? 'Now click where the walk ends.' : f.addingStop ? 'Click the map where the stop is.' : 'The route follows the streets. Click the map to add a point it must pass through.';
    tools.innerHTML = `${f.start ? '<button type="button" class="btn btn-small btn-ghost" data-t="undo">Undo last point</button><button type="button" class="btn btn-small btn-ghost" data-t="clear">Start again</button>' : ''}${f.route ? `<button type="button" class="btn btn-small ${f.addingStop ? 'btn-violet' : 'btn-ghost'}" data-t="stop">${f.addingStop ? 'Click the map to place the stop' : 'Add a stop'}</button>` : ''}`;
    info.innerHTML = f.route ? `<strong>${f.route.distanceKm.toFixed(1)} km</strong>, about <strong>${f.route.durationMin} min</strong> walking${f.route.snapped ? '' : ' <em>(straight lines: the route service is unavailable)</em>'}${f.stops.length ? `<ol style="margin:8px 0 0;padding-left:20px">${f.stops.map((s, i) => `<li><input aria-label="Stop name" data-stop="${i}" value="${esc(s.name)}" placeholder="Stop name" style="padding:6px 8px;border:1px solid #c9cce3;border-radius:8px;width:70%"> <button type="button" class="linkish" data-rmstop="${i}">Remove</button></li>`).join('')}</ol>` : ''}` : '';
    $$('[data-t]', tools).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.t === 'clear') Object.assign(f, { start: null, dest: null, waypoints: [], stops: [], route: null });
      if (b.dataset.t === 'undo') { if (f.waypoints.length) f.waypoints.pop(); else if (f.dest) { f.dest = null; f.route = null; } else f.start = null; }
      if (b.dataset.t === 'stop') f.addingStop = !f.addingStop;
      reroute();
    }));
    $$('[data-stop]', info).forEach((i) => i.addEventListener('input', () => { f.stops[+i.dataset.stop].name = i.value; }));
    $$('[data-rmstop]', info).forEach((b) => b.addEventListener('click', () => { f.stops.splice(+b.dataset.rmstop, 1); drawMarks(); }));
  }

  // Insert a new waypoint where it adds the least distance to the route.
  function insertWaypoint(p) {
    const seq = [f.start, ...f.waypoints, f.dest];
    let best = 0, bestCost = Infinity;
    for (let i = 0; i < seq.length - 1; i++) {
      const cost = map.distance(seq[i], p) + map.distance(p, seq[i + 1]) - map.distance(seq[i], seq[i + 1]);
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    f.waypoints.splice(best, 0, p);
  }

  async function reroute() {
    if (f.kind === 'walk' && f.start && f.dest) {
      const pts = [f.start, ...f.waypoints, f.dest].map((p) => ({ lat: p.lat, lng: p.lng }));
      try { f.route = (await gql(`query($p:[PointInput!]!){ walkingRoute(points:$p){ path distanceKm durationMin snapped } }`, { p: pts })).walkingRoute; }
      catch (e) { toast(e.message); }
    } else f.route = null;
    drawMarks();
  }

  map.on('click', (e) => {
    const p = e.latlng;
    if (f.kind === 'spot') f.spot = p;
    else if (!f.start) f.start = p;
    else if (!f.dest) f.dest = p;
    else if (f.addingStop) { f.stops.push({ latlng: p, name: '' }); f.addingStop = false; drawMarks(); return; }
    else insertWaypoint(p);
    reroute();
  });

  $$('[data-kind]', root).forEach((b) => b.addEventListener('click', () => { f.kind = b.dataset.kind; reroute(); }));
  const stars = $('#stars', root);
  const drawStars = () => {
    stars.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${f.rating === n}" aria-label="${n} ${n === 1 ? 'star' : 'stars'}" class="${n <= f.rating ? 'on' : ''}" data-n="${n}">★</button>`).join('');
    $$('[data-n]', stars).forEach((b) => b.addEventListener('click', () => { f.rating = +b.dataset.n; drawStars(); }));
  };
  drawStars();
  const moods = $('#moods', root);
  moods.innerHTML = state.config.moods.map((m) => `<button type="button" data-m="${m}" aria-pressed="false">${esc(moodLabel(m))}</button>`).join('');
  $$('[data-m]', moods).forEach((b) => b.addEventListener('click', () => {
    const m = b.dataset.m;
    if (f.moods.has(m)) f.moods.delete(m);
    else if (f.moods.size < 3) f.moods.add(m);
    else return toast('Pick up to 3 moods.');
    b.setAttribute('aria-pressed', String(f.moods.has(m)));
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#err', root);
    err.textContent = '';
    const location_ = f.kind === 'spot' ? f.spot : f.start;
    if (!location_) { err.textContent = f.kind === 'spot' ? 'Place your spot on the map.' : 'Set a start and a destination on the map.'; return; }
    if (f.kind === 'walk' && !f.dest) { err.textContent = 'Set where the walk ends.'; return; }
    const pt = (p) => ({ lat: p.lat, lng: p.lng });
    const input = {
      citySlug: form.city.value, kind: f.kind, title: form.title.value, description: form.description.value,
      personalRating: f.rating, priceLevel: +form.price.value, bestTime: form.bestTime.value, photoUrl: form.photo.value,
      moods: [...f.moods], location: pt(location_),
      ...(f.kind === 'walk' ? { destination: pt(f.dest), waypoints: f.waypoints.map(pt), stops: f.stops.filter((s) => s.name.trim()).map((s) => ({ name: s.name, lat: s.latlng.lat, lng: s.latlng.lng })) } : {}),
    };
    try {
      await gql(`mutation($i:RecInput!){ createRec(input:$i){ id status } }`, { i: input });
      toast('Sent for review. You will earn a credit when it is approved.');
      location.hash = `#/city/${form.city.value}`;
    } catch (ex) { err.textContent = ex.message; }
  });

  drawMarks();
}
