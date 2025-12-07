#!/bin/bash
# GCP Compute Engine e2-micro Setup Script
# For site-monitoring-worker with 1GB RAM

# Exit on error
set -e

echo "=== Setting up site-monitoring-worker on e2-micro ==="

# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Playwright dependencies
sudo apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation

# Install git
sudo apt-get install -y git

# Clone your repository (replace with your repo URL)
echo "Clone your repository:"
echo "git clone https://github.com/YOUR_USERNAME/mfa.git"
echo "cd mfa/site-monitoring-worker"

# Create environment file
echo "Creating .env template..."
cat > .env.template << 'EOF'
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
WORKER_SECRET=your_worker_secret
NODE_ENV=production
PORT=8080
EOF

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Clone your repo: git clone <your-repo-url>"
echo "2. cd site-monitoring-worker"
echo "3. Copy .env.template to .env and fill in values"
echo "4. npm install"
echo "5. npx playwright install chromium"
echo "6. npm start"
echo ""
echo "To run as a service, create /etc/systemd/system/worker.service"
