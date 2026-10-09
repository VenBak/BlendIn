import { state, esc, $, $$, gql, toast, ME_FIELDS, CITY_FIELDS } from './api.js';
import { mountHome } from './globe.js';
import { mountPass } from './pass.js';
import { mountCity } from './city.js';
import { mountCreate } from './create.js';
import { mountModerate, mountAccount } from './manage.js';

const view = $('#view');
let globe = null;

async function refreshMe() {
  state.me = (await gql(`{ me { ${ME_FIELDS} } }`)).me;
}

/* ---------- header ---------- */

function renderTopbar(isHome) {
  const me = state.me;
  const firstCity = (state.cities[0] && state.cities[0].slug) || '';
  $('#topbar').innerHTML = `
    <a class="brand" href="#/" aria-label="Blend In, home"><span class="brand-mark"><span></span></span>Blend In</a>
    ${isHome ? `<div class="search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#cfcbe6" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
      <label class="sr" for="q">Search a city, region or country</label><input id="q" type="search" autocomplete="off" placeholder="Search a city, region or country"><ul class="search-results" id="results" hidden></ul></div>` : ''}
    <div class="top-actions">
      ${me ? `<a class="btn btn-lime btn-small" href="#/create/${firstCity}">Add a recommendation</a>
        <a class="btn btn-plain" href="#/pass">Travel pass</a>
        ${me.moderatorOf.length ? `<a class="btn btn-plain" href="#/moderate/${me.moderatorOf[0].slug}">Moderate</a>` : ''}
        <a class="btn btn-plain" href="#/account">${esc(me.name.split(' ')[0])}</a>`
      : `<button class="btn btn-plain" type="button" data-auth="login">Log in</button><button class="btn btn-lime" type="button" data-auth="signup">Sign up</button>`}
    </div>`;
  $$('[data-auth]').forEach((b) => b.addEventListener('click', () => openAuth(b.dataset.auth)));
  const q = $('#q');
  if (q && globe) {
    const results = $('#results');
    q.addEventListener('input', () => {
      const hits = globe.search(q.value);
      results.hidden = !hits.length;
      results.innerHTML = hits.map((h, i) => `<li><button type="button" data-h="${i}"><span>${esc(h.label)}</span><small>${h.type}</small></button></li>`).join('');
      $$('[data-h]', results).forEach((b) => b.addEventListener('click', () => { globe.pick(hits[+b.dataset.h].g); results.hidden = true; q.value = ''; }));
    });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = $('[data-h]', results); if (b) b.click(); } if (e.key === 'Escape') results.hidden = true; });
  }
}

/* ---------- auth ---------- */

function openAuth(mode = 'login', after) {
  const m = $('#modal');
  const signup = mode === 'signup';
  m.innerHTML = `<form class="modal" id="auth" aria-labelledby="auth-title">
    <h2 id="auth-title">${signup ? 'Create your account' : 'Welcome back'}</h2>
    ${signup ? '<label class="field">Name<input name="name" required maxlength="60" autocomplete="name"></label>' : ''}
    <label class="field">Email<input name="email" type="email" required autocomplete="email"></label>
    <label class="field">Password<input name="password" type="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}">${signup ? '<small>At least 8 characters.</small>' : ''}</label>
    <p class="form-error" id="auth-err"></p>
    <button class="btn btn-violet" type="submit">${signup ? 'Create account' : 'Log in'}</button>
    <p style="margin:0;font-size:14px">${signup ? 'Already have an account?' : 'New here?'} <button type="button" class="linkish" id="swap">${signup ? 'Log in' : 'Create an account'}</button> <button type="button" class="linkish" id="cancel" style="float:right">Cancel</button></p>
  </form>`;
  const f = $('#auth');
  f.querySelector('input').focus();
  $('#swap').addEventListener('click', () => openAuth(signup ? 'login' : 'signup', after));
  $('#cancel').addEventListener('click', () => (m.innerHTML = ''));
  m.onclick = (e) => { if (e.target === m) m.innerHTML = ''; };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (signup) await gql('mutation($e:String!,$p:String!,$n:String!){ register(email:$e, password:$p, name:$n){ id } }', { e: f.email.value, p: f.password.value, n: f.name.value });
      else await gql('mutation($e:String!,$p:String!){ login(email:$e, password:$p){ id } }', { e: f.email.value, p: f.password.value });
      await refreshMe();
      m.innerHTML = '';
      toast(signup ? 'Your account is ready' : `Hi ${state.me.name.split(' ')[0]}`);
      if (after) after(); else route();
    } catch (err) { $('#auth-err').textContent = err.message; }
  });
}

