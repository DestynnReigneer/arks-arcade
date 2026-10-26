# Setting up your arcade

A step-by-step guide to running the arcade at home: one Docker container, a
name like `arcade.example.com` on your own network through a reverse proxy,
and safe access from outside the house without opening any ports.

A common setup, and the one this guide walks through: Docker Compose,
Nginx Proxy Manager in front, and Tailscale for playing away from home.

---

## 1. What you need

- A machine that runs Docker (a mini PC, a NAS, a Proxmox LXC/VM, a Pi 4/5…).
  The arcade uses about 150 MB of memory and almost no CPU.
- Docker with the Compose plugin (`docker compose version` should work).
- Optional: a reverse proxy (Nginx Proxy Manager, Caddy, Traefik) and a
  domain or local DNS name.
- Optional: Tailscale (or WireGuard) to play from outside the house.

## 2. Get it running

```bash
mkdir arcade && cd arcade
# Copy two files from this repo into the folder:
#   docker-compose.prod.yml  → save it as docker-compose.yml
#   .env.example             → save it as .env
nano .env          # fill it in (see section 3)
docker compose pull
docker compose up -d
docker compose ps  # STATUS should say "healthy" after about 20 seconds
```

Open `http://<server-ip>:3000` (or the `HOST_PORT` you set in `.env`, if
something else on the host already uses 3000). Everything the arcade saves (scores,
profiles, themes, packs) lives in `./data/arcade.db` next to the compose
file. Back that one file up and you've backed up the arcade.

To update later: `docker compose pull && docker compose up -d`.

Prefer to build from source? Clone the repo and run `docker compose up -d --build`
with the repo's own `docker-compose.yml`.

## 3. The `.env` file

Copy `.env.example` to `.env`. Never commit `.env` anywhere: it holds your
admin password.

| Setting | What it does |
|---|---|
| `ARCADE_NAME` | Your arcade's name: `Smith` shows "Smith Arcade". Blank shows "Arcade". |
| `ADMIN_PASSWORD` | Password for the admin page (`/admin.html`). **Set this**, and make it long. Blank keeps admin locked to everyone. |
| `ADULT_PIN` | Optional PIN guarding every adult option (adult themes, Unfiltered words, adult decks and levels). You can set, change or remove it later from Admin → Arcade, which overrides this. Blank means a "yes, I'm 18+" tap is the only guard. |
| `TZ` | Your timezone, e.g. `America/Los_Angeles` or `America/New_York`. Daily challenges and streaks roll over at your midnight. |
| `PUBLIC_URL` | The address phones should use, for QR codes. Set it to your arcade's real address, e.g. `https://arcade.example.com`. Pages opened on a real address already use that address, so this mainly matters for QR codes made from the server itself. |
| `TRUST_PROXY` | Set to `1` when the arcade sits behind **one** reverse proxy (like Nginx Proxy Manager) so rate limits see each visitor's real address. Leave blank if people connect to the container directly. |
| `TRIVIA_ONLINE` | Know-It-All downloads free questions from Open Trivia DB in the background and saves them. Set to `off` to never go online. |
| `DISCORD_WEBHOOK_URL` | Optional. Posts to a Discord channel when someone requests a theme, a pack or a profile. |
| `ARKS_ID_URL`, `ARKS_ID_SECRET` | Optional, and only if you also run an ARKS ID server, a family sign-in service the arcade can share with other apps. Both blank (the usual case) keeps the arcade's own profiles. See "Signing in through ARKS ID" below. |
| `ARKS_ID_API_URL` | Optional. Where the arcade's server reaches ARKS ID, if that's a different address from `ARKS_ID_URL` (for example a home-network address). Blank uses `ARKS_ID_URL`. |
| `HOST_PORT` | The port on the server, if something else already uses 3000 (e.g. `3070`). |
| `PUID` / `PGID` | Who owns `./data` and runs the arcade. Blank means 1000, the first user on most Linux machines; run `id -u` and `id -g` to check yours. The container fixes the folder's owner on start, so you never need `sudo chown`. |

After changing `.env`: `docker compose up -d` (it recreates the container
with the new values; your data stays).

## 4. A nice name with Nginx Proxy Manager

This gives you `https://arcade.example.com` instead of an IP and port.

1. **Point the name at your proxy.** Either a public domain's DNS record, or a
   local DNS entry (Pi-hole, AdGuard Home, your router) pointing
   `arcade.example.com` to the machine running Nginx Proxy Manager.
2. **Add a Proxy Host** in Nginx Proxy Manager:
   - Domain names: `arcade.example.com`
   - Scheme `http`, Forward Hostname/IP: the arcade machine (or the container
     name, if NPM shares a Docker network with it), Forward Port: `3000`
     (your `HOST_PORT` if you set one; use `3000` when going by container name)
   - Turn on **Websockets Support** and **Block Common Exploits**.
3. **SSL tab:** request a Let's Encrypt certificate (a DNS challenge works even
   if nothing is reachable from the internet), and turn on **Force SSL**.
