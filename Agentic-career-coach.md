# Agentic Career Coach

A lightweight, zero-dependency Node.js career coaching agent powered by the Google Gemini API. Built for the Grace Hopper Celebration (GHC) workshop: *"Human-AI Collaboration in Hiring: From Ghosted to Offer-Ready"*.

---

## Features

- **Receipts Mode:** Strictly grounds all resume bullets in verified evidence—no fabricated skills, metrics, or employers. Missing details are explicitly marked as `Missing evidence` or `Metric needed`.
- **Evidence Mapping:** Analyzes target job titles to generate a structured match table (*Signal | Evidence | Match Strength | Gap*).
- **Interactive Chat Continuity:** Ask follow-up questions to refine bullets, simulate interview questions, or address specific skill gaps.
- **Zero External npm Dependencies:** Runs using native Node.js HTTP and Fetch APIs.

---

## Project Structure

```text
career-coach/
├── index.html       # Responsive light/dark frontend UI
├── server.js        # Native Node.js server & Gemini API handler
├── package.json     # Project scripts & engine specifications
├── Dockerfile       # Container definition for Fly.io
├── fly.toml         # Fly.io deployment & routing configuration
├── .gitignore       # Prevents secrets & node_modules from being committed
└── .env             # Local environment variables (do NOT commit)

Prerequisites
Node.js: v18.0.0 or higher (v20+ LTS recommended)
Google Gemini API Key: Obtain from Google AI Studio
Git: For version control
Flyctl CLI: (Optional, only needed for Fly.io deployment)

Manual Step-by-Step Instructions
1. Local Setup & Execution
Step 1: Configure Environment Variables
Create a .env file in the root directory:
code
Env
PORT=8080
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-flash
Step 2: Run Locally
code
Bash
npm run dev
# OR: node --env-file-if-exists=.env server.js
Open http://localhost:8080 in your browser.
2. Fly.io Deployment & Secrets
Step 1: Set Remote Secrets
code
Bash
fly secrets set GEMINI_API_KEY="your_actual_gemini_api_key_here" GEMINI_MODEL="gemini-1.5-flash" -a career-coach-6bphta
Step 2: Allocate Public IPs (If not already set)
code
Bash
fly ips allocate-v4 --shared -a career-coach-6bphta
fly ips allocate-v6 -a career-coach-6bphta
Step 3: Deploy
code
Bash
fly deploy -a career-coach-6bphta
Step 4: Open Live App
code
Bash
fly open -a career-coach-6bphta
Live URL: https://career-coach-6bphta.fly.dev/
3. Fly.io App Management
View Live Logs: fly logs -a career-coach-6bphta
Check Status: fly status -a career-coach-6bphta
Pause App (Suspend): fly suspend -a career-coach-6bphta
Resume App: fly resume -a career-coach-6bphta
Scale to Zero Instances: fly scale count 0 -a career-coach-6bphta
Scale Back to 1 Instance: fly scale count 1 -a career-coach-6bphta
Sample Workshop Scenarios for Testing
Scenario A: Resume Builder & Receipts Mode (Maya)
Target Role: Junior Software Engineer
Resume / Profile:
code
Text
- B.S. in Computer Science (recent graduate).
- Completed 2 software engineering internships using Python and JavaScript.
- Built full-stack applications with Node.js and React.
- Led a 48-hour campus hackathon with 150+ participants, managing technical logistics.
Scenario B: Skill Gap & Acceleration Plan (Sophia)
Target Role: Backend Engineer (Java & Kubernetes)
Resume / Profile:
code
Text
- 2 years of frontend experience with React and TypeScript.
- Proficient in Python for basic scripting and API consumption.
- No prior production experience with Java or Kubernetes.
Follow-up Prompt: "Create a 14-day study plan to learn Java basics and containerization."
code
Code
---

### File 2: `manage.sh`

```bash
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
