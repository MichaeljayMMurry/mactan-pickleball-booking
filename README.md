# Mactan Pickleball Booking System

A web app for one configurable pickleball venue. Players can request private court time, Open Play and coaching. Staff manage the same records from a protected dashboard. The sample venue is Mactan Pickleball Club in Cebu, with four courts, Cebu time and Philippine pesos.

## Run it on Windows

1. Install Node.js 24 or later if needed. This app uses its built-in SQLite module.
2. Double-click **Start-Mactan-Booking.cmd**. You can also open the project folder in PowerShell and start it there.

   ```powershell
   npm.cmd start
   ```

3. In Chrome or Edge, open **http://127.0.0.1:3000/**. Click **Staff** to sign in. The username is `staff` and the server prints a generated password the first time it starts. Save that password securely.

The first launch creates `data/club.sqlite` and loads four courts, rental paddles and sample Open Play and coaching sessions. Later launches keep what you saved. The console may print a Node.js SQLite experimental warning. The app can still start.

To choose or reset a local staff password, copy `.env.example` to `.env` and add `STAFF_PASSWORD` with your own value. Optional settings include `STAFF_USERNAME` and `PORT`. Keep `.env`, `.dev.vars`, and `data/` private. The default server listens on your own PC only.

## What you can do

- **Player.** Switch between Book a court, Open Play, and Coaching. Select multiple court hours on one date, add rental paddles, submit a request, and check its status by reference and mobile. Session cards show availability and offer a waitlist when full.
- **Staff.** Choose a date and open Agenda, Sessions, History, Settings, or Reports. Confirm, decline, or cancel whole booking requests, create manual bookings and court blocks, publish sessions, manage a roster, edit the venue and each court’s hours or prices, or see counts and total confirmed quoted value.
- **Booking updates.** Open Check booking status for a compact panel with the latest decision, reason, and Cebu timestamp. A pending change shows the original and proposed times together. Players can accept, decline an offer, or suggest another time. Staff can see recorded actions under History.
- **Live player alerts.** After you book or check an existing reference, keep Player open in that browser. Approval, decline, and proposed changes appear as small colored popups, even with the status panel closed. **View details** opens the related booking. Stop alerts from the status panel at any time.
- **Staff calendar.** Switch between Agenda list and Calendar grid. Filter by time of day and select a private booking in the grid to jump to its request card.
- **Design.** The Figma prototype guides the Player and Staff navigation and booking steps. This project uses an original floodlit, empty blue-court image, larger desktop labels, quiet hover lift, a phone layout, and reduced-motion support. Staff layout follows the written assessment because the live prototype’s Staff view was unavailable during implementation. Paddle rental is the quantity-based equipment option.

## Where to study the code

| File | What it does |
| --- | --- |
| [public/index.html](public/index.html) | Page shell, Player and Staff links, and shared dialog container |
| [public/style.css](public/style.css) | Blue theme, layouts, readable type, hover and keyboard feedback, and phone breakpoints |
| [public/app.js](public/app.js) | Player date and court selection, quote, status lookup, and session signup |
| [public/staff.js](public/staff.js) | Sign-in, agenda, requests, roster, settings and reports |
| [public/shared.js](public/shared.js) | Browser formatting, escaped text, dialog and API helpers |
| [public/booking-updates.js](public/booking-updates.js) | Compact status panel, live refresh, and shared reschedule form |
| [public/booking-alerts.js](public/booking-alerts.js) | Same-browser popup reminders and lookup links |
| [public/manifest.webmanifest](public/manifest.webmanifest) and [public/service-worker.js](public/service-worker.js) | Install information, icon paths and offline page |
| [api.mjs](api.mjs) | HTTP routes, basic rate limits, and staff authorization |
| [store.mjs](store.mjs) | Conflict checking, repricing, session capacity, and all-or-nothing writes |
| [schema.sql](schema.sql) | Tables, indexes, constraints and relationships |
| [seed.mjs](seed.mjs) | Sample venue, court pricing, equipment, sessions, and the local staff account |
| [server.mjs](server.mjs) | Local Windows entry point using Node.js and SQLite |
| [worker.mjs](worker.mjs) and [wrangler.toml](wrangler.toml) | Cloudflare Worker and SQLite-backed Durable Object |
| [booking.test.mjs](booking.test.mjs) | Automated checks with real HTTP calls and a disposable SQLite database |

## How a booking travels through the app

1. In `public/app.js`, follow `submitBooking`. The browser sends the selected hours, displayed quote and player details to `/api/bookings`.
2. In `api.mjs`, the route calls `saveBooking` in `store.mjs`. The server takes a write lock, reads the shared schedule, and rechecks every slot, paddle quantity and price.
3. The server writes one booking row and its child slot rows in the same transaction. Each slot stores its quoted rate. If any check fails, the transaction leaves every slot unbooked by that request.
4. Staff sign in and confirm the request through a protected route. The player uses the same reference and phone number to read the new status.

