import { state, esc, $, $$, gql, loadAtlas, REC_FIELDS, price } from './api.js';

// Zoom levels of the globe (UI-03, UI-11 and "Globe regions" in the spec).
const LEVELS = [
  { key: 'continent', minK: 1, label: 'continents' },
  { key: 'country', minK: 2.4, label: 'countries' },
  { key: 'region', minK: 6, label: 'regions' },
  { key: 'city', minK: 13, label: 'cities' },
];
const MAX_K = 70;
const MERGE_PX = 46;

const levelOf = (k) => LEVELS.reduce((idx, l, i) => (k >= l.minK ? i : idx), 0);
const keyAt = (c, li) => [c.continent, c.country, c.region, c.slug].slice(0, li + 1).join('|');
const nameAt = (c, li) => [c.continent, c.country, c.region, c.name][li];

function groupsAt(cities, li) {
  const map = new Map();
  for (const c of cities) {
    const key = keyAt(c, li);
    const g = map.get(key) || { key, level: li, name: nameAt(c, li), cities: [] };
    g.cities.push(c);
    map.set(key, g);
  }
  for (const g of map.values()) {
    g.lat = g.cities.reduce((s, c) => s + c.lat, 0) / g.cities.length;
    g.lng = g.cities.reduce((s, c) => s + c.lng, 0) / g.cities.length;
    g.count = g.cities.length;
  }
  return [...map.values()];
}

