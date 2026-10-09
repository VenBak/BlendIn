import { state, esc, $, $$, gql, toast, price, busyClass, REC_FIELDS, CITY_FIELDS } from './api.js';

const nextSaturday18 = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  d.setHours(18, 0, 0, 0);
  return d;
};
const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export async function mountCity(root, slug, { onBuy, onLogin }) {
  root.innerHTML = '<p style="padding:24px">Opening the city…</p>';
  let planned = null;
  let data;
  const load = async () => {
    data = (await gql(`query($s:String!,$h:String){ cityRecs(slug:$s, plannedHour:$h){ access city { ${CITY_FIELDS} } recs { ${REC_FIELDS} } preview { ${REC_FIELDS} } } }`, { s: slug, h: planned ? planned.toISOString() : null })).cityRecs;
  };
  try { await load(); } catch (e) { root.innerHTML = `<div class="paywall"><h1>That city isn't here</h1><p>${esc(e.message)}</p><a class="btn btn-violet" href="#/">Back to the globe</a></div>`; return; }
  const city = data.city;
  document.title = `${city.name} | Blend In`;

  if (!data.access) return paywall(root, data, { onBuy, onLogin });

  root.innerHTML = `
    <div class="app">
      <section class="app-side" aria-label="Recommendations in ${esc(city.name)}">
        <div class="card stack">
          <nav class="crumbs" style="color:var(--muted)"><a href="#/">Globe</a> › ${esc(city.country)} › ${esc(city.region)}</nav>
          <h1>${esc(city.name)}</h1>
          <p style="margin:0;font-size:14px">${data.recs.length} recommendations from locals. Stronger trails are the best match for you.</p>
          <label class="field">Planning to go<input type="datetime-local" id="when" value="${toLocalInput(nextSaturday18())}"></label>
          <div class="actions"><button class="btn btn-small btn-violet" type="button" id="check">Check how busy it will be</button><a class="btn btn-small btn-ghost" href="#/create/${esc(city.slug)}">Add a recommendation</a></div>
        </div>
        <div id="tip"></div>
        <div class="rec-list" id="list"></div>
      </section>
      <section class="app-main" style="position:relative">
        <div class="map" id="map" aria-label="Map of ${esc(city.name)}"></div>
        <div id="detail"></div>
      </section>
    </div>`;

  const map = L.map($('#map', root), { zoomControl: true }).setView([city.lat, city.lng], city.zoom);
  L.tileLayer(state.config.tileUrl, { attribution: state.config.tileAttribution, maxZoom: 19 }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const bubbles = L.layerGroup().addTo(map);
  let selected = null;

  function draw() {
    layer.clearLayers();
    bubbles.clearLayers();
    for (const r of data.recs) {
      const on = selected === r.id;
      const alpha = selected ? (on ? 1 : 0.15) : r.opacity;
      if (r.kind === 'walk' && r.path.length > 1) {
        const line = L.polyline(r.path.map(([lng, lat]) => [lat, lng]), { color: '#5f00ba', weight: on ? 7 : 5, opacity: alpha, dashArray: on ? null : '2 10', lineCap: 'round' });
        line.on('click', () => select(r.id));
        line.addTo(layer);
      }
      const m = L.circleMarker([r.location.lat, r.location.lng], { radius: on ? 10 : 8, color: '#fff', weight: 3, fillColor: on ? '#ceec97' : '#5f00ba', fillOpacity: alpha, opacity: alpha });
      m.on('click', () => select(r.id));
      m.bindTooltip(esc(r.title));
      m.addTo(layer);
    }
    if (selected) {
      const r = data.recs.find((x) => x.id === selected);
      const points = r.kind === 'walk' && r.stops.length ? r.stops.map((s, i) => ({ ...s, n: i + 1 })) : [{ name: r.title, description: r.description.slice(0, 80), priceLevel: r.priceLevel, lat: r.location.lat, lng: r.location.lng, n: 1 }];
      points.forEach((p) => {
        const html = `<div class="bubble" role="button" tabindex="0"><span class="ph" style="${r.photoUrl ? `background-image:url('${esc(r.photoUrl)}')` : ''}">${p.n}</span><span><strong>${esc(p.name)}</strong><span>${esc((p.description || '').slice(0, 70))}</span><b>${price(p.priceLevel)}</b></span></div>`;
        const icon = L.divIcon({ className: 'bubble-icon', html, iconSize: [210, 70], iconAnchor: [105, 86] });
        L.marker([p.lat, p.lng], { icon, keyboard: true, title: p.name }).on('click', () => detail(r)).addTo(bubbles);
      });
    }
    list();
  }

  function list() {
    $('#list', root).innerHTML = data.recs.map((r) => `
      <button type="button" class="rec-item" data-id="${r.id}" aria-pressed="${selected === r.id}">
        <span class="trail-swatch" style="opacity:${r.opacity.toFixed(2)}"></span>
        <span style="display:flex;flex-direction:column;gap:3px;min-width:0"><strong>${esc(r.title)}</strong>
          <span class="meta">${r.kind === 'walk' ? `Walk, ${r.distanceKm} km, ${r.durationMin} min` : 'Spot'}, ${price(r.priceLevel)}, ▲ ${r.up}</span>
          <span style="display:flex;gap:6px;flex-wrap:wrap">${r.busy ? `<span class="busy ${busyClass(r.busy)}">${esc(r.busy[0].toUpperCase() + r.busy.slice(1))}</span>` : ''}<span class="meta" style="color:var(--muted)">Match ${Math.round(r.opacity * 100)}%</span></span>
        </span>
      </button>`).join('') || '<p style="padding:16px;margin:0">No recommendations yet. Add the first one.</p>';
    $$('.rec-item', root).forEach((b) => b.addEventListener('click', () => select(b.dataset.id)));
  }

  function select(id) {
    selected = selected === id ? null : id;
    $('#detail', root).innerHTML = '';
    draw();
    if (selected) {
      const r = data.recs.find((x) => x.id === selected);
      const pts = r.kind === 'walk' && r.path.length > 1 ? r.path.map(([lng, lat]) => [lat, lng]) : [[r.location.lat, r.location.lng]];
      map.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 16 });
    }
  }

  function detail(r) {
    const box = $('#detail', root);
    box.innerHTML = `<div class="detail" role="dialog" aria-label="${esc(r.title)}">
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="chip" style="background:#f3f0ff;color:var(--violet)">${r.kind === 'walk' ? 'Walk' : 'Spot'}</span><button type="button" class="btn btn-small btn-ghost" id="close" aria-label="Close">Close</button></div>
      <div class="photo" style="${r.photoUrl ? `background-image:url('${esc(r.photoUrl)}')` : ''}"></div>
      <h2>${esc(r.title)}</h2>
      <p style="margin:0;font-size:15px;line-height:1.55">${esc(r.description)}</p>
      <div class="pills"><span>${price(r.priceLevel)}</span>${r.kind === 'walk' ? `<span>${r.distanceKm} km</span><span>${r.durationMin} min walking</span>` : ''}${r.bestTime ? `<span>${esc(r.bestTime)}</span>` : ''}<span>Local's rating ${r.personalRating}/5</span>${r.busy ? `<span class="busy ${busyClass(r.busy)}">${esc(r.busy)}</span>` : ''}</div>
      ${r.kind === 'walk' && r.stops.length ? `<ol style="margin:0;padding-left:20px;font-size:14px">${r.stops.map((s) => `<li><strong>${esc(s.name)}</strong> ${esc(s.description)} <em>${price(s.priceLevel)}</em></li>`).join('')}</ol>` : ''}
      <span style="font-size:13px">Recommended by ${esc(r.author ? r.author.name : 'a local')}${r.author && r.author.localSince ? `, local since ${r.author.localSince}` : ''}</span>
      <div class="vote" aria-label="Vote"><button type="button" class="up" aria-pressed="${r.myVote === 1}" data-v="1">▲ ${r.up}</button><button type="button" class="down" aria-pressed="${r.myVote === -1}" data-v="-1">▼ ${r.down}</button></div>
      <label class="field">Been there? Stamp your travel pass<input id="note" maxlength="280" placeholder="What will you remember? (optional)"></label>
      <div class="actions"><button type="button" class="btn btn-violet btn-small" id="stamp">Stamp my travel pass</button><button type="button" class="btn btn-ghost btn-small" id="plan">I'm going at the time above</button></div>
      <details><summary style="cursor:pointer;font-size:14px">Report a problem</summary>
        <div class="stack" style="margin-top:8px"><select id="reason" class="field" style="padding:10px;border:1px solid #c9cce3;border-radius:10px"><option value="closed">Closed</option><option value="outdated">Outdated</option><option value="unsafe">Unsafe</option><option value="discriminatory">Discriminatory</option><option value="fake">Fake or spam</option><option value="other">Something else</option></select>
        <input id="rtext" maxlength="500" placeholder="What is wrong?" style="padding:10px;border:1px solid #c9cce3;border-radius:10px"><button type="button" class="btn btn-small btn-ghost" id="report">Send report</button></div></details>
    </div>`;
    $('#close', box).addEventListener('click', () => (box.innerHTML = ''));
    $$('[data-v]', box).forEach((b) => b.addEventListener('click', async () => {
      const v = +b.dataset.v;
      try {
        const res = (await gql(`mutation($id:ID!,$v:Int!){ vote(recId:$id, value:$v){ up down myVote } }`, { id: r.id, v: r.myVote === v ? 0 : v })).vote;
        Object.assign(r, res);
        detail(r); list();
      } catch (e) { toast(e.message); }
    }));
    $('#stamp', box).addEventListener('click', async () => {
      try {
        await gql(`mutation($id:ID!,$n:String){ stampVisit(recId:$id, note:$n){ places } }`, { id: r.id, n: $('#note', box).value });
        toast('Stamped. It is in your travel pass now.');
      } catch (e) { toast(e.message); }
    });
    $('#plan', box).addEventListener('click', async () => {
      try {
        const when = new Date($('#when', root).value);
        const res = (await gql(`mutation($id:ID!,$h:String!){ planVisit(recId:$id, hour:$h){ busy } }`, { id: r.id, h: when.toISOString() })).planVisit;
        toast(`Added to your plans. Expected: ${res.busy}.`);
      } catch (e) { toast(e.message); }
    });
    $('#report', box).addEventListener('click', async () => {
      try {
        await gql(`mutation($id:ID!,$r:String!,$t:String){ report(recId:$id, reason:$r, text:$t) }`, { id: r.id, r: $('#reason', box).value, t: $('#rtext', box).value });
        toast(`Report sent to ${city.name}'s city moderator`);
      } catch (e) { toast(e.message); }
    });
  }

  $('#check', root).addEventListener('click', async () => {
    planned = new Date($('#when', root).value);
    await load();
    const veryBusy = data.recs.filter((r) => r.busy === 'very busy');
    const quiet = data.recs.find((r) => r.busy === 'quiet');
    $('#tip', root).innerHTML = veryBusy.length ? `<div class="tip"><strong>${esc(veryBusy[0].title)} is expected to be very busy then.</strong> ${quiet ? `Try ${esc(quiet.title)}, which is quiet, or pick another time.` : 'Try another time.'}</div>` : '<div class="tip" style="background:var(--quiet);border-color:#bfe08f">Nothing on the list is expected to be very busy at that time.</div>';
    draw();
  });

  draw();
}

