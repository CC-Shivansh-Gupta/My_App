# Daybook

My personal all-in-one tracker. **Live at https://cc-shivansh-gupta.github.io/My_App/**

 Everything in one place, built so that adding something takes as little effort as possible.

- **Today**: one screen with today's schedule, to-dos, tasks due, habits to tick, what I spent, what I'm reading, and top news.
- **Calendar**: month view plus a day agenda. Events can repeat (daily, weekdays, weekly, monthly, yearly).
- **To-dos**: a daily list. Anything unfinished carries over, and one tap moves it to today.
- **Tasks**: everything on my plate, grouped under my own **headings** (Work, Home, Trip…), which I can collapse, rename, reorder and drag tasks between. There's also a view by due date. Tasks have tags and priorities, and "Do today" puts a task on today's list.
- **Reading list**: what I'm reading now, what's up next, and what I've finished, with progress, ratings and notes.
- **Habits**: tick the week in a grid, with streaks, a 30-day completion trend and a heatmap per habit.
- **Money**: log an expense in one line ("250 lunch"). The category is guessed for you. Shows a monthly total vs last month, a budget meter, daily and 6-month charts, and a breakdown by category.
- **Goals**: monthly, yearly and life goals. Each one is tracked as done/not done, as milestones, or as a number towards a target ("Read 24 books"). A goal can support a bigger one (month → year → life), and unfinished goals can be carried into the next month.
- **Gym**: a workout logger modelled on Strong. It has routine templates plus example Push/Pull/Legs/Full-body ones, and ~100 built-in exercises plus custom ones. Each set shows what I did last time, and sets can be marked warm-up, drop or failure. A rest timer starts itself after each set, finishing shows a summary with PRs, and there are history, exercise records and charts, a body-weight log and a plate calculator. Finishing a workout ticks an "Exercise" habit automatically.
- **Routine & day tracker**: design your ideal day as time blocks per weekday, or start from a template (balanced workday, weekend, student). You get a live "now / next", a weekly time table, and a tick for each block you actually followed. The **day tracker** records what you really did: tap "Now doing" chips to run a timer, type "9-11 deep work", tap the timeline, or say "I was in meetings from 2 to 4". Ideal and actual sit side by side, and Insights compares hours per category.
- **Learnings**: a "today I learned" journal (insights, life lessons, facts, skills, questions) with topics and sources. A spaced-repetition **Review** brings each learning back at growing intervals so it sticks.
- **Watch list**: movies, shows, documentaries and videos (Watching / Up next / Watched), with platform, episode tracking (+1 ep), ratings and who recommended it.
- **Screen time**: a daily total across phone, iPad and laptop, with a limit, streak and trends. Browsers can't read screen-time data from the operating system, so you copy each device's number in (a Today card in the evening, or say "screen time phone 3 hours").
- **Stats**: life as an RPG. Everything you do earns XP across six attributes (Strength, Intellect, Discipline, Wealth, Wisdom, Spirit), with levels and ranks, daily quests, streaks, 29 achievement badges and a "+XP" pop-up. XP is calculated from your existing data, so past activity counts too.
- **Penalties**: bad days cost XP. That covers missed habits, overdue tasks, to-dos left undone, days over your screen-time limit, months over budget, and **slips on habits you're breaking** (smoking, junk food, doomscrolling… each with its own penalty). Every clean day earns a little back. Severity can be off, gentle, normal or hardcore.
- **Friends**: invite your partner and friends to see each other's level and progress. There's a leaderboard (weekly XP, streaks, workouts, habits, learnings, lowest screen time), a feed with reactions, challenges ("most workouts this week"), and share buttons on books, shows, learnings, notes, goals and workouts, with "add to mine". Only a summary is shared, never money, notes or raw entries.
- **Notes**: quick notes with search and pinning. Lines like `[ ] milk` become tickable checklists, and I can dictate a note by voice.
- **Knowledge map**: an Obsidian-style graph of my second brain. It shows my Obsidian vault, read from its private GitHub repo, together with Daybook's notes, learnings, books, shows and goals. Tap a dot to read the page with its links and backlinks, open it in Obsidian, or **Copy for AI** (the page plus its neighbours, ready to paste into any chatbot). **Send to inbox** drops a thought into the vault's `raw/inbox/`, and **Copy Daybook to vault** writes my learnings, reading, goals and notes to `raw/daybook/` so assistants can ingest them. In notes, `[[Page name]]` makes a link (typing `[[` suggests pages) and tapping it opens the map. Without a vault, the map still shows Daybook's own items.
- **Voice assistant**: tap the mic (or press V) and speak. It understands things like "remind me to call the bank tomorrow", "spent 250 on lunch", "schedule dentist Friday at 3 pm", "I meditated", "start push workout", "log my weight 72.5", "set a goal to read 24 books this year", "add task book flights under trip heading", "note: gate code 4512", "what's on tomorrow?", "how much did I spend this month?" and "brief me". It answers out loud. Commands are understood on the device (`app/js/intents.js`), so there's no paid AI service. If a browser has no speech recognition, you can type a command or use the keyboard's 🎤. Say several things at once ("add task write the report and email John") and each becomes its own item; a **Keep as one** / **Split** button fixes the odd wrong guess. Replies use the most natural voice on the device (you can pick one in Settings). Optional: in Settings → Voice assistant, switch Listening to **Whisper** and paste a free Groq key (or an OpenAI key) for much more accurate transcription that also works in the iPad/iPhone home-screen app; with an OpenAI key you can also pick a natural OpenAI reply voice. The key stays on that device (`app/js/whisper.js`).
- **Agent**: a small team of scheduled jobs that run in my private second-brain repo, for free:
  - **Morning brief** (about 7am): today's events, to-dos, overdue tasks, streaks at risk, budget pace, and goals running out of time.
  - **Evening check-in** (about 9pm): a notification only when something's missing ("Log today's spending? · Screen time? · 2 habits unticked"), plus an offer to move unfinished to-dos to tomorrow.
  - **Weekly review** (Sunday evening): XP, habit rates (best and slipping), workouts and spending against last week, budget and goals, and up to three suggestions for next week.
  - **Vault gardener** (every morning, in second-brain): turns inbox notes into linked wiki pages and opens a pull request for me to review.

  Notifications show counts only, so no titles appear on the lock screen. **Suggestions** wait in an inbox until I approve or dismiss them. For each kind of suggestion I can switch from "Ask me first" to "Just do it" once it has earned that. Every run and decision is logged on the Agent page.

  The Daybook jobs use plain rules. **AI is optional** and off until I switch it on in the Agent page. It can add a short written summary to the brief and weekly review, and find tasks hidden in my notes ("call the bank Friday"). It uses a free key from any OpenAI-compatible provider, with Groq as the default. When it's on, the brief's lines and any recently changed notes are sent to that provider.
