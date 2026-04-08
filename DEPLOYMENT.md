# Hour Golf Dashboard — Deployment Guide

This walks you through migrating from the single HTML file to the Next.js project with Stripe integration.

---

## Step 1: Create the payments table in Supabase

1. Go to your Supabase dashboard → **SQL Editor** (left sidebar, looks like a terminal icon)
2. Click **New Query**
3. Paste the entire contents of `supabase-setup.sql` into the editor
4. Click **Run** (or Ctrl/Cmd + Enter)
5. You should see "Success" — this creates the `payments` table

To verify: go to **Table Editor** in the left sidebar. You should now see `payments` listed alongside `bookings`, `members`, `monthly_usage`, and `tier_config`.

---

## Step 2: Replace your GitHub repo contents

You're replacing the single `index.html` with the full project. Two options:

### Option A: Replace files in GitHub directly (easiest)

1. Go to your repo on GitHub
2. Delete the old `index.html` file (click the file → click the trash icon → commit)
3. Click **Add file → Upload files**
4. Upload ALL of these files/folders from the project:
   - `package.json`
   - `next.config.js`
   - `.gitignore`
   - `public/` folder (contains `index.html`)
   - `pages/` folder (contains `api/stripe-charge.js` and `api/stripe-lookup.js`)
5. Commit the changes

### Option B: Use Git on your computer (if you're comfortable)

```bash
cd your-repo-folder
# Remove old file
rm index.html
# Copy in new project files (from wherever you downloaded them)
cp -r hour-golf-dashboard/* .
cp hour-golf-dashboard/.gitignore .
git add .
git commit -m "Migrate to Next.js with Stripe integration"
git push
```

---

## Step 3: Update Vercel settings

1. Go to [vercel.com](https://vercel.com) → your project
2. Click **Settings** (top nav)
3. Under **General → Framework Preset**, change it to **Next.js** (it was probably set to "Other" before)
4. Leave **Root Directory** blank
5. Click **Save**

---

## Step 4: Add environment variables in Vercel

Still in Vercel Settings:

1. Click **Environment Variables** in the left sidebar
2. Add these three variables (all environments: Production, Preview, Development):

| Name | Value |
|------|-------|
| `STRIPE_SECRET_KEY` | Your Stripe **test** secret key (starts with `sk_test_`) |
| `SUPABASE_ANON_KEY` | Your Supabase anon key (starts with `eyJ...` — same one you use to log into the dashboard) |

3. Click **Save** for each one

---

## Step 5: Redeploy

1. Go to your Vercel project → **Deployments** tab
2. Find the latest deployment → click the **⋮** menu → **Redeploy**
3. Wait for it to build (should take ~30 seconds)
4. Visit your site — you should see the same dashboard as before

---

## Step 6: Test Stripe (in test mode)

1. Open the dashboard → go to **Tier Config** tab
2. Find a member without a Stripe ID → click **Link Stripe**
   - This searches Stripe by email and auto-fills the `stripe_customer_id`
3. Go to that member's **detail view** → Monthly Breakdown
4. If they have an overage, you'll see a **Charge $X.XX** button
5. Click it → confirm → it will charge the test card on file

You can verify in your Stripe Dashboard → Payments that the test charge went through.

---

## Step 7: Go live

Once everything works in test mode:

1. In Vercel → Settings → Environment Variables
2. Change `STRIPE_SECRET_KEY` to your **live** key (starts with `sk_live_`)
3. Redeploy

That's it. Real charges, real money.

---

## Troubleshooting

**"Connection failed" on dashboard login**
→ Your Supabase anon key is wrong or expired. Check Supabase → Settings → API.

**"Link Stripe" says "No customer found"**
→ The email in your members table doesn't match the email in Stripe. Check the customer's email in both systems.

**"No payment method on file"**
→ The Stripe customer exists but has no saved card. They'll need to make a booking through Skedda first (which saves their card).

**"Charge failed: 401 Unauthorized"**
→ The `SUPABASE_ANON_KEY` environment variable in Vercel doesn't match. Re-check it.

**404 error after deploy**
→ Make sure the Framework Preset in Vercel is set to "Next.js", not "Other".
