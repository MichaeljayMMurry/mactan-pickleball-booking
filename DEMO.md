# Demo and Test Walkthrough

## What demo means

The demo is a short recording of the app working. You can record it on your PC with your browser open to the local app. If you deploy it, add the online app link as well. The reviewer needs a GitHub repository they can access either way.

The supplied `mactan-booking-demo.webm` is a 36-second recording of the current app with fictional names and numbers. Open it in Chrome or Edge. It shows a ₱980 private booking, confirmation from the Staff calendar grid, the Player approval popup and booking details, a one-spot session with a waitlist, and a rejected conflicting booking.

## Set up once

1. Run `npm.cmd start` in the project folder and open `http://127.0.0.1:3000/`.
2. Open **Player** and **Staff** in two tabs. Sign in on the Staff tab before recording to keep the password out of the video.
3. Use fictional names and mobile numbers such as `09170000001` and `09170000002`. Choose future dates to avoid disabled past slots.
4. Open the Windows Snipping Tool, choose **Record**, select the browser area, and start. Save the recording as MP4 when you finish. [Microsoft screen recording instructions](https://www.microsoft.com/en-us/windows/learning-center/how-to-record-screen-windows-11)

## What to show in the recording

1. **Player to Staff confirmation.** Pick a Saturday, choose one free hour on Court 1 and one on Court 2, and add a rental paddle. With the original demo prices the total is ₱980. Submit and show the Pending reference. In the Staff agenda choose the same date, confirm the request, then look it up in Player and show Confirmed.
2. **Full session and waitlist.** In Staff → Sessions, create a future **Open Play** session on a free court with capacity **1**. In Player → Open Play, select that date and request the only spot with the first mobile number. Join its waitlist with a different number. If time allows, release the first spot in Staff and promote the second player.
3. **Rejected scheduling conflict.** In the Staff agenda, select the date from step 1. Click **Add booking**, pick one of the hours you already confirmed, and submit. Show the message rejecting the conflict.
4. **Mobile view.** If time allows, use Chrome or Edge’s device view to show the responsive booking screen and the jump link to the review.

## Test results

Run `npm.cmd test` for the current automated results. The Windows suite passed eleven tests covering the server and database scenarios below.

| Check | Automated Windows result |
| --- | --- |
| App entry points and asset responses | Passed |
| Multi-court quote, confirmation, quote review, and saved rate | Passed |
| Competing requests, no partial save, cancellation and decline | Passed |
| Shared equipment stock | Passed |
| Full session, duplicate rejection, check-in, release and promotion | Passed |
| Coaching capacity, court hours, cross-origin and staff access | Passed |
| Decline reason, actor, time, original booking details, and history | Passed |
| Accepting, declining and countering proposals while preserving bookings and price | Passed |
| Install manifest, icon dimensions, service worker, and private-data cache headers | Passed |
| Signed player alerts, forged links, and alert access after restarting the server | Passed |
| Booking lookup after a server restart | Passed |

Chrome browser checks passed at 1280 × 800 on desktop and 390 × 844 in simulated touch mode. The desktop check covered court switching, the three Open Play filters, player-to-staff confirmation and lookup, the waitlist, and a scheduling conflict. The phone-size check covered the staff sign-in gate, booking review shortcut, request submission, refresh and horizontal overflow. Cloudflare’s local runtime separately passed routes and assets, database setup, concurrent booking conflict, staff login, confirmation and player lookup.

## Try the booking update

1. Open the Player page and sign in to Staff in a second tab. Book two future times as separate requests and keep both references.
2. In Staff, choose the booking date. Decline the first request and enter a reason. In Player, select Check booking status and enter its reference and mobile number. The compact red card shows who declined it, when, and why.
3. For the second request, choose Propose new time in Staff. Choose a date and add a new time, then send it. Look up this request in Player. The yellow card shows the original and proposed times. Try Accept new time, Decline offer, or Suggest another time.
4. Open Staff History. Use the date you performed the actions to see the decline, proposal or change. The Player status panel refreshes while it is visible.

The new flow passed a 390-pixel Chrome touch simulation with a separate Staff window. Chrome also reported that the app met its install criteria and displayed the offline screen with the connection off. Cloudflare’s local runtime upgraded an existing database, retained an earlier booking, and passed decline, reschedule, history and install-asset checks.

## Try a live popup

1. Submit a future booking on Player and close the receipt. Keep Player open in one window and Staff in another.
2. In Staff, choose the booking date and confirm the request. Return to Player and wait a few seconds. A green Booking approved popup should appear with **View details**.
3. Decline a different pending booking to test the red popup and reason. Propose a new time on a third booking to test the yellow popup.
4. In Staff, open **Calendar grid**, choose Morning or Afternoon, and click a booking to jump to its request card.

Chrome checks passed for all three popups with the status panel closed, saved alerts across a page reload, phone checkout, and Staff grid navigation. The new alert endpoint and database upgrade also passed in Cloudflare’s local runtime.
