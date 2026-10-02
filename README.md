# Agentic Career Coach

> **A human-in-the-loop, zero-dependency AI career partner powered by the Google Gemini API.**  
> *Developed for the GHC Workshop: "Human-AI Collaboration in Hiring: From Ghosted to Offer-Ready".*


## Overview

In an AI-saturated job market, generic, exaggerated applications are routinely filtered out. **Agentic Career Coach** shifts the paradigm from passive drafting to structured, **evidence-based career positioning**. 


## Repository Structure

```text
career-coach/
├── index.html       # Responsive, dark/light theme client interface
├── server.js        # Native Node.js HTTP server & Gemini REST integration
├── manage.sh        # Interactive CLI manager (Local run, Git, Fly.io)
├── package.json     # Node.js engines & startup scripts
├── Dockerfile       # Lightweight Alpine container configuration
├── fly.toml         # Fly.io deployment & scaling configuration
├── .gitignore       # Protects local environment secrets
└── .env             # Local API keys (excluded from source control)
```

---

## Quick Start (Interactive CLI)

The included `manage.sh` script automates local development, Git synchronization, and Fly.io production tasks through a single interactive terminal interface.

```bash
# 1. Grant execution permissions
chmod +x manage.sh

# 2. Run the manager
./manage.sh
```

```text
==========================================
    Agentic Career Coach Manager Script   
==========================================
1) Run Locally (http://localhost:8080)
2) Commit & Push Changes to GitHub
3) Deploy to Fly.io
4) Open Live App in Browser
5) View Live Fly.io Logs
6) Suspend App on Fly.io (Pause compute)
7) Resume App on Fly.io (Start app)
8) Exit
==========================================
```

---

## Manual Setup & Deployment Guide

### 1. Local Development

#### Prerequisites
* **Node.js**: `v18.0.0` or higher (`node -v`)
* **Google Gemini API Key**: Obtainable from [Google AI Studio](https://aistudio.google.com/)

#### Step 1: Configure Environment Variables
Create a `.env` file in the project root:

```env
PORT=8080
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-flash
```

#### Step 2: Start the Server

```bash
npm run dev
# Or execute natively:
node --env-file-if-exists=.env server.js
```

#### Step 3: Access the Interface
Open your browser and navigate to:
```text
http://localhost:8080
```

---

### 2. Fly.io Production Deployment

#### Step 1: Authenticate with Fly CLI

```bash
fly auth login
```

#### Step 2: Configure Production Secrets
Set your runtime environment variables securely on Fly.io:

```bash
fly secrets set GEMINI_API_KEY="your_actual_api_key" GEMINI_MODEL="gemini-1.5-flash" -a career-coach-6bphta
```

#### Step 3: Allocate Public Networking (First-time setup)

```bash
fly ips allocate-v4 --shared -a career-coach-6bphta
fly ips allocate-v6 -a career-coach-6bphta
```

#### Step 4: Deploy & Launch

```bash
fly deploy -a career-coach-6bphta
fly open -a career-coach-6bphta
```

> **Live Application URL:**  
> `https://career-coach-6bphta.fly.dev/`

---

### 3. Application Lifecycle & Cost Controls

To avoid unnecessary compute usage when not facilitating a demo or workshop session:

```bash
# Suspend the application (Machines stop; DNS preserved; zero compute cost)
fly suspend -a career-coach-6bphta

# Resume application instantly
fly resume -a career-coach-6bphta

# Stream live container logs for debugging
fly logs -a career-coach-6bphta
```

---

## Workshop Demonstration Scenarios

Use these pre-constructed scenarios to demonstrate the **Draft $\rightarrow$ Evaluate $\rightarrow$ Revise** agentic workflow:

### Scenario A: Resume Builder & Receipts Mode (Maya)

* **Target Role:** `Junior Software Engineer`
* **Candidate Input:**
  ```text
  - B.S. in Computer Science (recent graduate).
  - Completed 2 software engineering internships using Python and JavaScript.
  - Built full-stack applications with Node.js and React.
  - Led a 48-hour campus hackathon with 150+ participants, managing technical logistics.
  ```
* **Expected Result:**  
  Generates measurable bullets linked directly to documented internship tasks. Unverified cloud or database proficiencies are explicitly flagged under `Missing evidence`.

---

### Scenario B: Skill Gap & 14-Day Acceleration Plan (Sophia)

* **Target Role:** `Backend Engineer (Java & Kubernetes)`
* **Candidate Input:**
  ```text
  - 2 years of frontend engineering experience with React and TypeScript.
  - Proficient in Python for automated scripting and REST API consumption.
  - No prior production experience with Java or Kubernetes clusters.
  ```
* **Follow-up Interaction Prompt:**
  ```text
  "Create a realistic 14-day study plan to ramp up on Java OOP fundamentals and container basics."
  ```

---

## Security & Guardrails

* **No Secret Leakage:** Client requests are proxied securely through the Node backend. API keys are never exposed in browser network inspection tools.
* **Strict Grounding:** Prompts explicitly prevent the LLM from hallucinating metrics or assuming proficiency without documented support.
* **Privacy-Safe:** Operates strictly on pasted raw text; requires no home addresses, government IDs, or sensitive personal data.

---

## License

Distributed under the MIT License. Built for educational and workshop facilitation purposes.
```