function paywall(root, data, { onBuy, onLogin }) {
  const { city, preview: p } = data;
  root.innerHTML = `<div class="paywall">
    <nav class="crumbs" style="color:var(--muted)"><a href="#/">Globe</a> › ${esc(city.country)} › ${esc(city.region)}</nav>
    <h1 style="margin:0;font-size:40px;color:var(--ink);letter-spacing:-0.03em">${esc(city.name)}</h1>
    <p style="margin:0">${city.recCount} recommendations and ${city.walkCount} walks from locals. City moderator: ${esc(city.moderators.map((m) => m.name).join(', '))}.</p>
    ${p ? `<div class="card stack"><small style="color:var(--muted)">Free preview, picked at random</small><h3 style="margin:0">${esc(p.title)}</h3><p style="margin:0">${esc(p.description)}</p><span style="font-size:14px">${price(p.priceLevel)}, ▲ ${p.up}</span></div>` : ''}
    <div class="price-options">
      <button class="price-opt" type="button" data-k="bundle"><span><strong>${esc(city.name)} bundle</strong><small>One-time, yours to keep, new recommendations included</small></span><strong>€2.99</strong></button>
      <button class="price-opt" type="button" data-k="pass5"><span><strong>Trip pass, 5 cities</strong><small>Pick the cities as you go</small></span><strong>€10</strong></button>
      <button class="price-opt" type="button" data-k="pass10"><span><strong>Trip pass, 10 cities</strong><small>Pick the cities as you go</small></span><strong>€15</strong></button>
      <button class="price-opt" type="button" data-k="monthly"><span><strong>Every city, monthly</strong><small>Cancel any time</small></span><strong>€7.99</strong></button>
      <button class="price-opt" type="button" data-k="yearly"><span><strong>Every city, yearly</strong><small>Cancel any time</small></span><strong>€30</strong></button>
    </div>
    ${state.me && (state.me.passTokens > 0 || state.me.credits > 0) ? `<div class="card stack"><strong>You can unlock ${esc(city.name)} without paying</strong><div class="actions">${state.me.passTokens > 0 ? `<button class="btn btn-violet btn-small" type="button" data-u="pass">Use a trip pass city (${state.me.passTokens} left)</button>` : ''}${state.me.credits > 0 ? `<button class="btn btn-ghost btn-small" type="button" data-u="credit">Use a credit (${state.me.credits})</button>` : ''}</div></div>` : ''}
  </div>`;
  $$('[data-k]', root).forEach((b) => b.addEventListener('click', () => (state.me ? onBuy(b.dataset.k, city.slug) : onLogin())));
  $$('[data-u]', root).forEach((b) => b.addEventListener('click', async () => {
    try {
      await gql(`mutation($s:String!,$u:String!){ unlockCity(slug:$s, using:$u){ id } }`, { s: city.slug, u: b.dataset.u });
      toast(`${city.name} unlocked`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (e) { toast(e.message); }
  }));
}