## Booking rules and assumptions

- Private slots are one hour. Two items can touch at their start or end without overlapping. Pending and confirmed bookings, published sessions, and staff blocks all occupy time. The app disables hours as soon as they start.
- Selecting a new date clears the draft slots and equipment with a visible message. Quarter-hour and other partial hours are supported for staff blocks and group sessions. Staff use whole hours for private bookings. Sessions and blocks must finish within the same Cebu date, with midnight allowed as the day’s end.
- Paddle stock is shared across courts for overlapping hours. A quantity applies to the request, and the paddle fee is charged once per item. A stale quote requires player review and resubmission. Submitted totals and slot rates stay fixed.
- Pending, confirmed, and checked-in session registrations count toward capacity. A waitlisted player can be promoted when a spot opens. A private lesson has capacity one. A phone number can have one active registration per session.
- Mobile numbers use Philippine mobile formats. A local 09 number and its +63 form refer to the same player contact.
- Staff enter a player-facing reason when declining a court or session request. A reschedule changes a private booking’s date or hours once the other side accepts and the new slots are available. The original hours stay reserved until that point. A proposal keeps the original number of hours, rental quantity, quoted total and reference. Declining the offer keeps the original booking status.
- Player updates refresh every 20 seconds while the status panel is open and visible. Booking activity is visible by reference and mobile. Staff History is organized by the Cebu date of the action, which can differ from the booking date. History begins with actions recorded after this update.
- Popups check about every 12 seconds while a Player page is visible. One check covers the latest updates for up to 12 remembered bookings. The browser stores signed links with a 30-day lifetime. A reference and mobile lookup can renew the link.
- A court settings change applies to new requests. Existing reservations stay on the agenda. Reports count private requests rather than individual hours, and confirmed quoted value is the stored total including any rental charge.
- The site is a single-venue assessment demo. It has no payment provider, email delivery, or public player accounts. Local and hosted data are stored in separate databases.

## Run the assessment tests

```
npm.cmd test
```

The suite covers the original booking flows plus decline reasons, reschedule agreement, scheduling conflicts, Staff History, installation files and persistence. The main flows also passed in Chrome at desktop and simulated phone sizes. The update was tested in Cloudflare’s local runtime against an existing database. See [DEMO.md](DEMO.md) for the walkthrough and results.

## Install the app

- **Windows.** Open the app in Edge or Chrome and use the browser’s install option. The app footer also shows Install app when the browser offers an install prompt.
- **Android.** Open the hosted HTTPS link in Chrome, then tap Install app or Add to Home screen in the browser menu.
- **iPhone.** Open the hosted link in Safari. Use Share, Add to Home Screen, then Open as Web App.

The Windows localhost link works for testing on the same PC. Phones need the deployed HTTPS link to install and sync. Reconnect to load bookings when the offline screen appears. [MDN web app installation guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Installing)

## Optional Cloudflare deployment on the free plan

For the manual, browser-only setup, see [CLOUDFLARE.md](CLOUDFLARE.md). The app uses one SQLite-backed Durable Object. Images, scripts and install files are served as static assets. Live checks are grouped and pause when the Player tab is hidden. Cloudflare lists up to 100,000 Durable Object requests and 100,000 database row writes daily on Workers Free. Use the Workers Free plan and synthetic demo data. [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

1. Open PowerShell in this project folder. Sign in to your free Cloudflare account when a browser opens.

   ```
   npx.cmd wrangler@4.166.0 login
   ```

2. Deploy. The command prints the `workers.dev` link. If Cloudflare asks for a Workers subdomain, choose one in the dashboard. If the Worker name is taken in your account, update the `name` field in `wrangler.toml` before deploying.

   ```
   npm.cmd run cloud:deploy
   ```

3. Set the Staff password when Wrangler prompts you. Use a fresh password of at least 16 characters. The username is `staff` by default. Share demo staff access privately with the reviewer.

   ```
   npx.cmd wrangler@4.166.0 secret put STAFF_PASSWORD
   ```

4. Open the public link, submit a test request with made-up player details, sign in as staff, and confirm the request. Check lookup in a second browser window. Share the public link after this check.

Local Cloudflare preview is available with `npm.cmd run cloud:dev`. For staff access in that preview, set a distinct test password in an ignored `.dev.vars` file. Demo records in that emulator are separate from production and the Windows database. If npm reports a missing Windows `workerd` package, retry the install with optional dependencies enabled and an active internet connection.

## Submission

Share a GitHub repository the reviewer can access. Include a short recording or offer a live walkthrough, plus your test results. Provide the local setup above or the deployed URL. Before sending, make sure your Git commit excludes `.env`, local database files, test recordings containing any credentials, and real player details. See [DEMO.md](DEMO.md) for a recording checklist and order.