- **News**: papers, job posts and articles pulled every 3 hours from the feeds in [`news/sources.json`](news/sources.json) and ranked by my interest keywords. One tap saves an item to the reading list.

### Adding things with minimal effort
- The **+** button (or pressing **N** on a keyboard) opens quick add, which understands plain language:
  - `Dentist tomorrow 3pm` · `Standup mon 9-9:30am` · `Call mom fri at 6:30pm`
  - `Finish report sep 30 !high #work` (priority and tag)
  - `250 lunch` · `1200 groceries yesterday`
  - `Deep Work by Cal Newport`
- Each section also has an inline box: type and press Enter.
- Deleting shows an **Undo** toast instead of an "are you sure?" dialog.
- Keyboard shortcuts on a laptop: `N` add, `V` voice, `T` Today, `C` Calendar, `K` Tasks, `H` Habits, `G` Goals, `Y` Gym, `U` Routine, `M` Money, `O` Notes, `I` Knowledge map, `L` Learnings, `R` Reading, `B` Watch list, `W` News, `S` Stats, `F` Friends, `A` Agent.
- On a phone you choose which five sections sit in the bottom bar (Settings → Bottom bar). The rest are under More.

## How it runs everywhere for free

| Piece | How | Cost |
|---|---|---|
| App | A Progressive Web App (plain HTML/CSS/JS, no build step), installable on iPad, Android and laptop, and works offline | free |
| Hosting | GitHub Pages | free for public repos |
| Sync between devices | Each device merges its data with a **secret GitHub Gist** on my account (newest edit per item wins) | free |
| Agent | Scheduled GitHub Actions in the private `second-brain` repo read and write the same secret gist, and send Web Push notifications themselves, so no server is needed | free (about 90 of the 2,000 free private-repo minutes a month) |
| AI (optional) | Any OpenAI-compatible API; the default is Groq's free tier (no card, and it doesn't keep inference data by default) | free, rate-limited |
| News polling | A scheduled GitHub Action fetches the feeds every 3 hours and publishes `data/news.json` with the site | free for public repos |

