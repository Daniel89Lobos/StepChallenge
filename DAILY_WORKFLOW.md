# Daily Workflow (LobosShop)

Use this checklist every time you work on the site.

## 1) Start locally

Open VS Code in:

`C:\Users\Hem\Desktop\App development\Lobos Shop`

In Git Bash (If other people have worked on it, this step will pull the updated files before you start working):

```bash
cd "/c/Users/Hem/Desktop/App development/Lobos Shop"
git pull origin main
```

## 2) Commit and push


I do this step in VS Code (top left) "Source Control". Name the changes and then press commit.



## 3) Deploy to VPS

SSH in:

```bash
ssh your-admin-user@your-server-ip (check Word document)
```

Password: stored outside the repository (password manager only)

Deploy latest code:

```bash
cd /var/www/LobosShop
git pull origin main
```

After this step, you can refresh the website (F5) and you will see the updates.




## 4) Restart backend only when needed 

If backend changed (`server/server.js`, routes, DB, env):

```bash
pm2 restart lobos-shop
```

If only frontend changed in `server/public/`, restart is usually not needed.

## 5) Verify deployment

```bash
curl https://lobos.se/api/health
pm2 list
```

Then open `https://lobos.se` in browser.
If it looks old, hard refresh with `Ctrl+F5`.

## Quick Troubleshooting

- Latest code missing on VPS:
  - `cd /var/www/LobosShop && git log -1 --oneline`
  - Compare with latest commit on GitHub.
- App not running:
  - `pm2 list`
  - `pm2 logs lobos-shop --lines 50`
