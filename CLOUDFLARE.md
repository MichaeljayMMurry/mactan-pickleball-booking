# Put Mactan Pickleball Online for Free

Try the update on your PC first. When you’re happy with it, use the Cloudflare dashboard to connect the project’s GitHub repository. Keep the account on Workers Free. The app includes its own SQLite database setup and comes with sample courts. [Cloudflare Workers Builds limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/) · [Cloudflare database limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)

## 1 Upload the project files to GitHub

1. Extract the latest project ZIP.
2. Create a GitHub repository and upload the **files inside** the extracted `pickleball-booking` folder. At the top of your GitHub repo, you should see `wrangler.toml`, `worker.mjs`, `package.json` and the `public` folder.
3. Keep the project’s private files, including `.env` and the local `data` folder, on your PC. The ZIP already excludes them. Give the assessment reviewer access to the repository when you submit it.

## 2 Connect the repository in Cloudflare

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/), then choose **Workers & Pages**.
2. Choose **Create application**, then **GitHub**. Allow Cloudflare to access the project repository and select it.
3. Check these settings before clicking **Save and Deploy**.

   | Setting | What to use |
   | --- | --- |
   | Worker name | `mactan-pickleball-booking`, matching `wrangler.toml` |
   | Production branch | Your GitHub branch, normally `main` |
   | Root directory | Repository root, normally the default |
   | Build command | Leave blank |
   | Deploy command | `npm run cloud:deploy` |

4. If asked, choose a free `workers.dev` subdomain. Open the app link shown on the Worker’s page after deployment. [Cloudflare guide to connecting a GitHub repository](https://developers.cloudflare.com/workers/ci-cd/builds/)

## 3 Set your online Staff login

1. Open your Worker in the dashboard. Go to **Settings → Variables and Secrets → Add**.
2. Choose **Secret** for the type. Enter `STAFF_PASSWORD` as the name and choose a fresh password at least 16 characters long. Click **Deploy** to save it.
3. Go to your online app and select **Staff**. Use username `staff` and the password you just set. Share reviewer credentials privately when requested. [Cloudflare guide to adding a secret](https://developers.cloudflare.com/workers/configuration/secrets/)

## 4 Try the real link before you share it

Open the `workers.dev` link in a second browser or on your phone. Book a future time with fictional details. In Staff, decline the request or offer a new time. Look it up in Player and confirm that the update and reason appear. Try installing from Chrome on Android or Edge on Windows. On iPhone, use Safari’s Share menu and choose Add to Home Screen.

The online demo has its own bookings. Your PC’s test bookings stay in its local database. For submission, share the GitHub repository, the recording or walkthrough, and the online link if you chose to deploy.
