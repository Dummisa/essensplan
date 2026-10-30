# Essensplan

A small web app to plan who cooks and who eats on which day. It is built mainly for phones and also works on desktop.

- **Website:** `public/` (plain HTML/CSS/JS, hosted on Firebase Hosting)
- **Database:** Firestore (rules in `firestore.rules`)
- **Backend:** `functions/` (Cloud Functions)
  - warning emails, 5 minutes delayed and batched
  - reminder emails, 2 hours before for cooks and 1 hour before for eaters
  - the calendar subscription feed
  - an automatic cost brake
- **Emails:** sent through the Gmail account `hufristv@gmail.com`

---

## One-time setup

This takes about 30–45 minutes. Follow the steps in this order.

### 1. What you need

A Google account for Firebase, and the GitHub account with this repo. Everything else happens in the browser. No tools on your computer are needed, because GitHub deploys automatically (step 7).

### 2. Create the Firebase project

1. Go to <https://console.firebase.google.com> and create a new project, e.g. `essensplan`. Google Analytics is not needed.
   - Note the **project ID** that is shown, e.g. `essensplan-1a2b3`.
2. **Firestore:** go to *Build → Firestore Database → Create database*.
   - Choose **Production mode**.
   - Choose location **`europe-west6` (Zürich)**.
   - ⚠️ The location cannot be changed later, and the code expects Zürich. If you choose a different location, change `REGION` in `functions/index.js` and the `region` value in `firebase.json` to match.
3. **Authentication:** go to *Build → Authentication → Get started → Sign-in method*.
   - Enable **Anonymous**.
   - This is only used so that each device gets a technical ID. People still "log in" with just their name.
4. **Web app:** go to *Project settings (gear icon) → General → Your apps* and click the **</>** (web) icon.
   - Register the app. Firebase Hosting setup is not needed here.
   - Copy the values of the `firebaseConfig` object into **`public/firebase-config.js`**.
5. Put your project ID into **`.firebaserc`**, replacing `DEIN-PROJEKT`.

### 3. Switch to the Blaze plan

Emails, the timer and the calendar feed need Cloud Functions, and those only run on the **Blaze** (pay-as-you-go) plan.

In the Firebase console, click **Upgrade** at the bottom left and add a billing account with a credit card. At this usage it stays within the free allowances, so it is expected to cost **0**. Step 4 makes sure it can never cost more than a few dollars.

### 4. Cost limits (please do not skip)

There are three layers of protection. Layer C is already built into the code.

**A – Spend cap for Cloud Functions (pauses, nothing is lost)**

1. In the Firebase console, go to *Project overview → Usage and billing → Details & settings → Budgets & alerts*. The menu may be named slightly differently.
2. Create a budget of type **spend cap** for **Cloud Functions** with an amount of **3 USD**.
3. When it is reached, the functions pause until the end of the month. The website itself keeps working; only emails and the calendar feed stop.

**B – Emergency brake for the whole project (hard limit)**

This switches billing off for the project if total costs reach 5 USD. Google's cost data arrives with a delay of a few hours, so the 5 USD leaves a buffer to stay safely below 10 USD.

> ⚠️ **Trade-off:** If the brake ever triggers, *everything* stops: the website, the database and emails. Google warns that resources *may* be deleted when billing is removed. With the limits in layer C this should never happen. It is purely a safety net against a technical mistake. If you would rather risk a few dollars than any data, skip layer B and keep only A + C + the email alert.

1. Enable the **Cloud Billing API** for your project: <https://console.cloud.google.com/apis/library/cloudbilling.googleapis.com>. Select your project at the top first.
2. Go to <https://console.cloud.google.com/billing>, choose your billing account, then *Budgets & alerts → Create budget*.
   - **Scope:** only your Essensplan project, all services.
   - **Amount:** specified amount, **5** (in the currency of your billing account).
   - **Thresholds:** 50 %, 90 %, 100 %. You also get emails at each threshold.
   - Under *Manage notifications*, tick **"Connect a Pub/Sub topic to this budget"**. Choose your project and **create a topic** named exactly **`budget-alerts`**.
3. *After the first deploy* (step 7), the brake function needs permission to switch billing off:
   - In the billing console, go to *Account management → Add principal*.
   - **Principal:** `PROJECTNUMBER-compute@developer.gserviceaccount.com`. You find the project number in the Firebase project settings.
   - **Role:** **Billing Account Administrator**.

**C – Built into the code**

- Only one function instance can run at a time.
- At most 80 emails per day.
- The website only ever loads one week at a time.
- The database rules limit the size of every entry.

### 5. Gmail app password

1. Log in to **hufristv@gmail.com** and enable **2-Step Verification** under <https://myaccount.google.com/security>. App passwords require it.
2. Open <https://myaccount.google.com/apppasswords> and create an app password named `Essensplan`. Google shows a **16-character code**.
3. Store the code as a secret. This works entirely in the browser; you don't need the project files for it:
   - Open <https://console.cloud.google.com/security/secret-manager> and select your Essensplan project at the top. If asked, click **Enable** for the Secret Manager API.
   - Click **Create secret**.
   - **Name:** exactly `GMAIL_APP_PASSWORD`
   - **Secret value:** paste the 16-character code (spaces don't matter).
   - Leave everything else as it is and click **Create secret**.

   The code is stored in Google Secret Manager, never in the code or on GitHub. On the first deploy, Firebase automatically gives the functions permission to read it.

   *Alternative with a terminal (any folder):* `firebase functions:secrets:set GMAIL_APP_PASSWORD --project PROJECT-ID`

### 6. Fill in the configuration on GitHub

On the GitHub website, edit `public/firebase-config.js` and `.firebaserc` with the values from step 2. ✅ Already done.

### 7. Connect GitHub to Firebase (automatic deploy)

From now on, every change on GitHub goes live by itself: GitHub runs the tests and then publishes the website, database rules and backend. This needs a "deploy key" once.

**a) Create a service account for GitHub**

