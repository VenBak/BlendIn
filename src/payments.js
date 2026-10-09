// Payments. With STRIPE_SECRET_KEY set, purchases go through Stripe Checkout and are granted by the webhook.
// Without it the app runs in demo mode: purchases are granted straight away and marked as demo.
const { User, Purchase, CityDay } = require('./models');

const PRODUCTS = {
  bundle: { cents: 299, name: 'City bundle' },
  pass5: { cents: 1000, name: 'Trip pass, 5 cities' },
  pass10: { cents: 1500, name: 'Trip pass, 10 cities' },
  monthly: { cents: 799, name: 'Blend In, every city (monthly)', interval: 'month' },
  yearly: { cents: 3000, name: 'Blend In, every city (yearly)', interval: 'year' },
};

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  const Stripe = require('stripe');
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
}
const mode = () => (stripe ? 'stripe' : 'demo');
const today = () => new Date().toISOString().slice(0, 10);

function addPeriod(from, interval) {
  const d = new Date(Math.max(Date.now(), from ? new Date(from).getTime() : 0));
  if (interval === 'year') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

async function grant(userId, kind, cityId, provider, sessionId) {
  if (sessionId && (await Purchase.exists({ stripeSessionId: sessionId }))) return; // already granted
  const user = await User.findById(userId);
  if (!user) return;
  const p = PRODUCTS[kind];
  if (kind === 'bundle') user.unlockedCities.addToSet(cityId);
  if (kind === 'pass5') user.passTokens += 5;
  if (kind === 'pass10') user.passTokens += 10;
  if (p.interval) user.subscriptionUntil = addPeriod(user.subscriptionUntil, p.interval);
  await user.save();
  await Purchase.create({ user: user._id, kind, city: cityId || undefined, amountCents: p.cents, provider, stripeSessionId: sessionId });
  if (cityId) await CityDay.updateOne({ city: cityId, day: today() }, { $inc: { purchases: 1 } }, { upsert: true });
}

async function startPurchase(user, kind, city, origin) {
  const p = PRODUCTS[kind];
  if (!p) throw new Error('Unknown product.');
  if (kind === 'bundle' && !city) throw new Error('Pick a city for the bundle.');
  if (!stripe) {
    await grant(user._id, kind, city && city._id, 'demo');
    return { granted: true, checkoutUrl: null, mode: 'demo' };
  }
  const name = kind === 'bundle' ? `${city.name} bundle` : p.name;
  const session = await stripe.checkout.sessions.create({
    mode: p.interval ? 'subscription' : 'payment',
    customer: user.stripeCustomerId || undefined,
    customer_email: user.stripeCustomerId ? undefined : user.email,
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: p.cents, product_data: { name }, ...(p.interval ? { recurring: { interval: p.interval } } : {}) } }],
    metadata: { userId: String(user._id), kind, cityId: city ? String(city._id) : '' },
    success_url: `${origin}/#/thanks`,
    cancel_url: `${origin}/#/${city ? 'city/' + city.slug : ''}`,
  });
  return { granted: false, checkoutUrl: session.url, mode: 'stripe' };
}

// Express handler; must receive the raw body.
async function webhook(req, res) {
  if (!stripe) return res.status(404).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }
  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const { userId, kind, cityId } = s.metadata || {};
      if (s.customer) await User.updateOne({ _id: userId }, { $set: { stripeCustomerId: s.customer } });
      await grant(userId, kind, cityId || undefined, 'stripe', s.id);
    }
    if (event.type === 'invoice.paid') {
      const inv = event.data.object;
      if (inv.billing_reason === 'subscription_cycle') {
        const end = inv.lines && inv.lines.data[0] && inv.lines.data[0].period && inv.lines.data[0].period.end;
        if (end) await User.updateOne({ stripeCustomerId: inv.customer }, { $set: { subscriptionUntil: new Date(end * 1000) } });
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe] webhook failed', err);
    res.status(500).end();
  }
}

module.exports = { PRODUCTS, startPurchase, webhook, mode, grant };
