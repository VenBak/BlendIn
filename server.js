require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { createYoga } = require('graphql-yoga');
const { schema } = require('./src/schema');
const { userFromRequest } = require('./src/auth');
const payments = require('./src/payments');
const { seedIfEmpty } = require('./src/seed');

const { MONGODB_URI, PORT = 3000, NODE_ENV } = process.env;
if (!MONGODB_URI) {
  console.error('\nMissing MONGODB_URI. Copy .env.example to .env (or set it on Heroku) with your MongoDB connection string.\n');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // Heroku terminates HTTPS at its router

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'connect-src': ["'self'"],
        'form-action': ["'self'", 'https://checkout.stripe.com'],
      },
    },
  })
);
app.use(compression());
app.use(cookieParser());

// Stripe needs the raw body to verify the signature.
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), payments.webhook);

// GraphQL. POSTs must carry our header, which a cross-site form can't add (CSRF protection).
app.use('/graphql', (req, res, next) => {
  if (req.method === 'POST' && req.get('x-requested-with') !== 'blend-in') {
    return res.status(400).json({ errors: [{ message: 'Missing x-requested-with header.' }] });
  }
  next();
});
const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  graphiql: NODE_ENV !== 'production',
  landingPage: false,
  context: async ({ req, res }) => ({ req, res, user: await userFromRequest(req) }),
});
app.use(yoga.graphqlEndpoint, yoga);

// Front-end libraries and map data, served from node_modules (no build step).
const nm = (p) => path.join(__dirname, 'node_modules', p);
const long = { maxAge: '7d' };
app.use('/vendor/d3', express.static(nm('d3/dist'), long));
app.use('/vendor/topojson', express.static(nm('topojson-client/dist'), long));
app.use('/vendor/leaflet', express.static(nm('leaflet/dist'), long));
app.get('/data/countries.json', (_req, res) => res.sendFile(nm('world-atlas/countries-50m.json'), { maxAge: '7d' }));
app.get('/healthz', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

(async () => {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log(`[db] Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
  } catch (err) {
    console.error('[db] Could not connect to MongoDB. Check MONGODB_URI and your cluster network access.', err.message);
    process.exit(1);
  }
  try {
    await seedIfEmpty();
  } catch (err) {
    console.error('[seed] Demo content could not be added:', err.message);
  }
  app.listen(PORT, () => console.log(`[web] Blend In on http://localhost:${PORT} (payments: ${payments.mode()})`));
})();
