import { state, esc, $, $$, gql, loadAtlas, toast } from './api.js';

const PASS = `countries cities places visits { id countryId countryName cityName lat lng source date note place }`;

export async function mountPass(root, { onLogin }) {
  root.innerHTML = `
    <section class="pass" id="travel-pass" aria-labelledby="pass-title">
      <div class="pass-inner">
        <h2 id="pass-title">Your travel pass</h2>
        <p class="pass-lede">Every country you have been to is coloured in. Places you stamp on Blend In are added automatically, and you can add earlier trips by hand.</p>
        <div class="pass-stats" id="pass-stats"></div>
        <div class="pass-grid">
          <div class="pass-map"><svg id="pass-svg" role="img" aria-label="World map of the countries you have visited"></svg>
            <div class="pass-legend"><span style="display:flex;gap:6px;margin-right:auto"><button type="button" class="btn btn-small btn-ghost" data-fit="trips" aria-pressed="true">My trips</button><button type="button" class="btn btn-small btn-ghost" data-fit="world" aria-pressed="false">Whole world</button></span><span><span class="swatch" style="background:var(--lime);outline:1px solid var(--violet)"></span>Visited</span><span><span class="swatch" style="background:#e6e8f3"></span>Not yet</span><span><span class="swatch" style="background:var(--violet);border-radius:50%"></span>Cities you have been to</span></div>
          </div>
          <div class="pass-side" id="pass-side"></div>
        </div>
      </div>
    </section>`;

  const atlas = await loadAtlas();
  let pass = null;
  const svgEl = $('#pass-svg', root);
  const width = 960;
  const height = 500;
  svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const proj = d3.geoNaturalEarth1();
  const path = d3.geoPath(proj);
  const svg = d3.select(svgEl);
  const sphere = svg.append('path').attr('class', 'sphere');
  const land = svg.append('g').selectAll('path').data(atlas.countries).join('path').attr('class', 'land');
  let fitMode = 'trips';
  // Zoom to the countries visited (with some context), or show the whole world.
  function fit() {
    proj.fitExtent([[8, 8], [width - 8, height - 8]], { type: 'Sphere' });
    const worldScale = proj.scale();
    const visited = pass ? atlas.countries.filter((f) => pass.visits.some((v) => v.countryId === f.id)) : [];
    if (fitMode === 'trips' && visited.length) {
      proj.fitExtent([[60, 40], [width - 60, height - 40]], { type: 'FeatureCollection', features: visited });
      proj.scale(Math.max(worldScale, Math.min(proj.scale() * 0.85, worldScale * 12)));
      const c = d3.geoCentroid({ type: 'FeatureCollection', features: visited });
      proj.translate([width / 2, height / 2]);
      const [x, y] = proj(c);
      const [tx, ty] = proj.translate();
      proj.translate([tx + width / 2 - x, ty + height / 2 - y]);
    }
    sphere.attr('d', path({ type: 'Sphere' }));
    land.attr('d', path);
  }
  $$('[data-fit]', root).forEach((b) => b.addEventListener('click', () => {
    fitMode = b.dataset.fit;
    $$('[data-fit]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  }));
  land.append('title').text((d) => d.properties.name);
  const dots = svg.append('g');

  const countryOptions = atlas.countries.map((f) => ({ id: f.id, name: f.properties.name })).filter((c) => c.id).sort((a, b) => a.name.localeCompare(b.name));

  function draw() {
    fit();
    const visited = new Set(pass ? pass.visits.map((v) => v.countryId) : []);
    land.classed('visited', (d) => visited.has(d.id));
    const cityPts = new Map();
    for (const v of pass ? pass.visits : []) if (v.cityName && v.lat != null) cityPts.set(v.countryId + v.cityName, v);
    const pts = [...cityPts.values()].map((v) => ({ ...v, xy: proj([v.lng, v.lat]) }));
    const g = dots.selectAll('g').data(pts, (d) => d.countryId + d.cityName).join((e) => { const gg = e.append('g').attr('class', 'vcity'); gg.append('circle').attr('r', 4); gg.append('text').attr('x', 6).attr('dy', '0.35em'); return gg; });
    g.attr('transform', (d) => `translate(${d.xy[0]},${d.xy[1]})`).select('text').text((d) => d.cityName);
    $('#pass-stats', root).innerHTML = pass
      ? `<div><strong>${pass.countries}</strong><span>${pass.countries === 1 ? 'country' : 'countries'}</span></div><div><strong>${pass.cities}</strong><span>${pass.cities === 1 ? 'city' : 'cities'}</span></div><div><strong>${pass.places}</strong><span>places stamped</span></div>`
      : '';
  }

  function side() {
    const box = $('#pass-side', root);
    if (!state.me) {
      box.innerHTML = `<div class="card stack"><h3>Start your travel pass</h3><p style="margin:0">Log in to colour in the countries and cities you have been to.</p><button class="btn btn-violet" type="button" id="pass-login">Log in or sign up</button></div>`;
      $('#pass-login', box).addEventListener('click', onLogin);
      return;
    }
    const byCountry = new Map();
    for (const v of pass.visits) {
      const list = byCountry.get(v.countryName) || [];
      list.push(v);
      byCountry.set(v.countryName, list);
    }
    box.innerHTML = `
      <form class="card stack" id="visit-form">
        <h3>Add a place you have been</h3>
        <label class="field">Country<select name="country" required><option value="">Choose a country</option>${countryOptions.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><small>Tip: click a country on the map.</small></label>
        <div class="row2"><label class="field">City<input name="city" maxlength="80" placeholder="Optional"></label><label class="field">When<input name="date" type="month"></label></div>
        <label class="field">Something to remember<input name="note" maxlength="280" placeholder="Optional"></label>
        <p class="form-error" id="visit-error"></p>
        <button class="btn btn-violet" type="submit">Add to my travel pass</button>
      </form>
      <div class="card"><h3>Where you have been</h3>${byCountry.size ? [...byCountry.entries()].map(([country, list]) => `
        <div class="visit-country"><strong>${esc(country)}</strong>${list.map((v) => `
          <div class="visit-line"><span>${esc(v.cityName || 'Country only')}${v.place ? `: ${esc(v.place)}` : ''}${v.note ? ` <em>“${esc(v.note)}”</em>` : ''}</span>
          <span>${v.source === 'stamp' ? 'Stamped' : `<button type="button" class="linkish" data-rm="${v.id}">Remove</button>`}</span></div>`).join('')}</div>`).join('') : '<p style="margin:0">Nothing yet. Stamp a place in a city bundle, or add a trip above.</p>'}</div>`;
    const form = $('#visit-form', box);
    land.on('click', (e, d) => { form.country.value = d.id; form.city.focus(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const opt = countryOptions.find((c) => c.id === form.country.value);
      if (!opt) { $('#visit-error', box).textContent = 'Choose a country.'; return; }
      // Place a manually added city near the middle of its country so it shows on the map.
      const f = atlas.countries.find((c) => c.id === opt.id);
      const [lng, lat] = d3.geoCentroid(f);
      try {
        const data = await gql(`mutation($i:VisitInput!){ addVisit(input:$i){ ${PASS} } }`, { i: { countryId: opt.id, countryName: opt.name, cityName: form.city.value, lat: form.city.value ? lat : null, lng: form.city.value ? lng : null, date: form.date.value ? `${form.date.value}-01` : null, note: form.note.value } });
        pass = data.addVisit;
        toast(`${opt.name} added to your travel pass`);
        draw(); side();
      } catch (err) { $('#visit-error', box).textContent = err.message; }
    });
    $$('[data-rm]', box).forEach((b) => b.addEventListener('click', async () => {
      pass = (await gql(`mutation($id:ID!){ removeVisit(id:$id){ ${PASS} } }`, { id: b.dataset.rm })).removeVisit;
      draw(); side();
    }));
  }

  async function refresh() {
    pass = state.me ? (await gql(`{ pass { ${PASS} } }`)).pass : null;
    draw();
    side();
  }
  await refresh();
  return { refresh };
}
