import { state, esc, $, $$, gql, toast, price, moodLabel, REC_FIELDS, CITY_FIELDS } from './api.js';

export async function mountModerate(root, slug) {
  root.innerHTML = '<p style="padding:24px">Loading…</p>';
  let m;
  try {
    m = (await gql(`query($s:String!){ moderation(slug:$s){ approvedCount city { ${CITY_FIELDS} } pending { ${REC_FIELDS} author { name localSince } } reports { id reason text recTitle recId } live { id title capacity kind } } }`, { s: slug })).moderation;
  } catch (e) {
    root.innerHTML = `<div class="paywall"><h1 style="margin:0;color:var(--ink)">Moderators only</h1><p>${esc(e.message)}</p><a class="btn btn-violet" href="#/">Back to the globe</a></div>`;
    return;
  }
  const c = m.city;
  root.innerHTML = `<div class="wrap">
    <div><h1 style="margin:0;color:var(--ink)">${esc(c.name)}: city moderation</h1><p style="margin:4px 0 0">${state.me.moderatorOf.length > 1 ? state.me.moderatorOf.map((x) => `<a href="#/moderate/${x.slug}">${esc(x.name)}</a>`).join(', ') : ''}</p></div>
    <div class="stat-grid">
      <div class="stat">City status<strong style="color:${c.isOpen ? 'var(--quiet-ink)' : 'var(--very-ink)'}">${c.isOpen ? 'Open' : 'Not open yet'}</strong><small>${c.moderators.length} moderator${c.moderators.length === 1 ? '' : 's'}, ${m.approvedCount} recommendations (3 needed)</small></div>
      <div class="stat">Waiting for review<strong>${m.pending.length}</strong></div>
      <div class="stat">Open reports<strong>${m.reports.length}</strong></div>
    </div>
    <div class="two">
      <section class="card"><h3>Review queue</h3>${m.pending.length ? m.pending.map((r) => `
        <div class="queue-item"><span style="font-size:12px;font-weight:700;color:var(--violet)">New ${r.kind}, by ${esc(r.author.name)}${r.author.localSince ? `, local since ${r.author.localSince}` : ''}</span>
          <strong style="color:var(--ink)">${esc(r.title)}</strong><span style="font-size:14px">${esc(r.description)}</span>
          <span style="font-size:13px;color:var(--muted)">${price(r.priceLevel)}, rated ${r.personalRating}/5${r.kind === 'walk' ? `, ${r.distanceKm} km` : ''}${r.moods.length ? `, ${r.moods.map(moodLabel).join(', ')}` : ''}</span>
          <input data-note="${r.id}" placeholder="Note to the author (optional)" style="padding:9px 10px;border:1px solid #c9cce3;border-radius:10px">
          <div class="actions"><button class="btn btn-small btn-violet" data-a="approve" data-id="${r.id}">Approve</button><button class="btn btn-small btn-ghost" data-a="changes" data-id="${r.id}">Ask for changes</button><button class="btn btn-small btn-ghost" data-a="reject" data-id="${r.id}">Reject</button></div></div>`).join('') : '<p style="margin:0">Nothing waiting. New recommendations for this city appear here.</p>'}</section>
      <section class="card"><h3>Reports</h3>${m.reports.length ? m.reports.map((r) => `
        <div class="queue-item"><span style="font-size:12px;font-weight:700;color:var(--very-ink)">Reported: ${esc(r.reason)}</span><strong style="color:var(--ink)">${esc(r.recTitle)}</strong>${r.text ? `<span style="font-size:14px">${esc(r.text)}</span>` : ''}
          <div class="actions"><button class="btn btn-small btn-violet" data-r="hide" data-id="${r.id}">Hide now</button><button class="btn btn-small btn-ghost" data-r="escalate" data-id="${r.id}">Pass to staff</button><button class="btn btn-small btn-ghost" data-r="dismiss" data-id="${r.id}">Dismiss</button></div></div>`).join('') : '<p style="margin:0">No open reports.</p>'}</section>
    </div>
    <section class="card"><h3>Crowd capacity</h3><p style="margin:0 0 10px;font-size:14px">How many extra Blend In visitors each place takes comfortably in an hour. Above this, it drops in the rankings and travellers are offered quieter times.</p>
      ${m.live.map((r) => `<div class="visit-line" style="align-items:center"><span>${esc(r.title)}</span><span style="display:flex;gap:8px;align-items:center"><input type="number" min="1" max="5000" value="${r.capacity}" data-cap="${r.id}" aria-label="Capacity for ${esc(r.title)}" style="width:90px;padding:8px;border:1px solid #c9cce3;border-radius:8px"> per hour</span></div>`).join('')}
      <button class="btn btn-small btn-violet" id="savecap" style="margin-top:10px">Save capacities</button></section>
    ${state.me.isAdmin ? `<section class="card stack"><h3>Admin: appoint a city moderator</h3><form class="row2" id="appoint"><label class="field">Their account email<input name="email" type="email" required></label><button class="btn btn-violet" type="submit" style="align-self:flex-end">Appoint for ${esc(c.name)}</button></form></section>` : ''}
  </div>`;

  $$('[data-a]', root).forEach((b) => b.addEventListener('click', async () => {
    try {
      await gql(`mutation($id:ID!,$a:String!,$n:String){ reviewRec(recId:$id, action:$a, note:$n){ status } }`, { id: b.dataset.id, a: b.dataset.a, n: $(`[data-note="${b.dataset.id}"]`, root).value });
      toast({ approve: 'Approved, now live', changes: 'Sent back with your note', reject: 'Rejected' }[b.dataset.a]);
      mountModerate(root, slug);
    } catch (e) { toast(e.message); }
  }));
  $$('[data-r]', root).forEach((b) => b.addEventListener('click', async () => {
    try {
      await gql(`mutation($id:ID!,$a:String!){ handleReport(id:$id, action:$a) }`, { id: b.dataset.id, a: b.dataset.r });
      toast({ hide: 'Hidden', escalate: 'Passed to staff', dismiss: 'Dismissed' }[b.dataset.r]);
      mountModerate(root, slug);
    } catch (e) { toast(e.message); }
  }));
  const save = $('#savecap', root);
  if (save) save.addEventListener('click', async () => {
    try {
      for (const i of $$('[data-cap]', root)) await gql(`mutation($id:ID!,$c:Int!){ setCapacity(recId:$id, capacity:$c){ id } }`, { id: i.dataset.cap, c: +i.value });
      toast('Capacities saved');
    } catch (e) { toast(e.message); }
  });
  const appoint = $('#appoint', root);
  if (appoint) appoint.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await gql(`mutation($s:String!,$e:String!){ appointModerator(slug:$s, email:$e){ id } }`, { s: slug, e: appoint.email.value });
      toast('Moderator appointed');
      mountModerate(root, slug);
    } catch (err) { toast(err.message); }
  });
}

