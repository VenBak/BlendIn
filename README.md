# Blend In

Walks, spots and city guides from the people who live there. This is the web app from the Blend In requirements specification, built with Node.js, GraphQL and MongoDB, ready to deploy on Heroku with a MongoDB Atlas cluster.

## What's in it

- **Home globe.** A 3D globe with country outlines. Drag to turn, scroll or pinch to zoom; the globe grows as you zoom in. Open cities appear as numbered dots grouped by continent, country, region and city. Clicking a dot opens a drop-down list that narrows as you zoom in and closes when you zoom fully out. Also on the home page: search, a "popular right now" panel, "I'm feeling lucky", and log in and sign up.
- **Travel pass.** A separate section on the home page. Countries you have visited are coloured in and visited cities are marked. Stamping a place adds it automatically; earlier trips can be added by hand.
- **City map.** After buying a city, walks are drawn as trails whose strength follows the personalised ranking. Clicking a walk shows speech bubbles with photo, title, description and price; clicking a bubble opens the details, voting, stamping, reporting and crowd check.
- **Buying.** €2.99 per city, trip passes of 5 cities for €10 or 10 for €15, and every city for €7.99 a month or €30 a year. Through Stripe Checkout when Stripe keys are set, otherwise in demo mode.
- **Adding recommendations.** Spots are pins with a title, description, personal rating and price. Walks go from a start to a destination along real streets and can be reshaped by clicking points the route must pass through. Every recommendation is reviewed by the city moderator.
- **City moderators.** A review queue, reports, and how many visitors each place takes in an hour. A city opens only once it has a moderator and at least 3 approved recommendations.
- **Rewards.** A credit for every approved recommendation (1 credit unlocks a city, 3 credits a month of every city), and tiers from tier points, with votes fading faster in busy cities.
- **Algorithms from the spec.** Wilson score ranking, personalised score, map trail opacity, crowd balancing and vote ageing are in `src/algo.js`.

Not in this version yet: private guides, tours and meetups; email notifications; photo uploads (recommendations take an https photo link); offline maps.

## Run it locally

Requires Node.js 22 and a MongoDB database (a free Atlas cluster or a local `mongod`).

```bash
npm install
cp .env.example .env        # set MONGODB_URI, JWT_SECRET and ADMIN_EMAIL
npm start                   # http://localhost:3000
```

On an empty database the app adds six Dutch launch cities (Nijmegen, Amsterdam, Rotterdam, The Hague, Utrecht, Eindhoven) with moderators and 21 recommendations. `npm run seed` recreates them and `npm run unseed` removes them; real users are never touched. The demo accounts have random passwords, so nobody can log into them.

Sign up with the address in `ADMIN_EMAIL` to become the admin. The admin can moderate every city and appoint city moderators from the Moderate page.

## Deploy to Heroku with MongoDB Atlas

1. **Create the database.** In [MongoDB Atlas](https://www.mongodb.com/atlas), create a cluster and a database user. Under Network Access, allow `0.0.0.0/0`, because Heroku dynos don't have fixed IP addresses. Copy the connection string from Connect > Drivers and add the database name after the host: `...mongodb.net/blendin?retryWrites=true&w=majority`.
2. **Create the app.**
   ```bash
   git init && git add . && git commit -m "Blend In"
   heroku create your-app-name
   heroku config:set MONGODB_URI="mongodb+srv://..." \
     JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
     ADMIN_EMAIL="you@example.com"
   git push heroku main
   heroku open
   ```
   Heroku sets `NODE_ENV=production`, so login cookies are secure-only and the GraphiQL explorer is switched off. `app.json` also lets you use a "Deploy to Heroku" button once the code is in a GitHub repository.
3. **Check it.** `https://your-app-name.herokuapp.com/healthz` should return `{"ok":true,"db":true}`.

## Taking real payments with Stripe

1. Set `STRIPE_SECRET_KEY` (start with a test key, `sk_test_...`).
2. In the Stripe dashboard, add a webhook endpoint at `https://your-app-name.herokuapp.com/stripe/webhook` for the events `checkout.session.completed` and `invoice.paid`, and set its signing secret as `STRIPE_WEBHOOK_SECRET`.
3. Restart the app. Purchases now go through Stripe Checkout; access is granted when the webhook arrives, and yearly and monthly subscriptions are extended on each paid renewal.

Prices are in `src/payments.js`. Without Stripe keys the app runs in demo mode: purchases are granted straight away and the site says so.

## Maps and walking routes

- **Map tiles.** By default the city maps use OpenStreetMap's own tile servers, which are meant for light use only. For real traffic, use a provider such as MapTiler, Stadia Maps or Thunderforest and set `TILE_URL` (a Leaflet URL template) and `TILE_ATTRIBUTION`.
- **Walking routes.** By default routes come from the public OpenStreetMap foot router at `routing.openstreetmap.de`, which has usage limits. For production, run your own OSRM server with the foot profile, or use a compatible service, and set `ROUTING_URL`. If the router is unreachable, the app falls back to straight lines between points and tells the person drawing the walk.
- **Globe outlines.** The country shapes come from the `world-atlas` package (Natural Earth, 1:50m) and are served by the app itself.

## GraphQL API

The API is at `/graphql`. Every POST must include the header `x-requested-with: blend-in`, which protects against cross-site requests; the website's client sends it automatically. In development, open `/graphql` in a browser for the GraphiQL explorer. The full schema is at the top of `src/schema.js`.

## Project structure

```
server.js            Express server: security headers, GraphQL, Stripe webhook, static files
src/schema.js        GraphQL schema and resolvers
src/models.js        Mongoose models: users, cities, recommendations, votes, visits, plans, reports, purchases
src/algo.js          Ranking, personalisation, crowding, map opacity and tier formulas
src/payments.js      Stripe Checkout and demo payments
src/routing.js       Walking routes through an OSRM-compatible router
src/auth.js          Login sessions (httpOnly cookie)
src/seed.js          Dutch launch demo content
public/              The website: index.html, css/app.css and js/ (no build step)
```

Front-end libraries (D3, TopoJSON, Leaflet) are served from `node_modules`, so there is no build step on Heroku.
