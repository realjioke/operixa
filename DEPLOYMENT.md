# Operixa - Deployment & GitHub Setup Guide

## Step 1: Create GitHub Repository

1. Go to [GitHub](https://github.com/new)
2. Create a new repository named `operixa`
3. Set it as **Public** (for public hosting)
4. Do NOT initialize with README, .gitignore, or license (we already have these)
5. Click "Create repository"

## Step 2: Push to GitHub

After creating the repository, run these commands in the project root:

```bash
cd c:\Users\DELL\Downloads\syncforge\syncforge

# Add remote repository
git remote add origin https://github.com/realjioke/operixa.git

# Rename branch to main (optional but recommended)
git branch -M main

# Push code to GitHub
git push -u origin main
```

**Note:** You'll need to authenticate with GitHub. Use one of these methods:

### Option A: GitHub CLI (Recommended)
```bash
# Install GitHub CLI from: https://cli.github.com/
gh auth login
# Follow prompts to authenticate
```

### Option B: Personal Access Token
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate a new token with `repo` scope
3. When prompted for password, paste the token

## Step 3: Public Hosting Setup

### Frontend (Next.js) - Deploy to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Sign in with GitHub
3. Click "New Project"
4. Select the `operixa` repository
5. Configure project settings:
   - Framework: Next.js
   - Root directory: `./frontend`
   - Environment variables:
     ```
     NEXT_PUBLIC_API_URL=https://your-backend-url.com
     NEXT_PUBLIC_WS_URL=wss://your-backend-url.com
     ```
6. Deploy!

Vercel will automatically deploy on every push to main.

### Backend (Node.js/Express) - Deploy to Railway or DigitalOcean

#### Option 1: Railway (Simplest)

1. Go to [railway.app](https://railway.app)
2. Sign in with GitHub
3. Create new project → Deploy from GitHub repo
4. Select `operixa` repository
5. Configure:
   - Root directory: `backend`
   - Build command: `npm run build`
   - Start command: `npm run start`
   - Environment variables from `.env.example`
6. Connect PostgreSQL and Redis from Railway marketplace
7. Deploy!

#### Option 2: DigitalOcean (More Control)

1. Create DigitalOcean account and droplet (Ubuntu 22.04)
2. SSH into droplet:
   ```bash
   ssh root@your_droplet_ip
   ```
3. Install Node.js and dependencies:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs postgresql postgresql-contrib redis-server
   ```
4. Clone repository:
   ```bash
   cd /opt
   git clone https://github.com/realjioke/operixa.git
   cd operixa/backend
   ```
5. Install and build:
   ```bash
   npm install
   npm run build
   ```
6. Set up environment:
   ```bash
   cp .env.example .env
   # Edit .env with production values
   nano .env
   ```
7. Set up PM2 for process management:
   ```bash
   npm install -g pm2
   pm2 start npm --name "operixa-api" -- start
   pm2 startup
   pm2 save
   ```
8. Set up reverse proxy with Nginx:
   ```bash
   sudo apt-get install nginx
   sudo nano /etc/nginx/sites-available/operixa
   ```

   Add configuration:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:4000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
       }
   }
   ```

   Enable and restart:
   ```bash
   sudo ln -s /etc/nginx/sites-available/operixa /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

9. Set up SSL with Let's Encrypt:
   ```bash
   sudo apt-get install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

## Step 4: Environment Variables

### Frontend Environment (.env)
```
NEXT_PUBLIC_API_URL=https://api.your-domain.com
NEXT_PUBLIC_WS_URL=wss://api.your-domain.com
```

### Backend Environment (.env)
```
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://user:password@host:5432/operixa
REDIS_URL=redis://host:6379
JWT_ACCESS_SECRET=your-secure-random-string-here
JWT_REFRESH_SECRET=your-secure-random-string-here
CORS_ORIGIN=https://your-frontend-domain.com
COOKIE_SECURE=true
```

## Step 5: Domain Setup

1. Point your domain DNS to:
   - **Frontend:** Vercel deployment URL (or your DigitalOcean IP)
   - **Backend:** DigitalOcean IP or Railway domain

2. Update CORS_ORIGIN in backend .env to match your frontend domain

## Step 6: CI/CD Workflow

The repository includes GitHub Actions workflow (`.github/workflows/ci.yml`) that:
- Runs tests on every push
- Builds Docker images
- Can auto-deploy to production

## Monitoring & Maintenance

### Logs
- **Frontend (Vercel):** View in Vercel dashboard
- **Backend (Railway):** View in Railway dashboard
- **Backend (DigitalOcean):** `pm2 logs operixa-api`

### Database Backups
- Set up automated backups in PostgreSQL
- Use managed database services when possible

### Updates
```bash
# Pull latest changes
git pull origin main

# Redeploy
# - Vercel: Auto-redeploys on push
# - Railway: Auto-redeploys on push
# - DigitalOcean: Manually run deployment commands
```

## Security Checklist

- [ ] All `.env` files excluded from git (check `.gitignore`)
- [ ] Use environment variables for all secrets
- [ ] Enable HTTPS/SSL
- [ ] Set up rate limiting (already in code)
- [ ] Configure CORS properly
- [ ] Use strong JWT secrets (minimum 16 characters)
- [ ] Enable database encryption
- [ ] Regular security updates

---

**Need help?** Check the docs in `/docs` folder for architecture and API documentation.