4. **Advanced tab:** paste this so live updates (room codes, two-phone games,
   the Join a game list) aren't held back by buffering:

   ```nginx
   proxy_buffering off;
   proxy_cache off;
   proxy_read_timeout 1h;
   ```

5. In `.env`, set `TRUST_PROXY=1` and `PUBLIC_URL=https://arcade.example.com`,
   then `docker compose up -d`.
6. Optional: if NPM reaches the arcade over a Docker network, remove the
   `ports:` section from the compose file so the arcade is *only* reachable
   through the proxy.

## 5. Playing from outside the house (without opening ports)

You don't need to open anything on your router. Use **Tailscale** (or
WireGuard):

- Install Tailscale on the server (or the machine running your proxy) and on
  your phone. Your phone then reaches the arcade at its Tailscale address, or
  at your proxy's name if you've set up DNS for it (for example Tailscale's
  split DNS pointing your domain at your proxy).
- Keep the arcade off the public internet. It has no user accounts or email
  sign-ups by design; it's made for people you trust.

## 6. Parties: getting guests in

- On the home page, **📱 Phone QR** shows a code that opens the arcade (or one
  game) on a guest's phone. Every hosted game's lobby has its own
  scan-to-join code too.
- **📡 Join a game** on the home page lists every game being hosted right now.
  Guests tap **Join**. Full or already-running games say so.
- **Adult games** show on that list with 🔞 and 🔒. Hosting one needs the adult
  PIN; the host then makes up a **lobby password** for that game and tells
  their guests. Guests only need that password, not the PIN, so a curious kid
  hits a wall.
- Guests on your Wi-Fi need to reach the arcade's address. If you use a local
  DNS name, make sure guest devices use your DNS (or give them the IP-based
  QR code).

## 7. Profiles

- **Who's playing?** on the home page: pick your profile, or play as a guest
  (type a name, or get "Guest 1", "Guest 2"…).
- **New profile** lets anyone ask for one with a name and an avatar. Approve it
  in **Admin → Arcade → Profiles**.
- A **PIN on a profile is optional**. Whoever owns the profile can add, change
  or remove it from **⚙️ My profile**; you can clear a forgotten one in admin.
- Scores are credited to the profile (the server checks a signed token), so
  nobody can post a score as someone else without their PIN.

### Signing in through ARKS ID (optional)

If you run an ARKS ID server, register the arcade there as an app named
`arcade` with the callback `https://<your arcade>/auth/callback`, then put its
address in `ARKS_ID_URL` and the app's secret in `ARKS_ID_SECRET` (make the
secret with `openssl rand -hex 32`, the same value in both). With both
set, ARKS ID takes over everything about a person:

- **Who's playing?** shows *Sign in with ARKS ID*. The first time someone signs
  in, their account is linked to the arcade profile with the same name, so
  their scores come along; with no match, a new profile is made. You can move a
  wrong link in **Admin → Arcade → Profiles**.
- Names, PINs and "name or initials on the boards" are set in ARKS ID. The
  arcade's own profile requests and profile PINs switch off; avatars stay the
  arcade's own.
- **Adult levels follow the person's role**: a signed-in adult or admin opens
  them without a PIN, and kids, teens and guests can't. `ADULT_PIN` isn't used.
- **Guest play** is only offered on a device ARKS ID doesn't know, or one that
  belongs to an admin, so nobody can get around the adult rules by playing as a
  guest. The first visit from a signed-out browser makes one quick stop at
  ARKS ID to find out.
- **Clips** you send from admin go through ARKS ID, so they pop up in whichever
  app the person opens next.

## 8. Keeping it safe

What's already done for you:

- The container runs as an unprivileged user with a memory cap and a health check.
- Every move in every game is checked on the server; rate limits slow down
  spam and PIN guessing; room and request limits cap memory use.
- Pages carry strict browser security headers (scripts only from your server,
  no embedding by other sites), and player-typed text is always shown as text.
- Downloaded trivia and pasted AI packs are stored and shown as plain text;
  they can't run code.

What's up to you:

- Set a long `ADMIN_PASSWORD`, and an `ADULT_PIN` before kids are around.
- Keep the arcade on your home network; use Tailscale/WireGuard from outside.
- Put HTTPS in front (Nginx Proxy Manager does it in a few clicks): the admin
  password travels with every admin request.
- If it shares a Docker host with other services, give it its own network and
  don't mount the Docker socket into it.
- Back up `./data/arcade.db`.

## 9. Troubleshooting

- **Rooms or the Join a game list don't update live** → the proxy is buffering.
  Add the Advanced snippet from step 4 and turn on Websockets Support.
- **QR codes point at the wrong address** → set `PUBLIC_URL` in `.env`.
- **"Too many requests" for everyone behind the proxy** → set `TRUST_PROXY=1`.
- **Admin says the password is wrong after editing `.env`** → run
  `docker compose up -d` so the container picks up the new value.
- **Container shows "unhealthy" or keeps restarting** → `docker compose logs`.
  If it says PUID or PGID is wrong, fix them in `.env` (numbers, never 0).
