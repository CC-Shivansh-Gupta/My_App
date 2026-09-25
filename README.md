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
- **Notes**: quick notes with search and pinning. Lines like `[ ] milk` become tickable checklists, and I can dictate a note by voice.
- **Voice assistant**: tap the mic (or press V) and speak. It understands things like "remind me to call the bank tomorrow", "spent 250 on lunch", "schedule dentist Friday at 3 pm", "I meditated", "start push workout", "log my weight 72.5", "set a goal to read 24 books this year", "add task book flights under trip heading", "note: gate code 4512", "what's on tomorrow?", "how much did I spend this month?" and "brief me". It answers out loud. Commands are understood on the device (`app/js/intents.js`), so there's no paid AI service. If a browser has no speech recognition, you can type a command or use the keyboard's 🎤.
- **News**: papers, job posts and articles pulled every 3 hours from the feeds in [`news/sources.json`](news/sources.json) and ranked by my interest keywords. One tap saves an item to the reading list.

### Adding things with minimal effort
- The **+** button (or pressing **N** on a keyboard) opens quick add, which understands plain language:
  - `Dentist tomorrow 3pm` · `Standup mon 9-9:30am` · `Call mom fri at 6:30pm`
  - `Finish report sep 30 !high #work` (priority and tag)
  - `250 lunch` · `1200 groceries yesterday`
  - `Deep Work by Cal Newport`
- Each section also has an inline box: type and press Enter.
- Deleting shows an **Undo** toast instead of an "are you sure?" dialog.
- Keyboard shortcuts on a laptop: `N` add, `V` voice, `T` Today, `C` Calendar, `K` Tasks, `H` Habits, `G` Goals, `Y` Gym, `M` Money, `O` Notes, `R` Reading, `W` News.
- On a phone you choose which five sections sit in the bottom bar (Settings → Bottom bar). The rest are under More.

## How it runs everywhere for free

| Piece | How | Cost |
|---|---|---|
| App | A Progressive Web App (plain HTML/CSS/JS, no build step), installable on iPad, Android and laptop, and works offline | free |
| Hosting | GitHub Pages | free for public repos |
| Sync between devices | Each device merges its data with a **secret GitHub Gist** on my account (newest edit per item wins) | free |
| News polling | A scheduled GitHub Action fetches the feeds every 3 hours and publishes `data/news.json` with the site | free for public repos |

My data never goes into this repo. It stays in each device's storage and in my secret gist, so the repo can stay public.

## One-time setup

1. **Turn on GitHub Pages:** in the repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Deploy:** merge to the default branch (or run the **Deploy** workflow from the Actions tab). The app is then live at `https://<username>.github.io/<repo>/`.
3. **Install it on each device:**
   - **iPad / iPhone:** open the URL in Safari → Share → **Add to Home Screen**.
   - **Android:** open it in Chrome → ⋮ → **Install app**.
   - **Laptop:** open it in Chrome or Edge → click the install icon in the address bar. (On a Mac with Safari: File → **Add to Dock**.)
4. **Turn on sync:** create a [classic token with only the `gist` scope](https://github.com/settings/tokens/new?scopes=gist&description=Daybook%20sync) and set it to no expiration. In the app go to **Settings → Sync** and paste the token, then do the same on each device. The first device creates the gist and the others find it automatically.

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
news/sources.json        feeds to poll
.github/workflows/deploy.yml   test → build (+ news) → deploy to Pages, every push and every 3h
```

### Notes and limits
- GitHub disables scheduled workflows after 60 days with no repo activity. If news stops updating, click **Enable workflow** on the Actions tab (GitHub sends an email first).
- Sync resolves conflicts per item: if the same item is edited on two devices while offline, the later edit wins.
- There are no push notifications or reminders yet. Those would need a server.
