#!/usr/bin/env bash
set -e

APP_NAME="career-coach-6bphta"

echo "=========================================="
echo "    Agentic Career Coach Manager Script   "
echo "=========================================="
echo "1) Run Locally (http://localhost:8080)"
echo "2) Commit & Push Changes to GitHub"
echo "3) Deploy to Fly.io"
echo "4) Open Live App in Browser"
echo "5) View Live Fly.io Logs"
echo "6) Suspend App on Fly.io (Stop billing)"
echo "7) Resume App on Fly.io (Start app)"
echo "8) Exit"
echo "=========================================="
read -rp "Select an option [1-8]: " choice

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
      msg="Update Career Coach"
    fi
    git add .
    git commit -m "$msg"
    git push origin main
    echo "Changes pushed to GitHub!"
    ;;

  3)
    echo "Deploying to Fly.io ($APP_NAME)..."
    fly deploy -a "$APP_NAME"
    echo "Deployment complete!"
    ;;

  4)
    echo "Opening https://$APP_NAME.fly.dev..."
    fly open -a "$APP_NAME"
    ;;

  5)
    echo "Streaming live logs (Ctrl+C to stop)..."
    fly logs -a "$APP_NAME"
    ;;

  6)
    echo "Suspending $APP_NAME..."
    fly suspend -a "$APP_NAME"
    echo "App suspended. No compute will run until resumed."
    ;;

  7)
    echo "Resuming $APP_NAME..."
    fly resume -a "$APP_NAME"
    echo "App resumed!"
    ;;

  8)
    echo "Goodbye!"
    exit 0
    ;;

  *)
    echo "Invalid option. Exiting."
    exit 1
    ;;
esac