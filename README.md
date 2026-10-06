# Reservvakt – Båtklubben

A small booking calendar for backup guard shifts at the boat club.

- **Members** open the site link. Grey dates are closed, red dates are available. Clicking a red date and entering a 4-digit member number books it. First come, first served. Booked dates show as "Bokad" without the number.
- **Admin** opens `/admin` and logs in with a 4-digit code. Click a grey date to open it (it turns red), optionally with a note such as "22:00–06:00". Click a red or booked date to edit the note, cancel the booking, or close the date again. The admin sees member numbers in the calendar and in a monthly list below it.

Built with Node.js + Express, plain HTML/CSS/JS, and Postgres (Neon).

---

## Deploy: GitHub → Neon → Render

### 1. Put the code on GitHub
Create a new repository and upload all files in this folder (everything except `node_modules`, which is already ignored).

```bash
git init
git add .
git commit -m "Reservvakt calendar"
git branch -M main
git remote add origin https://github.com/<you>/batklubb-vakt.git
git push -u origin main
```

### 2. Create the database on Neon (free)
1. Sign up at [neon.tech](https://neon.tech) and create a project (pick region **Europe (Frankfurt)**).
2. On the project dashboard, click **Connect** and copy the connection string. It looks like
   `postgresql://user:password@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`

The app creates its table automatically on first start.

### 3. Create the web service on Render
1. In Render, choose **New → Web Service** and pick your GitHub repo.
2. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
3. Under **Environment**, add:

| Key | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `ADMIN_CODE` | your 4-digit admin code, e.g. `5821` |
| `SESSION_SECRET` | any long random text (just mash the keyboard) |

4. Click **Create Web Service**. When it's live you get a URL like `https://batklubb-vakt.onrender.com`.

(Alternatively use **New → Blueprint**; the included `render.yaml` sets everything up and asks for `DATABASE_URL` and `ADMIN_CODE`.)

### 4. Share it
- Members: `https://<your-app>.onrender.com`
- Admin: `https://<your-app>.onrender.com/admin`

---

## Good to know

- **Free Render sleeps.** After about 15 minutes without visitors the app goes to sleep, and the next visit takes roughly 30–60 seconds to load. Bookings are safe in Neon, so nothing is lost.
- **Member numbers aren't checked against a member list.** Any 4 digits are accepted. The admin sees the number and can cancel a booking if it looks wrong.
- **Protection against guessing.** The admin login locks for 15 minutes after 5 wrong codes, and bookings are limited to 10 attempts per 10 minutes per device/network.
- **Changing the admin code:** change `ADMIN_CODE` in Render. This also logs out anyone currently logged in.
- Admin logins last 12 hours or until the browser tab is closed.
- Past dates can't be booked. Dates and "today" use Swedish time.

## Run locally

```bash
npm install
ADMIN_CODE=1234 npm start
```

Open http://localhost:3000 and http://localhost:3000/admin. Without `DATABASE_URL` the app keeps data in memory only (lost on restart), which is fine for trying it out. Add `DATABASE_URL=...` to use Neon locally too.
