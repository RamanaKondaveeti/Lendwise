# groupbuk.com on an EC2 host

These steps assume Ubuntu/Debian and the repository already exists on EC2. If `/etc/os-release` reports Amazon Linux or another distribution, use its Nginx/Certbot package instructions instead of the `apt`/`sites-available` steps below.

## Inspect first

Run these before changing host configuration. Resolve any existing listener or vhost conflict before proceeding.

```bash
cat /etc/os-release
command -v nginx && sudo nginx -v || true
sudo ss -ltnp '( sport = :80 or sport = :443 )' || true
command -v certbot && sudo certbot certificates || true
sudo docker compose ps
```

Confirm the running services are healthy. Back up an existing Nginx configuration before editing it; do not remove existing certificates. Check in the AWS EC2 security group that inbound TCP 80 and 443 are allowed. Keep SSH restricted to the administrator's IP. Do not allow public 3000, 5000, or 3306.

## Configure the temporary HTTP vhost and issue the certificate

If Nginx is not installed on Ubuntu/Debian, install it. Do not install a second Nginx if another service already owns ports 80/443.

```bash
if ! command -v nginx >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y nginx; fi
```

In the checked-out repository directory, install the bootstrap host vhost and validate it:

```bash
if [ -f /etc/nginx/sites-available/groupbuk.com.conf ]; then sudo cp -a /etc/nginx/sites-available/groupbuk.com.conf "/etc/nginx/sites-available/groupbuk.com.conf.backup.$(date +%Y%m%d%H%M%S)"; fi
sudo install -m 0644 deploy/nginx/groupbuk.com.http.conf /etc/nginx/sites-available/groupbuk.com.conf
sudo ln -sfn /etc/nginx/sites-available/groupbuk.com.conf /etc/nginx/sites-enabled/groupbuk.com.conf
sudo nginx -t
sudo systemctl reload nginx
```

The public DNS names must resolve to this EC2 address and TCP 80 must be reachable before requesting an HTTP-01 certificate. Keep an existing Certbot installation and certificates. If Certbot is absent on Ubuntu/Debian, install Snap if necessary, then install Certbot; use the OS-specific Certbot instructions for other distributions:

```bash
if ! command -v certbot >/dev/null 2>&1; then
  if ! command -v snap >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y snapd; fi
  sudo snap install --classic certbot
  sudo ln -s /snap/bin/certbot /usr/local/bin/certbot
fi
```

With the Nginx plugin available, request one certificate for both names:

```bash
sudo certbot --nginx --redirect -d groupbuk.com -d www.groupbuk.com
```

Follow the interactive email prompt. Then install the final vhost, which redirects HTTP and `www` to the canonical HTTPS root and proxies the app to loopback:

```bash
sudo install -m 0644 deploy/nginx/groupbuk.com.https.conf.example /etc/nginx/sites-available/groupbuk.com.conf
sudo nginx -t
sudo systemctl reload nginx
```

The final file expects Certbot's standard certificate path `/etc/letsencrypt/live/groupbuk.com/`. If Certbot issued the files under a different lineage name, adjust only the two certificate paths after checking `sudo certbot certificates`.

## Point the app at HTTPS and close the public frontend port

In the deployment `.env`, set:

```dotenv
APP_URL=https://groupbuk.com
COOKIE_SECURE=true
```

The frontend uses relative `/api` requests through its existing container Nginx proxy, so no API URL, CORS, or OAuth callback change is needed. The backend remains private on the Compose network. After host Nginx and HTTPS work, update the deployed Compose file to bind the frontend as `127.0.0.1:3000:3000`, then apply only that service change without rebuilding:

```bash
sed -i 's|^APP_URL=.*|APP_URL=https://groupbuk.com|' .env
sed -i 's|^COOKIE_SECURE=.*|COOKIE_SECURE=true|' .env
docker compose config -q
docker compose up -d --no-deps backend frontend
docker compose ps
```

## Verify

```bash
curl -sSI http://groupbuk.com/
curl -sSI https://www.groupbuk.com/
curl -sSI https://groupbuk.com/
curl -fsS https://groupbuk.com/api/health
sudo certbot renew --dry-run
```

Expected: HTTP and `www` return a redirect to `https://groupbuk.com/...`; the apex HTTPS page returns successfully; `/api/health` returns `{"ok":true}`; and the renewal dry run succeeds. Then test login in a browser and inspect DevTools for mixed-content or cookie errors. Do not remove public port 3000 from the EC2 security group until the HTTPS host proxy and health check pass; remove it afterward.