async function logout() {
  await gql('mutation { logout }');
  state.me = null;
  toast('Logged out');
  location.hash = '#/';
  route();
}

/* ---------- purchases ---------- */

async function buy(kind, citySlug) {
  if (!state.me) return openAuth('login', () => buy(kind, citySlug));
  try {
    const { buy: res } = await gql('mutation($k:String!,$c:String){ buy(kind:$k, citySlug:$c){ granted checkoutUrl mode } }', { k: kind, c: citySlug || null });
    if (res.checkoutUrl) { location.href = res.checkoutUrl; return; }
    // A trip pass bought from a city page is used for that city straight away.
    if ((kind === 'pass5' || kind === 'pass10') && citySlug) await gql('mutation($s:String!){ unlockCity(slug:$s, using:"pass"){ id } }', { s: citySlug });
    await refreshMe();
    toast(res.mode === 'demo' ? 'Unlocked (demo payment, nothing was charged)' : 'Unlocked');
    if (citySlug) location.hash = `#/city/${citySlug}`;
    route();
  } catch (e) { toast(e.message); }
}

/* ---------- router ---------- */

async function route() {
  const h = location.hash || '#/';
  const [, page, arg] = h.match(/^#\/?([^/]*)\/?(.*)$/) || [];
  const isHome = !page || page === 'pass' || page === 'thanks';
  document.body.classList.toggle('light', !isHome);
  document.title = 'Blend In';
  $('#modal').innerHTML = '';
  window.scrollTo(0, 0);

  if (isHome) {
    view.innerHTML = '<div id="home-globe"></div><div id="home-pass"></div><footer class="foot"><span>Blend In</span><span>Every recommendation comes from someone who lives there.' + (state.config.paymentsMode === 'demo' ? ' Payments are in demo mode.' : '') + '</span></footer>';
    globe = mountHome($('#home-globe'), { onBuy: buy, onOpenCity: (slug) => (location.hash = `#/city/${slug}`) });
    renderTopbar(true);
    await mountPass($('#home-pass'), { onLogin: () => openAuth('login') });
    if (page === 'pass') $('#travel-pass').scrollIntoView({ behavior: 'smooth' });
    if (page === 'thanks') { await refreshMe(); renderTopbar(true); toast('Payment received. Your access is ready.'); }
    return;
  }
  globe = null;
  renderTopbar(false);
  view.innerHTML = '';
  if (page === 'city') await mountCity(view, arg, { onBuy: buy, onLogin: () => openAuth('login') });
  else if (page === 'create') await mountCreate(view, arg, { onLogin: () => openAuth('login'), refreshMe: async () => { await refreshMe(); renderTopbar(false); } });
  else if (page === 'moderate') await mountModerate(view, arg);
  else if (page === 'account') await mountAccount(view, { refreshMe: async () => { await refreshMe(); renderTopbar(false); }, onLogout: logout });
  else view.innerHTML = '<div class="paywall"><h1 style="margin:0;color:var(--ink)">Page not found</h1><a class="btn btn-violet" href="#/">Back to the globe</a></div>';
}

/* ---------- start ---------- */

(async function init() {
  try {
    const data = await gql(`{ config { paymentsMode moods budgets tileUrl tileAttribution } me { ${ME_FIELDS} } cities { ${CITY_FIELDS} } }`);
    state.config = data.config;
    state.me = data.me;
    state.cities = data.cities;
  } catch (e) {
    view.innerHTML = `<div class="paywall" style="color:#fff"><h1>Blend In could not start</h1><p>${esc(e.message)}</p></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
})();
