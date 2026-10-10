#!/usr/bin/env bash
set -e

APP_NAME="career-coach-6bphta"

echo "=========================================="
echo "    Agentic Career Coach Manager Script   "
echo "=========================================="
echo "1) Run Locally (http://localhost:8080)"
echo "2) Commit & Push Changes to GitHub"
echo "3) Setup Persistent Volume on Fly.io (One-time)"
echo "4) Deploy to Fly.io"
echo "5) Open Live App in Browser"
echo "6) View Live Fly.io Logs"
echo "7) Suspend App on Fly.io (Stop billing)"
echo "8) Resume App on Fly.io (Start app)"
echo "9) Exit"
echo "=========================================="
read -rp "Select an option [1-9]: " choice

case $choice in
  1)
    echo "Starting local server..."
    if [ ! -f .env ]; then
      echo "Warning: .env file not found. Creating a template..."
      echo "PORT=8080" >> .env
      echo "GEMINI_API_KEY=your_key_here" >> .env
      echo "GEMINI_MODEL=gemini-1.5-flash" >> .env
      echo "Please edit .env with your real GEMINI_API_KEY before running."
      exit 1
    fi
    node --env-file-if-exists=.env server.js
    ;;

  2)
    read -rp "Enter commit message: " msg
    if [ -z "$msg" ]; then
      msg="Update Career Coach with Mock Interview, Profile Home, and Persistent Volume"
    fi
    git add .
    git commit -m "$msg"
    git push origin main
    echo "Changes pushed to GitHub!"
    ;;

  3)
    echo "Creating persistent storage volume 'coach_data' on Fly.io ($APP_NAME)..."
    fly volumes create coach_data --region iad --size 1 -a "$APP_NAME" || true
    echo "Volume setup completed."
    ;;

  4)
    echo "Deploying to Fly.io ($APP_NAME)..."
    fly deploy -a "$APP_NAME"
    echo "Deployment complete!"
    ;;

  5)
    echo "Opening https://$APP_NAME.fly.dev..."
    fly open -a "$APP_NAME"
    ;;

  6)
    echo "Streaming live logs (Ctrl+C to stop)..."
    fly logs -a "$APP_NAME"
    ;;

  7)
    echo "Suspending $APP_NAME..."
    fly suspend -a "$APP_NAME"
    echo "App suspended. No compute will run until resumed."
    ;;

  8)
    echo "Resuming $APP_NAME..."
    fly resume -a "$APP_NAME"
    echo "App resumed!"
    ;;

  9)
    echo "Goodbye!"
    exit 0
    ;;

  *)
    echo "Invalid option. Exiting."
    exit 1
    ;;
esac