export function mountHome(root, { onBuy, onOpenCity }) {
  const cities = state.cities;
  root.innerHTML = `
    <section class="hero" aria-label="Explore open cities">
      <svg class="stars" aria-hidden="true" id="stars"></svg>
      <svg class="globe" id="globe" role="application" aria-label="Globe of open cities. Drag to turn, scroll or pinch to zoom."></svg>
      <aside class="panel panel-left" aria-label="Popular right now">
        <h2>Popular right now</h2>
        <div id="popular" class="stack" style="gap:8px"><p style="margin:0;color:var(--on-dark-2)">Loading…</p></div>
        <button class="btn btn-violet" id="lucky" type="button">I'm feeling lucky</button>
      </aside>
      <aside class="panel panel-right" id="drill" aria-label="Places in this region" hidden></aside>
      <div class="zoom"><button type="button" id="zin" aria-label="Zoom in">+</button><button type="button" id="zout" aria-label="Zoom out">−</button></div>
      <p class="hint" id="hint"></p>
    </section>`;

  const svgEl = $('#globe', root);
  const svg = d3.select(svgEl);
  const W = () => svgEl.clientWidth;
  const H = () => svgEl.clientHeight;
  const base = () => Math.min(W(), H()) * 0.36;

  // Stars
  const stars = d3.select($('#stars', root));
  const rnd = d3.randomLcg(7);
  stars.selectAll('circle').data(d3.range(120)).join('circle')
    .attr('cx', () => `${rnd() * 100}%`).attr('cy', () => `${rnd() * 100}%`)
    .attr('r', (d) => 0.5 + (d % 3) * 0.45).attr('fill', '#fff').attr('opacity', (d) => 0.2 + (d % 5) * 0.12);

  const view = { lon: 5, lat: 30, k: 1, selected: null }; // selected = group or city
  const proj = d3.geoOrthographic().clipAngle(90).precision(0.4);
  const path = d3.geoPath(proj);
  const graticule = d3.geoGraticule10();

  const defs = svg.append('defs');
  const grad = defs.append('radialGradient').attr('id', 'ocean').attr('cx', '38%').attr('cy', '32%').attr('r', '75%');
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#3d22a6');
  grad.append('stop').attr('offset', '60%').attr('stop-color', '#24136f');
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#110935');
  const gSphere = svg.append('path').attr('fill', 'url(#ocean)');
  const gGrat = svg.append('path').attr('class', 'graticule');
  const gLand = svg.append('g');
  const gRim = svg.append('path').attr('class', 'rim');
  const gDots = svg.append('g');

  const cityCountries = new Set(cities.map((c) => c.countryId));
  let countries = [];
  loadAtlas().then((a) => {
    countries = a.countries;
    gLand.selectAll('path').data(countries, (d) => d.id).join('path')
      .attr('class', (d) => 'country' + (cityCountries.has(d.id) ? ' has-city' : ''))
      .append('title').text((d) => d.properties.name);
    render();
  });

  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

  function render() {
    proj.translate([W() / 2, H() / 2]).scale(base() * view.k).rotate([-view.lon, -view.lat]);
    gSphere.attr('d', path({ type: 'Sphere' }));
    gRim.attr('d', path({ type: 'Sphere' }));
    gGrat.attr('d', path(graticule));
    const selCountry = view.selected && view.selected.level >= 1 ? view.selected.cities[0].countryId : null;
    gLand.selectAll('path').attr('d', path).classed('selected', (d) => d.id === selCountry);
    renderDots();
    renderHint();
  }

  function visible(lng, lat) {
    return d3.geoDistance([lng, lat], [view.lon, view.lat]) < Math.PI / 2 - 0.05;
  }

  function renderDots() {
    const li = levelOf(view.k);
    let groups = groupsAt(cities, li).filter((g) => visible(g.lng, g.lat)).map((g) => ({ ...g, xy: proj([g.lng, g.lat]) }));
    // Merge dots that would overlap on screen until the user zooms in further.
    const merged = [];
    const activeKey = view.selected ? view.selected.key : null;
    for (const g of groups.sort((a, b) => (b.key === activeKey) - (a.key === activeKey) || b.count - a.count)) {
      const near = g.key !== activeKey && merged.find((m) => m.key !== activeKey && Math.hypot(m.xy[0] - g.xy[0], m.xy[1] - g.xy[1]) < MERGE_PX);
      if (near) { near.count += g.count; near.cities = near.cities.concat(g.cities); near.merged = true; near.name = `${near.name} and nearby`; }
      else merged.push({ ...g });
    }
    const asCity = (g) => g.level === 3 && !g.merged;
    const activeSlug = view.selected && view.selected.level === 3 ? view.selected.cities[0].slug : null;
    const sel = gDots.selectAll('g.dot').data(merged, (d) => d.key);
    sel.exit().remove();
    const enter = sel.enter().append('g').attr('class', 'dot').attr('tabindex', 0).attr('role', 'button')
      .on('click', (e, d) => pick(d))
      .on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(d); } });
    enter.append('circle').attr('class', 'halo');
    enter.append('circle').attr('class', 'core');
    enter.append('text');
    const all = enter.merge(sel);
    all.attr('class', (d) => 'dot ' + (asCity(d) ? 'dot-city' : 'dot-group') + (asCity(d) && d.cities[0].slug === activeSlug ? ' active' : ''))
      .attr('transform', (d) => `translate(${d.xy[0]},${d.xy[1]})`)
      .attr('aria-label', (d) => (asCity(d) ? d.name : `${d.name}, ${d.count} open ${d.count === 1 ? 'city' : 'cities'}`));
    all.select('circle.halo').attr('r', (d) => (asCity(d) ? 0 : 30));
    all.select('circle.core').attr('r', (d) => (asCity(d) ? 9 : 21));
    all.select('text').text((d) => (asCity(d) ? d.name : d.count))
      .attr('x', (d) => (asCity(d) ? 14 : 0)).attr('dy', (d) => (asCity(d) ? '0.35em' : null))
      .style('text-anchor', (d) => (asCity(d) ? 'start' : 'middle'));
    view.visibleGroups = merged;
    renderList();
  }

  function renderHint() {
    const li = levelOf(view.k);
    $('#hint', root).textContent = view.k < 1.15 ? 'Drag to turn the globe. Click a number to see the cities in that region, or scroll to zoom.' : `Showing ${LEVELS[li].label}. Zoom out to go back up.`;
  }

  /* ---------- drill-down list ---------- */

  function childrenOf(group) {
    const next = Math.min(3, group.level + 1);
    return groupsAt(group.cities, next);
  }

  function ancestors(group) {
    const c = group.cities[0];
    const out = [{ name: 'World', go: () => flyHome() }];
    for (let li = 0; li < group.level; li++) {
      const g = groupsAt(cities.filter((x) => keyAt(x, li) === keyAt(c, li)), li)[0];
      out.push({ name: g.name, go: () => pick(g) });
    }
    return out;
  }

  function renderList() {
    const panel = $('#drill', root);
    if (view.k < 1.15 && !view.selected) { panel.hidden = true; return; }
    panel.hidden = false;
    const g = view.selected;
    if (g && g.level === 3) return; // the city card is rendered separately
    let items;
    let crumbsHtml = '';
    let heading;
    if (g) {
      items = childrenOf(g);
      heading = `${g.count} open ${g.count === 1 ? 'city' : 'cities'} in ${esc(g.name)}`;
      crumbsHtml = crumbs(g);
    } else {
      items = view.visibleGroups || [];
      heading = `In view: ${items.reduce((s, x) => s + x.count, 0)} open cities`;
    }
    if (panel.dataset.sig === sig(g, items)) return;
    panel.dataset.sig = sig(g, items);
    panel.innerHTML = `${crumbsHtml}<h2>${heading}</h2><div class="stack" style="gap:8px">${items.map((x, i) => `
      <button type="button" class="row-btn" data-i="${i}">
        <span><strong>${esc(x.name)}</strong><small>${x.level === 3 && x.count === 1 ? `${x.cities[0].recCount} recommendations, ${x.cities[0].walkCount} walks` : `${x.count} ${x.count === 1 ? 'city' : 'cities'}`}</small></span>
        <span class="count">${x.level === 3 && x.count === 1 ? '›' : x.count}</span>
      </button>`).join('')}</div>`;
    $$('.row-btn', panel).forEach((b) => b.addEventListener('click', () => pick(items[+b.dataset.i])));
    wireCrumbs(panel, g);
  }
  const sig = (g, items) => (g ? g.key : 'none') + ':' + items.map((x) => x.key + x.count).join(',');

  function crumbs(g) {
    const a = ancestors(g);
    return `<nav class="crumbs" aria-label="Where you are">${a.map((x, i) => `<button type="button" data-c="${i}">${esc(x.name)}</button><span class="sep">›</span>`).join('')}<strong>${esc(g.name)}</strong></nav>`;
  }
  function wireCrumbs(panel, g) {
    if (!g) return;
    const a = ancestors(g);
    $$('[data-c]', panel).forEach((b) => b.addEventListener('click', () => a[+b.dataset.c].go()));
  }

  async function renderCityCard(city) {
    const panel = $('#drill', root);
    panel.hidden = false;
    panel.dataset.sig = 'city:' + city.slug;
    const g = groupsAt([city], 3)[0];
    panel.innerHTML = `${crumbs(g)}<div class="city-card stack"><h3>${esc(city.name)}</h3>
      <span style="color:var(--on-dark-2);font-size:14px">${city.recCount} recommendations and ${city.walkCount} walks from locals</span>
      <span class="chip chip-lime">City moderator: ${esc(city.moderators.map((m) => m.name).join(', '))}</span>
      <div class="preview-box" id="preview"><small>Loading a free preview…</small></div>
      <div id="buyarea"></div></div>`;
    wireCrumbs(panel, g);
    try {
      const { cityRecs } = await gql(`query($s:String!){ cityRecs(slug:$s){ access preview { ${REC_FIELDS} } } }`, { s: city.slug });
      if (panel.dataset.sig !== 'city:' + city.slug) return;
      const p = cityRecs.preview;
      $('#preview', panel).innerHTML = cityRecs.access
        ? `<small>You have access to this city.</small><strong>Open the map to see every walk and spot.</strong>`
        : p ? `<small>Free preview, picked at random</small><strong>${esc(p.title)}</strong><span style="font-size:13px;color:var(--on-dark-2)">${p.kind === 'walk' ? `Walk, ${p.durationMin} min` : 'Spot'}, ${price(p.priceLevel)}, ▲ ${p.up}</span><span style="font-size:14px">${esc(p.description.slice(0, 160))}${p.description.length > 160 ? '…' : ''}</span>` : '<small>No preview yet.</small>';
      const buy = $('#buyarea', panel);
      if (cityRecs.access) {
        buy.innerHTML = `<button class="btn btn-lime" type="button" id="open-city" style="width:100%">Open the ${esc(city.name)} map</button>`;
        $('#open-city', buy).addEventListener('click', () => onOpenCity(city.slug));
      } else {
        buy.innerHTML = `<div class="price-options">
          <button class="price-opt" type="button" data-k="bundle"><span><strong>${esc(city.name)}</strong><small>One-time, yours to keep</small></span><strong>€2.99</strong></button>
          <button class="price-opt" type="button" data-k="pass5"><span><strong>Trip pass</strong><small>Any 5 cities</small></span><strong>€10</strong></button>
          <button class="price-opt" type="button" data-k="monthly"><span><strong>Every city</strong><small>Monthly, or €30 a year</small></span><strong>€7.99</strong></button>
        </div>`;
        $$('[data-k]', buy).forEach((b) => b.addEventListener('click', () => onBuy(b.dataset.k, city.slug)));
      }
    } catch (e) {
      $('#preview', panel).innerHTML = `<small>${esc(e.message)}</small>`;
    }
  }

  /* ---------- navigation ---------- */

  function pick(g) {
    if (g.merged) { // overlapping dots: zoom in towards them first
      fly(g.lng, g.lat, Math.min(MAX_K, view.k * 2.2));
      return;
    }
    view.selected = g;
    const isCity = g.level === 3;
    const targetK = isCity ? Math.max(view.k, 32) : Math.max(view.k, LEVELS[g.level + 1].minK * 1.35);
    fly(g.lng, g.lat, targetK);
    if (isCity) renderCityCard(g.cities[0]);
    else renderList();
  }

  function flyHome() {
    view.selected = null;
    fly(view.lon, Math.max(-20, Math.min(40, view.lat)), 1);
  }

  let zoomSyncing = false;
  function fly(lon, lat, k) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = [view.lon, view.lat];
    const iRot = d3.geoInterpolate(from, [lon, lat]);
    const k0 = view.k;
    const done = () => { zoomSyncing = true; svg.call(zoomer.transform, d3.zoomIdentity.scale(view.k)); zoomSyncing = false; render(); };
    if (reduce) { view.lon = lon; view.lat = lat; view.k = k; return done(); }
    const t = d3.timer((elapsed) => {
      const p = Math.min(1, elapsed / 900);
      const e = d3.easeCubicInOut(p);
      [view.lon, view.lat] = iRot(e);
      view.k = Math.exp(Math.log(k0) + (Math.log(k) - Math.log(k0)) * e);
      render();
      if (p >= 1) { t.stop(); done(); }
    });
  }

  // Wheel and pinch zoom; drag turns the globe.
  const zoomer = d3.zoom().scaleExtent([1, MAX_K])
    .filter((e) => e.type === 'wheel' || (e.type === 'touchstart' && e.touches && e.touches.length > 1))
    .on('zoom', (e) => {
      if (zoomSyncing) return;
      view.k = e.transform.k;
      // Zooming out above the selected level moves the selection up (UI-11).
      if (view.selected) {
        const li = levelOf(view.k);
        if (view.k < 1.15) view.selected = null;
        else if (li <= view.selected.level - 1 || (view.selected.level === 3 && li < 3)) {
          const up = Math.max(0, li - 1);
          view.selected = li === 0 ? null : groupsAt(cities.filter((c) => keyAt(c, up) === keyAt(view.selected.cities[0], up)), up)[0];
          $('#drill', root).dataset.sig = '';
        }
      }
      schedule();
    });
  svg.call(zoomer).on('dblclick.zoom', null);
  svg.call(d3.drag().on('drag', (e) => {
    const degPerPx = (180 / Math.PI) / (base() * view.k);
    view.lon -= e.dx * degPerPx;
    view.lat = Math.max(-80, Math.min(80, view.lat + e.dy * degPerPx));
    schedule();
  }));
  $('#zin', root).addEventListener('click', () => svg.transition().duration(300).call(zoomer.scaleBy, 1.8));
  $('#zout', root).addEventListener('click', () => svg.transition().duration(300).call(zoomer.scaleBy, 1 / 1.8));
  window.addEventListener('resize', schedule);

  /* ---------- popular, lucky, search ---------- */

  const flyToCity = (slug) => {
    const c = cities.find((x) => x.slug === slug);
    if (c) pick(groupsAt([c], 3)[0]);
  };
  $('#lucky', root).addEventListener('click', () => {
    if (!cities.length) return;
    flyToCity(cities[Math.floor(Math.random() * cities.length)].slug);
  });
  gql('{ popular { kind title meta citySlug } }').then(({ popular }) => {
    const box = $('#popular', root);
    box.innerHTML = popular.length ? popular.map((p, i) => `<button type="button" class="tile-btn" data-i="${i}"><span class="kind">${esc(p.kind)}</span><strong>${esc(p.title)}</strong><span class="meta">${esc(p.meta)}</span></button>`).join('') : '<p style="margin:0;color:var(--on-dark-2)">Nothing yet. Be the first to explore.</p>';
    $$('[data-i]', box).forEach((b) => b.addEventListener('click', () => flyToCity(popular[+b.dataset.i].citySlug)));
  }).catch(() => { $('#popular', root).innerHTML = ''; });

  const searchIndex = [];
  for (let li = 0; li < 4; li++) for (const g of groupsAt(cities, li)) searchIndex.push({ g, label: g.name, type: LEVELS[li].key });
  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    return searchIndex.filter((x) => x.label.toLowerCase().includes(q)).slice(0, 8);
  }

  render();
  return { search, pick, flyToCity };
}