My data never goes into this repo. It stays in each device's storage and in my secret gist, so the repo can stay public.

## One-time setup

1. **Turn on GitHub Pages:** in the repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Deploy:** merge to the default branch (or run the **Deploy** workflow from the Actions tab). The app is then live at `https://<username>.github.io/<repo>/`.
3. **Install it on each device:**
   - **iPad / iPhone:** open the URL in Safari or Chrome and tap the **Share** icon (the square with an up arrow). In Chrome it sits at the right end of the address bar. Then pick **Add to Home Screen**. Chrome on iPad has no "Install app" menu item, and it can only add to the Home Screen on iPadOS/iOS 16.4 or later. On older versions, use Safari. Settings → *Install on your devices* shows the steps for whichever device you open it on.
   - **Android:** open it in Chrome → ⋮ → **Install app**.
   - **Laptop:** open it in Chrome or Edge → click the install icon in the address bar. (On a Mac with Safari: File → **Add to Dock**.)
4. **Turn on sync:** create a [classic token with only the `gist` scope](https://github.com/settings/tokens/new?scopes=gist&description=Daybook%20sync) and set it to no expiration. In the app go to **Settings → Sync** and paste the token, then do the same on each device. The first device creates the gist and the others find it automatically.

## Second brain setup (one-time, free)

The vault is a separate private repo (`second-brain`) of plain Markdown that Obsidian syncs to every device with the free **FIT** plugin, and that Claude, ChatGPT/Codex, Gemini/Jules and Copilot can read. Any other chatbot can be given its auto-built `output/context-pack.md`. Its **Start here** page has the full setup for each device and assistant. To show it in Daybook, go to **Knowledge map → Connect your vault** and enter the repo name plus a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with *Contents: Read and write* on that repo only. The token is stored on the device and never synced.

## Agent setup (one-time, free)

The agent's code is in [`agent/`](agent) and [`app/js/agent.js`](app/js/agent.js). It **runs from the private `second-brain` repo** (`.github/workflows/daybook-agent.yml`), so its Actions logs are private too. It only ever prints counts.
1. The workflow runs the agent code from this repo's default branch (the one Pages deploys from), or from the branch, tag or commit set in second-brain's `DAYBOOK_AGENT_REF` repository variable.
2. In **second-brain → Settings → Secrets and variables → Actions**, add a secret `DAYBOOK_GIST_TOKEN` with a `gist`-scope token. It can be the token sync uses, or a separate one, so the agent can be revoked on its own. Optionally, add a variable `DAYBOOK_TZ` (default `Asia/Kolkata`).
3. In second-brain's **Actions** tab, open **Daybook agent** and press **Run workflow** once. On the first run it creates its push keys and keeps them in the sync gist, in a separate `daybook-agent.json` file that the app ignores.
4. In the app, go to **Agent → Turn on for this device** on each device. On iPhone or iPad, open Daybook from its Home Screen icon first (iOS 16.4+).
5. *AI and the gardener (optional):* create a free key at [console.groq.com/keys](https://console.groq.com/keys) and add it to second-brain as the `AI_API_KEY` secret. For another provider, also set the `AI_BASE_URL` variable (for example `https://generativelanguage.googleapis.com/v1beta/openai` for Gemini) and, if you like, `AI_MODEL`. Then switch AI on in **Agent → AI**. For the gardener's pull requests, turn on **second-brain → Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**.

It runs at about 07:00 (01:23 UTC) and 21:00 (15:17 UTC); GitHub often starts scheduled runs a few minutes late. **Run workflow** has a menu to run a single job (morning brief, evening check-in, weekly review or vault gardener). Anyone who can push to this repo's default branch could change code that runs with the gist token. Today that is only me. To lock it down, set `DAYBOOK_AGENT_REF` to a commit SHA. GitHub pauses scheduled workflows in a repo after 60 days without commits, so if the brief stops arriving, check second-brain's Actions tab.

## Friends setup (one-time, free)

Groups use a free Firebase Realtime Database that the group creator owns. Friends don't need to set anything up.
1. At [console.firebase.google.com](https://console.firebase.google.com/), create a project (you can turn Analytics off).
2. Go to Build → Realtime Database → Create database, pick a location, and choose **locked mode**.
3. In the **Rules** tab, paste the rules below and press Publish:
   ```json
   { "rules": { "groups": { "$group": { ".read": true, ".write": true } } } }
   ```
4. In the app, go to **Friends**, add your name, paste the database URL from the Data tab, and press **Create group**.
5. Send the invite link. Whoever opens it adds a name and emoji and is in.

Anyone with the invite link can read and post in that group, so share it only with people you trust. Groups can't be listed, so nobody can find one without its link.

## Customising

- **News sources:** edit [`news/sources.json`](news/sources.json). Any RSS or Atom feed works. Optional per-feed `keywords` filter busy feeds on the server side.
- **Interests** (used to rank news): edit them in the app under News → **Edit interests**. They sync like everything else.
- **Currency, monthly budget, week start, theme, expense categories:** all in Settings.
- **Backups:** Settings → **Export backup** saves a JSON file. **Import** merges a backup back in.

## Development

```sh
npm start        # serves app/ at http://localhost:8080
npm run news     # fetch news into app/data/news.json (for local testing)
npm test         # unit tests (date parsing, sync merge, feed parsing)
npm run icons    # regenerate icons
```

No dependencies are needed apart from Node 20+.

```
app/                 the PWA (index.html, css/, js/, icons/, sw.js, manifest)
  js/store.js        local-first data store and merge logic
  js/sync.js         GitHub Gist sync
  js/dates.js        dates + natural-language parsing
  js/views/*.js      one file per screen
scripts/fetch-news.mjs   feed poller used by the GitHub Action
app/js/agent.js          brief, check-in and weekly review rules; suggestions, approve/dismiss (shared by app and agent)
agent/run.mjs            the scheduled jobs and the "auto" manager that picks them (run from second-brain's Actions)
agent/ai.mjs             optional AI step (any OpenAI-compatible API)
agent/webpush.mjs        Web Push (VAPID + aes128gcm) with node:crypto only
news/sources.json        feeds to poll
.github/workflows/deploy.yml   test → build (+ news) → deploy to Pages, every push and every 3h
```

### Notes and limits
- GitHub disables scheduled workflows after 60 days with no repo activity. If news stops updating, click **Enable workflow** on the Actions tab (GitHub sends an email first).
- Sync resolves conflicts per item: if the same item is edited on two devices while offline, the later edit wins.
- Push notifications come only from the agent (brief, check-in and weekly review). There are no per-event reminders yet.