export async function mountAccount(root, { refreshMe, onLogout }) {
  const me = state.me;
  if (!me) { location.hash = '#/'; return; }
  const { allCities } = await gql(`{ allCities { slug name isOpen hasAccess } }`);
  const locked = allCities.filter((c) => c.isOpen && !c.hasAccess);
  const until = me.subscriptionUntil ? new Date(me.subscriptionUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const r = me.rewards;
  root.innerHTML = `<div class="wrap">
    <h1 style="margin:0;color:var(--ink)">${esc(me.name)}</h1>
    <div class="stat-grid">
      <div class="stat">Every city<strong>${me.hasSubscription ? 'Active' : 'Off'}</strong><small>${me.hasSubscription ? `Until ${until}` : '€7.99 a month or €30 a year'}</small></div>
      <div class="stat">Trip pass cities left<strong>${me.passTokens}</strong></div>
      <div class="stat">Credits<strong>${me.credits}</strong><small>1 per approved recommendation</small></div>
      <div class="stat">Tier<strong>${esc(r.tier)}</strong><small>${r.points} tier points${r.nextTier && r.approved ? `, ${r.pointsNeeded} more for ${esc(r.nextTier)}` : ''}</small></div>
    </div>
    <div class="two">
      <section class="card stack"><h3>Unlock a city</h3>
        ${locked.length ? `<label class="field">City<select id="ucity">${locked.map((c) => `<option value="${c.slug}">${esc(c.name)}</option>`).join('')}</select></label>
        <div class="actions"><button class="btn btn-small btn-violet" data-u="pass" ${me.passTokens ? '' : 'disabled'}>Use a trip pass city</button><button class="btn btn-small btn-ghost" data-u="credit" ${me.credits ? '' : 'disabled'}>Use a credit</button></div>` : '<p style="margin:0">You already have every open city.</p>'}
        <button class="btn btn-small btn-ghost" id="redeem" ${me.credits >= 3 ? '' : 'disabled'}>Swap 3 credits for a month of every city</button>
        ${me.moderatorOf.length ? `<p style="margin:0">You moderate: ${me.moderatorOf.map((c) => `<a href="#/moderate/${c.slug}">${esc(c.name)}</a>`).join(', ')}</p>` : ''}
      </section>
      <form class="card stack" id="prefs"><h3>What you like</h3>
        <label class="field">Name<input name="name" value="${esc(me.name)}" maxlength="60"></label>
        <div class="field">Moods<div class="chips">${state.config.moods.map((m) => `<button type="button" data-m="${m}" aria-pressed="${me.interests.includes(m)}">${esc(moodLabel(m))}</button>`).join('')}</div><small>Your map leans toward these.</small></div>
        <label class="field">Budget<select name="budget">${state.config.budgets.map((b) => `<option value="${b}" ${me.budget === b ? 'selected' : ''}>${b[0].toUpperCase() + b.slice(1)}</option>`).join('')}</select></label>
        <div class="actions"><button class="btn btn-violet btn-small" type="submit">Save changes</button><button class="btn btn-ghost btn-small" type="button" id="logout">Log out</button></div>
      </form>
    </div></div>`;
  $$('[data-u]', root).forEach((b) => b.addEventListener('click', async () => {
    try {
      await gql(`mutation($s:String!,$u:String!){ unlockCity(slug:$s, using:$u){ id } }`, { s: $('#ucity', root).value, u: b.dataset.u });
      toast('City unlocked'); await refreshMe(); mountAccount(root, { refreshMe, onLogout });
    } catch (e) { toast(e.message); }
  }));
  $('#redeem', root).addEventListener('click', async () => {
    try { await gql('mutation { redeemCreditsForMonth { id } }'); toast('A month of every city added'); await refreshMe(); mountAccount(root, { refreshMe, onLogout }); } catch (e) { toast(e.message); }
  });
  $$('[data-m]', root).forEach((b) => b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'))));
  $('#prefs', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await gql(`mutation($n:String,$i:[String!],$b:String){ updateProfile(name:$n, interests:$i, budget:$b){ id } }`, { n: e.target.name.value, i: $$('[data-m][aria-pressed="true"]', root).map((x) => x.dataset.m), b: e.target.budget.value });
      toast('Changes saved'); await refreshMe();
    } catch (err) { toast(err.message); }
  });
  $('#logout', root).addEventListener('click', onLogout);
}
