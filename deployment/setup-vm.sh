#!/bin/bash
# GCP e2-micro Setup Script for Site Monitoring Worker
# Run: chmod +x setup-vm.sh && sudo ./setup-vm.sh

set -e

echo "=========================================="
echo "  Site Monitoring Worker - VM Setup"
echo "=========================================="

# Update system
echo "[1/7] Updating system..."
apt update && apt upgrade -y

# Install Node.js 20
echo "[2/7] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git build-essential

# Install Playwright dependencies
echo "[3/7] Installing Playwright browser dependencies..."
apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libasound2 libpango-1.0-0 libcairo2 libfontconfig1 libgtk-3-0

# Create app directory
echo "[4/7] Setting up application directory..."
mkdir -p /opt/site-monitoring-worker
cd /opt/site-monitoring-worker

# Clone repository
echo "[5/7] Cloning repository..."
git clone https://github.com/lp-admin-tech/monitoring-worker.git .

# Install dependencies
echo "[6/7] Installing Node.js dependencies..."
npm ci --only=production

# Install Playwright Chromium
echo "[7/7] Installing Playwright browser..."
npx playwright install chromium

# Create environment file
echo "Creating environment file..."
cat > /opt/site-monitoring-worker/.env << 'EOF'
# Fill in your actual values
SUPABASE_URL=your_supabase_url_here
SUPABASE_SERVICE_KEY=your_service_key_here
OPENROUTER_API_KEY=your_openrouter_key_here
WORKER_SECRET=your_worker_secret_here
NODE_ENV=production
PORT=3000
EOF

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Edit environment variables:"
echo "   sudo nano /opt/site-monitoring-worker/.env"
echo ""
echo "2. Copy the systemd service file:"
echo "   sudo cp /opt/site-monitoring-worker/deployment/site-monitoring.service /etc/systemd/system/"
echo ""
echo "3. Enable and start the service:"
echo "   sudo systemctl daemon-reload"
echo "   sudo systemctl enable site-monitoring"
echo "   sudo systemctl start site-monitoring"
echo ""
echo "4. Check status:"
echo "   sudo systemctl status site-monitoring"
echo "   sudo journalctl -u site-monitoring -f"
echo ""
