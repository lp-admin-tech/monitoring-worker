# GCP e2-micro Deployment Guide

Deploy site-monitoring-worker to Google Cloud Compute Engine e2-micro (free forever).

## Prerequisites
- Google Cloud account with free tier
- GitHub repo for site-monitoring-worker

---

## Step 1: Create VM in GCP Console

1. Go to: https://console.cloud.google.com/compute
2. Click **Create Instance**
3. Configure:
   - **Name:** `site-monitoring-worker`
   - **Region:** `us-west1` or `us-central1` *(free tier only)*
   - **Machine type:** `e2-micro` *(free tier)*
   - **Boot disk:** Ubuntu 22.04 LTS, 30GB Standard
   - **Firewall:** ✅ Allow HTTP traffic

4. Click **Create**

---

## Step 2: Connect & Run Setup

```bash
# SSH into VM (use browser SSH or gcloud)
gcloud compute ssh site-monitoring-worker --zone=us-west1-b

# Download and run setup script
curl -O https://raw.githubusercontent.com/YOUR_REPO/site-monitoring-worker/main/deployment/setup-vm.sh
chmod +x setup-vm.sh
sudo ./setup-vm.sh
```

---

## Step 3: Configure Environment

```bash
sudo nano /opt/site-monitoring-worker/.env
```

Fill in:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_key
OPENROUTER_API_KEY=your_openrouter_key
WORKER_SECRET=your_worker_secret
```

---

## Step 4: Start the Service

```bash
sudo cp /opt/site-monitoring-worker/deployment/site-monitoring.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable site-monitoring
sudo systemctl start site-monitoring
```

---

## Step 5: Verify

```bash
# Check status
sudo systemctl status site-monitoring

# View logs
sudo journalctl -u site-monitoring -f

# Test endpoint
curl http://localhost:3000/health
```

---

## Useful Commands

| Command | Purpose |
|---------|---------|
| `sudo systemctl restart site-monitoring` | Restart worker |
| `sudo journalctl -u site-monitoring -n 100` | Last 100 log lines |
| `sudo systemctl stop site-monitoring` | Stop worker |
| `cd /opt/site-monitoring-worker && git pull` | Update code |

---

## Update Worker

```bash
cd /opt/site-monitoring-worker
git pull
npm ci --only=production
sudo systemctl restart site-monitoring
```

---

## Cost: $0/month
- e2-micro VM: Free (730 hours/month)
- 30GB disk: Free
- 1GB egress: Free
