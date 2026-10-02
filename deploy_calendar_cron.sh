#!/usr/bin/env bash
# ==============================================================================
# LectureScribe Calendar & Cloud Scheduler Automation Deployment Script
# ==============================================================================
# Usage:
#   chmod +x deploy_calendar_cron.sh
#   ./deploy_calendar_cron.sh
# ==============================================================================

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo "my-gcp-project")}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="lecturescribe-api"
CRON_SECRET="${CRON_SECRET:-$(openssl rand -hex 24)}"

echo "======================================================================"
echo "🚀 Deploying LectureScribe Calendar & WhatsApp Alerts to GCP"
echo "Project : ${PROJECT_ID}"
echo "Region  : ${REGION}"
echo "Service : ${SERVICE_NAME}"
echo "======================================================================"

# 1. Deploy or update Cloud Run Service
echo "📦 Step 1: Deploying container to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "CRON_SECRET=${CRON_SECRET},TZ=Asia/Kolkata"

# Retrieve Cloud Run Service URL
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --platform managed --region "${REGION}" --format="value(status.url)")

echo "✅ Cloud Run deployed at: ${SERVICE_URL}"
echo "🔐 CRON_SECRET configured: ${CRON_SECRET}"
echo ""

# 2. Cloud Scheduler Cron Jobs in Asia/Kolkata (IST)
echo "⏰ Step 2: Configuring Cloud Scheduler daily dispatch jobs (Asia/Kolkata)..."

# Job 1: 8:00 AM IST (Morning Briefing & Day Schedule)
echo "Creating/updating 8:00 AM IST trigger..."
gcloud scheduler jobs create http lecturescribe-alert-8am \
  --location="${REGION}" \
  --schedule="0 8 * * *" \
  --time-zone="Asia/Kolkata" \
  --uri="${SERVICE_URL}/api/cron/trigger-alert?slot=8am" \
  --http-method=POST \
  --headers="Authorization=Bearer ${CRON_SECRET}" \
  --description="LectureScribe 8:00 AM IST Moodle Morning Alert to WhatsApp" \
  || gcloud scheduler jobs update http lecturescribe-alert-8am \
       --location="${REGION}" \
       --schedule="0 8 * * *" \
       --time-zone="Asia/Kolkata" \
       --uri="${SERVICE_URL}/api/cron/trigger-alert?slot=8am" \
       --http-method=POST \
       --headers="Authorization=Bearer ${CRON_SECRET}"

# Job 2: 4:00 PM IST (Evening Sessions, Deadlines & Tomorrow Preview)
echo "Creating/updating 4:00 PM IST trigger..."
gcloud scheduler jobs create http lecturescribe-alert-4pm \
  --location="${REGION}" \
  --schedule="0 16 * * *" \
  --time-zone="Asia/Kolkata" \
  --uri="${SERVICE_URL}/api/cron/trigger-alert?slot=4pm" \
  --http-method=POST \
  --headers="Authorization=Bearer ${CRON_SECRET}" \
  --description="LectureScribe 4:00 PM IST Moodle Evening & Tomorrow Preview Alert to WhatsApp" \
  || gcloud scheduler jobs update http lecturescribe-alert-4pm \
       --location="${REGION}" \
       --schedule="0 16 * * *" \
       --time-zone="Asia/Kolkata" \
       --uri="${SERVICE_URL}/api/cron/trigger-alert?slot=4pm" \
       --http-method=POST \
       --headers="Authorization=Bearer ${CRON_SECRET}"

echo ""
echo "======================================================================"
echo "🎉 Setup complete! 2 Cloud Scheduler cron triggers are active:"
echo "  1.  8:00 AM IST -> ${SERVICE_URL}/api/cron/trigger-alert?slot=8am"
echo "  2.  4:00 PM IST -> ${SERVICE_URL}/api/cron/trigger-alert?slot=4pm"
echo "======================================================================"
