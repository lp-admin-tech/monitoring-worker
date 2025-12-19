#!/bin/bash

# Configuration
PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
IMAGE_NAME="gcr.io/$PROJECT_ID/site-monitoring-worker-py"

echo "🚀 Starting deployment for project: $PROJECT_ID in region: $REGION"

# 1. Build and Push Image using Cloud Build
echo "📦 Building and pushing Docker image..."
gcloud builds submit --config cloudbuild.yaml .

# 2. Deploy API Service
echo "🌐 Deploying API Service..."
gcloud run deploy site-monitoring-api-py \
  --image "$IMAGE_NAME:latest" \
  --region "$REGION" \
  --platform managed \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --concurrency 10 \
  --set-env-vars "ROLE=api,PYTHON_ENV=production" \
  --allow-unauthenticated

# 3. Deploy Celery Worker
echo "⚙️ Deploying Celery Worker..."
gcloud run deploy site-monitoring-worker-py \
  --image "$IMAGE_NAME:latest" \
  --region "$REGION" \
  --platform managed \
  --memory 4Gi \
  --cpu 4 \
  --timeout 3600 \
  --no-traffic \
  --min-instances 1 \
  --set-env-vars "ROLE=worker,PYTHON_ENV=production,CONCURRENCY=2"

# 4. Deploy Celery Beat (Optional, if needed as a separate service)
echo "⏰ Deploying Celery Beat..."
gcloud run deploy site-monitoring-beat-py \
  --image "$IMAGE_NAME:latest" \
  --region "$REGION" \
  --platform managed \
  --memory 1Gi \
  --cpu 1 \
  --timeout 3600 \
  --no-traffic \
  --min-instances 1 \
  --set-env-vars "ROLE=beat,PYTHON_ENV=production"

echo "✅ Deployment complete!"
echo "API URL: $(gcloud run services describe site-monitoring-api-py --region "$REGION" --format 'value(status.url)')"