1. Open <https://console.cloud.google.com/iam-admin/serviceaccounts?project=essensplan-8728b>.
2. Click **Create service account**.
   - **Name:** `github-deploy`, then **Create and continue**.
3. Under *Grant this service account access to project*, add these roles one by one (**Add another role**):
   - **Editor**
   - **Firebase Admin**
   - **Cloud Functions Admin**
   - **Cloud Run Admin**
   - **Secret Manager Admin**
   - **Service Account User**
4. Click **Continue**, then **Done**.

**b) Create a key**

1. In the list, click `github-deploy@…`, then the **Keys** tab.
2. Click *Add key → Create new key → JSON → Create*. A `.json` file is downloaded.
3. If you get "Key creation is disabled", your account belongs to an organization that blocks keys. Tell Claude and we'll switch to another method.

**c) Store the key on GitHub**

1. In your repo, go to *Settings → Secrets and variables → Actions → New repository secret*.
2. **Name:** `FIREBASE_SERVICE_ACCOUNT`
3. **Secret:** open the downloaded `.json` file with a text editor and paste its **entire** content.
4. Click **Add secret**, then **delete the downloaded file** from your computer. Anyone holding it could change your Firebase project.

**d) First deploy**

1. In your repo, go to the **Actions** tab → **Deploy** → **Run workflow** → **Run workflow**.
2. After 5–10 minutes the run should show a green check. Click the run to see the progress.
3. If it fails with an **Eventarc / permission** error for `onMealWrite`, wait 5 minutes, then click **Re-run jobs**. This is a known first-time hiccup.
4. If it fails with another **permission** error, the message names the missing role. Add it to `github-deploy` (step a) and re-run.
5. Then complete step 4B.3 (the permission for the brake function).

The app is now live at **<https://essensplan-8728b.web.app>**.

### 8. Try it out

1. Open the site on your phone and register with your name and email.
2. In Safari, use *Share → Add to Home Screen*. In Chrome on Android, use *⋮ → Add to Home screen*. It then opens like an app.
3. Tap your name at the top → *Kalender abonnieren* → *Im Kalender öffnen*.
4. To test the warning emails, you need a second person (or a second device, or a private browser window):
   - Cook a meal at least 5 minutes before the other person joins as an eater.
   - About 5 minutes after the change you should get an email. Check the spam folder the first time and mark it "not spam".

---

## Making changes later

Edit any file on the GitHub website and commit. A few minutes later the change is live.

- Progress and errors are shown in the **Actions** tab. A red ✗ means nothing was published, and the live app stays as before.
- If the tests fail, the deploy is skipped automatically.

**Deploying from a terminal (optional)**

If you ever have the project on a computer or in Google Cloud Shell, you can also deploy by hand:

```bash
git clone https://github.com/Dummisa/essensplan.git && cd essensplan
cd functions && npm install && npm test && cd ..
npx firebase-tools login
npx firebase-tools deploy
```

## How the app behaves

**Colors**
- Yellow: nobody is signed up.
- Green: at least one cook.
- Red: someone eats but nobody cooks.

**Buttons**
- The cook button signs you up as cook *and* eater.
- Pressing it again removes you only as cook.
- The eat button only adds or removes you as eater.

**Removing people**
- You can remove yourself and the guests you added with **+**.
- Anyone can remove people who signed up as a guest without an account.

**Time and "Was gibt es?"**
- Only the cooks can change these.
- If a guest is cooking, everyone can change them.

**Past meals**
- These are read-only.
- In earlier weeks (the archive), empty boxes can be deleted.

**Login**
- Name or email, no password. The device stays logged in.
- Guests type their name once, and the device remembers it.

**Warning emails**
- These go only to registered people with an email address. They are sent 5 minutes after the *last* change, or at the latest 30 minutes after the first one, so misclicks that are undone don't cause emails.
- **To cooks:** when eaters join or leave. This only applies if the cook had already been signed up for more than 5 minutes, so planning together doesn't trigger emails.
- **To eaters:** when the last cook leaves.

**Reminders**
- These are optional and off by default, and can be turned on in the account menu.
- Cooks get one 2 hours before the meal, eaters 1 hour before.
- Someone who is both cook and eater only gets the cook reminder.

**Calendar**
- Each person has a private link that shows the meals where they cook or eat.
- Apple Calendar refreshes within about 15 minutes to an hour.
- Google Calendar only refreshes every few hours, and this can't be changed.

**Privacy note:** Anyone who opens the website can see the names, and technically also the email addresses and calendar links, of everyone registered. That is the trade-off for logging in without passwords, which is fine for a small, trusted group. Don't share the website address publicly.

## Troubleshooting

- **No emails arriving:**
  - Open <https://console.cloud.google.com/logs/query?project=essensplan-8728b> and look for "E-Mail gesendet" or errors.
  - Check the spam folder.
  - If the app password was revoked, create a new one and add it as a **new version** of the secret `GMAIL_APP_PASSWORD` in the Secret Manager. Then re-run the last deploy in the Actions tab.
- **"Noch nicht eingerichtet"** on the website: `public/firebase-config.js` still has the placeholder values.
- **"Verbindung fehlgeschlagen":** Anonymous sign-in is not enabled (step 2.3).
- **Calendar link gives "Nicht gefunden":** the link is outdated. Copy it again from the account menu.
- **The website stopped working completely:** check whether the emergency brake (4B) triggered. You received budget emails, and billing is off in the console. Re-enable billing for the project in the Google Cloud console, then investigate the logs.
