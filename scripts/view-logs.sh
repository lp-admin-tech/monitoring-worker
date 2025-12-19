#!/bin/bash
# Live Audit Log Viewer
# Run: ./view-logs.sh

echo "=========================================="
echo "  🔍 Site Monitoring Worker - Live Logs"
echo "=========================================="
echo "Press Ctrl+C to stop"
echo ""

# Show only important audit logs with colors
sudo journalctl -u site-monitoring -f --no-pager | while read line; do
  # Highlight different log types
  if echo "$line" | grep -q "Starting audit\|Audit started"; then
    echo -e "\033[1;32m🚀 $line\033[0m"  # Green
  elif echo "$line" | grep -q "completed\|success\|finished"; then
    echo -e "\033[1;34m✅ $line\033[0m"  # Blue
  elif echo "$line" | grep -q "error\|failed\|Error"; then
    echo -e "\033[1;31m❌ $line\033[0m"  # Red
  elif echo "$line" | grep -q "crawl\|Crawling"; then
    echo -e "\033[1;33m🌐 $line\033[0m"  # Yellow
  elif echo "$line" | grep -q "score\|Score"; then
    echo -e "\033[1;35m📊 $line\033[0m"  # Purple
  else
    echo "$line"
  fi
done
