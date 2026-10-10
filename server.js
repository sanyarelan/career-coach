const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------------- LOCAL .ENV LOADER ----------------
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  try {
    const envLines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of envLines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || "").trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch (e) {}
}

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const PORT = process.env.PORT || 8080;

// ---------------- PERSISTENT STORAGE ----------------
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : __dirname);
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}
const DB_FILE = path.join(DATA_DIR, "users_data.json");
console.log(`[Storage] Storing user database at: ${DB_FILE}`);

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error reading users database:", e.message);
  }
  return { users: [] };
}

function saveDb(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch (e) {
    console.error("Error saving users database:", e.message);
  }
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password + "career_coach_salt").digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getAuthUser(req) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const db = loadDb();
  return db.users.find(u => u.token === token) || null;
}

function loadPromptFile(fileName) {
  const possiblePaths = [
    path.join(__dirname, "Prompts", fileName),
    path.join(__dirname, "prompts", fileName),
    path.join(process.cwd(), "Prompts", fileName),
    path.join(process.cwd(), "prompts", fileName),
    path.join(__dirname, fileName),
    path.join(process.cwd(), fileName)
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        console.log(`[Prompts] Successfully loaded ${fileName} from ${p}`);
        return fs.readFileSync(p, "utf-8").trim();
      } catch (e) {}
    }
  }
  return "";
}

const sharedInstructions = loadPromptFile("00-shared-instructions.txt");
const defaultCandidateProfile = loadPromptFile("01-candidate-profile.txt");
const learningPlanInstructions = loadPromptFile("06-learning-plan.txt");

// ---------------- RUBRIC SCORING ENGINE (rubric.md) ----------------
async function scoreResumeWithGemini(role, resumeText) {
  if (!KEY || !resumeText || resumeText.trim().length < 15) {
    return {
      total: 18,
      category: "Weak / Generic",
      diagnosis: "Draft relies on generic task lists without sufficient quantifiable receipts or verified metrics.",
      breakdown: {
        roleAlignment: { score: 3, label: "Role Alignment", feedback: "General technical match but lacking prioritized target keywords." },
        evidenceQuality: { score: 2, label: "Evidence Quality / Receipts", feedback: "Vague claims with limited verifiable ownership." },
        impactOutcomes: { score: 2, label: "Impact & Outcomes", feedback: "Lists duties rather than measurable deliverables or outcomes." },
        interviewDefensibility: { score: 3, label: "Interview Defensibility", feedback: "Explains basics but lacks depth on architecture trade-offs." },
        clarityReadability: { score: 3, label: "Clarity & Readability", feedback: "Readable but visual hierarchy and scanning flow could be sharper." },
        authenticityEthics: { score: 3, label: "Authenticity & AI Ethics", feedback: "Mostly grounded, but contains uncontextualized buzzwords." },
        professionalAccuracy: { score: 2, label: "Professional Accuracy", feedback: "Minor inconsistencies in formatting and timeline presentation." }
      }
    };
  }

  const prompt = `You are a strict Recruiter-Facing Resume Auditor evaluating this resume under the Recruiter-Facing Resume Evaluation Rubric (Total: 35 points across 7 criteria, scale 1-5).
Criteria Definitions:
1. Role Alignment (1-5): Spence (1973) signaling & Rivera (2012) cultural matching.
2. Evidence Quality / Receipts (1-5): Wingate (2024/2025) signal-based verification; specific tools, scope, defensible claims.
3. Impact and Outcomes (1-5): Concrete performance indicators, business/user deliverables, quantified metrics.
4. Interview Defensibility (1-5): Story structure, withstands technical cross-examination and trade-offs.
5. Clarity and Readability (1-5): Processing fluency (Reber et al., 2004), visual hierarchy, 30-sec skimming.
6. Authenticity / Responsible AI Use (1-5): 100% grounded in candidate facts; zero unverified hallucinations or generic AI filler.
7. Professional Accuracy (1-5): Typographical correctness (Sterkens et al., 2023), timeline coherence, layout consistency.

Scoring Scale:
1 = Weak, 2 = Partial, 3 = Acceptable, 4 = Strong, 5 = Excellent.
Total: sum of the 7 scores (7 to 35).
Category:
30-35: "Strong / Hiring-Ready"
24-29: "Good / Targeted Refinement"
17-23: "Weak / Generic"
<=16: "Not Yet Competitive"

Target Role: ${role || "Software Engineer"}
Candidate Resume:
${resumeText}

Analyze this resume and output STRICT JSON ONLY (no markdown or ticks):
{
  "total": number (sum of 7 criteria),
  "category": "Strong / Hiring-Ready" | "Good / Targeted Refinement" | "Weak / Generic" | "Not Yet Competitive",
  "diagnosis": "1-2 sentence recruiter diagnosis.",
  "breakdown": {
    "roleAlignment": { "score": number (1-5), "label": "Role Alignment", "feedback": "brief feedback" },
    "evidenceQuality": { "score": number (1-5), "label": "Evidence Quality / Receipts", "feedback": "brief feedback" },
    "impactOutcomes": { "score": number (1-5), "label": "Impact & Outcomes", "feedback": "brief feedback" },
    "interviewDefensibility": { "score": number (1-5), "label": "Interview Defensibility", "feedback": "brief feedback" },
    "clarityReadability": { "score": number (1-5), "label": "Clarity & Readability", "feedback": "brief feedback" },
    "authenticityEthics": { "score": number (1-5), "label": "Authenticity & AI Ethics", "feedback": "brief feedback" },
    "professionalAccuracy": { "score": number (1-5), "label": "Professional Accuracy", "feedback": "brief feedback" }
  }
}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1 }
        })
      }
    );
    const data = await res.json();
    let text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
    text = text.replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/g, "").trim();
    const parsed = JSON.parse(text);

    if (parsed.breakdown) {
      let sum = 0;
      for (const k in parsed.breakdown) {
        sum += Number(parsed.breakdown[k].score) || 0;
      }
      if (sum >= 7 && sum <= 35) parsed.total = sum;
    }
    return parsed;
  } catch (e) {
    console.warn("Rubric scoring fallback:", e.message);
    return {
      total: 21,
      category: "Weak / Generic",
      diagnosis: "Resume has good baseline experience but needs stronger quantitative receipts and clearer role alignment.",
      breakdown: {
        roleAlignment: { score: 3, label: "Role Alignment", feedback: "Relevant skills present but target alignment is uneven." },
        evidenceQuality: { score: 3, label: "Evidence Quality / Receipts", feedback: "Adequate proof but ownership could be sharper." },
        impactOutcomes: { score: 2, label: "Impact & Outcomes", feedback: "Deliverables are task-focused; lacks quantified metrics." },
        interviewDefensibility: { score: 3, label: "Interview Defensibility", feedback: "Reasonably defensible in interview conversations." },
        clarityReadability: { score: 4, label: "Clarity & Readability", feedback: "Easy to scan and well-structured." },
        authenticityEthics: { score: 3, label: "Authenticity & AI Ethics", feedback: "Realistic claims; avoid vague buzzwords." },
        professionalAccuracy: { score: 3, label: "Professional Accuracy", feedback: "Consistent formatting with minor cleanup needed." }
      }
    };
  }
}

http.createServer(async (req, res) => {
  // 1. SERVE FRONTEND
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const filePath = path.join(__dirname, "index.html");
    if (fs.existsSync(filePath)) {
      return send(res, 200, fs.readFileSync(filePath), "text/html");
    }
    return send(res, 404, { error: "index.html not found" });
  }

  // 2. AUTHENTICATION APIS
  if (req.method === "POST" && req.url === "/api/auth/signup") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { email, password, name } = body;
    if (!email || !password) return send(res, 400, { error: "Email and password are required." });

    const db = loadDb();
    const existing = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existing) return send(res, 400, { error: "An account with this email already exists." });

    const token = generateToken();
    const newUser = {
      id: "usr_" + Date.now(),
      email: email.trim().toLowerCase(),
      name: (name || email.split("@")[0]).trim(),
      passwordHash: hashPassword(password),
      token: token,
      createdAt: new Date().toISOString(),
      targetRole: "Software Engineer",
      skills: ["JavaScript", "Python", "REST APIs", "Git", "SQL"],
      savedResume: "",
      applications: []
    };

    db.users.push(newUser);
    saveDb(db);

    return send(res, 200, {
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        targetRole: newUser.targetRole,
        skills: newUser.skills,
        savedResume: newUser.savedResume
      },
      token
    });
  }

  if (req.method === "POST" && req.url === "/api/auth/login") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { email, password } = body;
    if (!email || !password) return send(res, 400, { error: "Email and password are required." });

    const db = loadDb();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user || user.passwordHash !== hashPassword(password)) {
      return send(res, 401, { error: "Invalid email or password." });
    }

    user.token = generateToken();
    saveDb(db);

    return send(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        targetRole: user.targetRole || "Software Engineer",
        skills: user.skills || ["Python", "JavaScript", "SQL", "Git"],
        savedResume: user.savedResume || ""
      },
      token: user.token
    });
  }

  if (req.method === "GET" && req.url === "/api/auth/me") {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Unauthorized" });
    return send(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        targetRole: user.targetRole || "Software Engineer",
        skills: user.skills || ["Python", "JavaScript", "SQL", "Git"],
        savedResume: user.savedResume || ""
      },
      applications: user.applications || []
    });
  }

  if (req.method === "POST" && req.url === "/api/auth/logout") {
    const user = getAuthUser(req);
    if (user) {
      const db = loadDb();
      const u = db.users.find(x => x.id === user.id);
      if (u) { u.token = null; saveDb(db); }
    }
    return send(res, 200, { success: true });
  }

  // 3. RUBRIC BASELINE SCORE API (rubric.md)
  if (req.method === "POST" && req.url === "/api/score-resume") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, resume } = body;
    const scoreResult = await scoreResumeWithGemini(role, resume);
    return send(res, 200, scoreResult);
  }

  // 4. USER PROFILE & RESUME UPDATE API
  if (req.method === "POST" && req.url === "/api/user/save-profile") {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Unauthorized" });

    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, resume, skills } = body;
    const db = loadDb();
    const u = db.users.find(x => x.id === user.id);
    if (u) {
      if (role) u.targetRole = role;
      if (resume) u.savedResume = resume;
      if (Array.isArray(skills)) u.skills = skills;
      saveDb(db);
    }
    return send(res, 200, { success: true });
  }

  // 5. USER-SPECIFIC APPLICATION TRACKER APIS
  if (req.method === "GET" && req.url === "/api/tracker") {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Please log in to view your applications." });
    return send(res, 200, { applications: user.applications || [] });
  }

  if (req.method === "POST" && req.url === "/api/tracker") {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: "Please log in to track applications." });

    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { application } = body;
    if (!application || !application.title) return send(res, 400, { error: "Invalid application details." });

    const db = loadDb();
    const u = db.users.find(x => x.id === user.id);
    if (!u) return send(res, 404, { error: "User not found." });

    if (!u.applications) u.applications = [];
    const existingIndex = u.applications.findIndex(a => (a.title === application.title && a.company === application.company));
    if (existingIndex >= 0) {
      u.applications[existingIndex] = { ...u.applications[existingIndex], ...application };
    } else {
      u.applications.unshift({
        id: "app_" + Date.now(),
        ...application
      });
    }

    saveDb(db);
    return send(res, 200, { applications: u.applications });
  }

  // 6. GENERATE RESUME + RUBRIC SCORING COMPARISON
  if (req.method === "POST" && req.url === "/api/generate-resumes") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, resume, motivation, timeline } = body;
    if (!role?.trim()) return send(res, 400, { error: "Target role is required." });
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY is missing." });

    const candidateContext = (resume && resume.trim().length > 10)
      ? resume.trim()
      : (defaultCandidateProfile || "Candidate has verified software engineering experience, project portfolios, and relevant CS background.");

    const systemPrompt = `You are an elite, evidence-based Technical Career Coach operating under strict rules:
${sharedInstructions ? `=== SHARED INSTRUCTIONS ===\n${sharedInstructions}` : "Adhere strictly to verified facts only. Never hallucinate fake metrics, companies, or tools."}

TASK:
Generate 3 distinct, full-length resumes tailored specifically for the target role: '${role}'.

Use these EXACT 3 delimiters so the frontend can parse each option:
===OPTION 1===
[Full complete resume text for Option 1 - Focus on Deliverables, Scope, and Outcomes]
===OPTION 2===
[Full complete resume text for Option 2 - Focus on Technical Architecture, Engineering Depth, and System Design]
===OPTION 3===
[Full complete resume text for Option 3 - Focus on Clean, Modern, Concise Structure]`;

    const userContent = `TARGET ROLE: ${role}
MOTIVATION: ${motivation || "New grad"}
TIMELINE: ${timeline || "As soon as possible"}

CANDIDATE PROFILE EVIDENCE:
${candidateContext}`;

    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userContent }] }],
            generationConfig: { temperature: 0.25 }
          }),
        }
      );

      const data = await geminiRes.json();
      if (!geminiRes.ok) throw new Error(data?.error?.message || "Gemini error");

      let rawText = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("\n").trim();
      let opt1 = "", opt2 = "", opt3 = "";

      if (rawText.includes("===OPTION 1===")) {
        const parts = rawText.split(/===OPTION [123]===/);
        opt1 = (parts[1] || "").trim();
        opt2 = (parts[2] || "").trim();
        opt3 = (parts[3] || "").trim();
      } else {
        const clean = rawText.replace(/^```[a-z]*\n?/i, "").replace(/```$/g, "").trim();
        opt1 = clean;
        opt2 = clean;
        opt3 = clean;
      }

      // Calculate baseline and new rubric scores
      const baselineScore = await scoreResumeWithGemini(role, candidateContext);
      const newScore = await scoreResumeWithGemini(role, opt1);

      // Auto-save to user profile if authenticated
      const authUser = getAuthUser(req);
      if (authUser) {
        const db = loadDb();
        const u = db.users.find(x => x.id === authUser.id);
        if (u) {
          u.savedResume = opt1;
          u.targetRole = role;
          saveDb(db);
        }
      }

      return send(res, 200, {
        draft: opt1,
        option1: opt1,
        option2: opt2,
        option3: opt3,
        baselineScore,
        newScore
      });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  }

  // 7. IMPROVE RESUME + LIVE RE-SCORING
  if (req.method === "POST" && req.url === "/api/improve-resume") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, currentResume, improvements } = body;
    if (!currentResume?.trim()) return send(res, 400, { error: "Current resume draft is required." });
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY is missing." });

    const systemPrompt = `You are a Career Coach applying requested improvements on top of an existing resume draft.
${sharedInstructions ? `=== SHARED INSTRUCTIONS ===\n${sharedInstructions}` : "Adhere strictly to verified facts only. Never hallucinate fake metrics."}

TASK:
1. Address and apply the following requested improvements:
"${improvements}"
2. Output the complete UPDATED RESUME incorporating all requested changes on top of the original draft.
3. Return ONLY the complete updated resume text without conversational chatter or code backticks.`;

    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: `TARGET ROLE: ${role}\n\nCURRENT RESUME DRAFT:\n${currentResume}\n\nREQUESTED IMPROVEMENTS:\n${improvements}` }] }],
            generationConfig: { temperature: 0.25 }
          }),
        }
      );

      const data = await geminiRes.json();
      if (!geminiRes.ok) throw new Error(data?.error?.message || "Gemini error");

      let updatedResume = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n").trim();
      updatedResume = updatedResume.replace(/^```[a-z]*\n?/i, "").replace(/```$/g, "").trim();

      // Recalculate Rubric score for enhanced resume
      const newScore = await scoreResumeWithGemini(role, updatedResume);

      return send(res, 200, { updatedResume, newScore });
    } catch (err) {
      return send(res, 500, { error: "Improvement Error: " + err.message });
    }
  }

  // 8. LIVE JOBS FEED
  if (req.method === "POST" && req.url === "/api/jobs") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, location, workType } = body;
    let searchKeyword = "software engineer";
    const rLower = (role || "").toLowerCase();

    if (rLower.includes("ai") || rLower.includes("llm") || rLower.includes("ml") || rLower.includes("data scientist")) {
      searchKeyword = "python";
    } else if (rLower.includes("backend")) {
      searchKeyword = "backend";
    } else if (rLower.includes("frontend") || rLower.includes("web")) {
      searchKeyword = "react";
    } else if (rLower.includes("devops") || rLower.includes("cloud")) {
      searchKeyword = "devops";
    } else if (rLower.includes("data engineer")) {
      searchKeyword = "data";
    }

    try {
      const apiRes = await fetch(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(searchKeyword)}&limit=10`);
      const data = await apiRes.json();

      let jobs = [];
      if (data && Array.isArray(data.jobs) && data.jobs.length > 0) {
        jobs = data.jobs.slice(0, 8).map(j => ({
          id: j.id,
          title: j.title,
          company: j.company_name,
          location: j.candidate_required_location || location || "Remote / US",
          workType: j.job_type ? j.job_type.replace("_", " ").toUpperCase() : workType || "Full-Time",
          salary: j.salary || "US$90k - $130k",
          url: j.url,
          tags: Array.isArray(j.tags) && j.tags.length ? j.tags.slice(0, 6) : ["Engineering", "APIs"],
          snippet: stripHtml(j.description).slice(0, 260) + "..."
        }));
      }

      return send(res, 200, { jobs });
    } catch (e) {
      return send(res, 200, { jobs: [] });
    }
  }

  // 9. AI JOB FIT & SKILLS GAP ANALYSIS
  if (req.method === "POST" && req.url === "/api/analyze-job-fit") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { job, resume } = body;
    if (!job || !resume) return send(res, 400, { error: "Job and Resume are required." });
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY is not set." });

    const prompt = `You are a Technical Recruiter evaluating a candidate's resume against a job opening.

JOB DETAILS:
Title: ${job.title}
Company: ${job.company}
Overview & Keywords: ${job.snippet} | Tags: ${(job.tags || []).join(", ")}

CANDIDATE RESUME:
${resume}

TASK:
Analyze the match and return STRICT valid JSON only (no markdown, no backticks):
{
  "requiredSkills": ["Skill 1", "Skill 2", "Skill 3", "Skill 4", "Skill 5"],
  "matchedSkills": ["Skill Candidate Has 1", "Skill Candidate Has 2"],
  "missingSkills": ["Skill Candidate Lacks 1", "Skill Candidate Lacks 2"],
  "matchScore": 75,
  "fitSummary": "Brief 2-sentence rationale of how well candidate fits."
}`;

    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 }
          })
        }
      );

      const data = await geminiRes.json();
      let text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
      text = text.replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/g, "").trim();

      const parsed = JSON.parse(text);
      return send(res, 200, parsed);
    } catch (err) {
      return send(res, 200, {
        requiredSkills: job.tags || ["APIs", "System Architecture", "Python", "Cloud"],
        matchedSkills: ["REST APIs", "Git", "Agile"],
        missingSkills: ["Domain Specific Tools", "Production Model Deployments"],
        matchScore: 70,
        fitSummary: "Candidate has strong foundational engineering skills; bridge gaps in specific frameworks during interviews."
      });
    }
  }

  // 10. GENERATE LEARNING & STUDY PLAN
  if (req.method === "POST" && req.url === "/api/generate-learning-plan") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, missingSkills, resume, timeline } = body;
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY is missing." });

    const systemPrompt = `You are a Principal Engineering Career Coach and Curriculum Architect.
${learningPlanInstructions ? `=== LEARNING PLAN GUIDELINES (06-learning-plan.txt) ===\n${learningPlanInstructions}\n======================================================` : ""}
${sharedInstructions ? `=== SHARED INSTRUCTIONS ===\n${sharedInstructions}` : ""}

TASK:
Create a high-impact, realistic, project-based Technical Study Plan to bridge the candidate's verified skill gaps for the target role: "${role}".

MISSING SKILLS / GAPS IDENTIFIED:
${Array.isArray(missingSkills) && missingSkills.length ? missingSkills.join(", ") : "Advanced System Design, Cloud Deployments, Microservice Resiliency"}

CANDIDATE CURRENT PROFILE:
${resume || "Early career software engineer with solid CS fundamentals and full-stack projects."}

TIMELINE: ${timeline || "14-Day Accelerated Plan"}

STRUCTURE YOUR OUTPUT CLEARLY WITH MARKDOWN:
1. Executive Summary & Readiness Assessment
2. Phase-by-Phase Roadmap (Daily / Weekly Breakdown with concrete code deliverables)
3. 1 Concrete Capstone Portfolio Feature/Project to prove these skills
4. 5 Deep Architecture Interview Questions with talking points to practice
5. Top 3 Curated Documentation & Free Learning Resources`;

    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: "Generate the complete, customized technical study plan now." }] }],
            generationConfig: { temperature: 0.3 }
          })
        }
      );

      const data = await geminiRes.json();
      if (!geminiRes.ok) throw new Error(data?.error?.message || "Gemini error");

      const planText = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("\n");
      return send(res, 200, { plan: planText });
    } catch (err) {
      return send(res, 500, { error: "Failed to generate learning plan: " + err.message });
    }
  }

  // 11. GENERATE MOCK INTERVIEW QUESTIONS
  if (req.method === "POST" && req.url === "/api/generate-interview-questions") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, resume, skills } = body;
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY is not set." });

    const prompt = `You are a Principal Technical Hiring Manager and Interviewer for '${role || "Software Engineer"}'.
Based on the candidate's resume and verified technical skills:
Skills: ${(skills || []).join(", ") || "Python, JavaScript, Data Structures, SQL, REST APIs"}
Resume Details:
${resume || "Experienced building web applications, backend APIs, and distributed data systems."}

Generate targeted, highly realistic interview questions strictly categorized into these 4 areas:
1. basicConceptual: Basic Coding Conceptual Questions (data structures, OOP, concurrency, language runtime, memory)
2. programming: Programming Questions (algorithmic challenges, function implementation, edge cases, state management)
3. performance: Code Performance Questions (Big-O optimization, database indexing, caching strategies, scaling bottlenecks)
4. resumeBased: Resume-Based Questions (deep dives into projects, trade-offs, architecture decisions, verified metrics)

FOR EACH OF THE 4 CATEGORIES, provide questions across 3 difficulties: "easy", "medium", and "hard".
Return STRICT valid JSON only without markdown or backticks in this format:
{
  "basicConceptual": [
    { "difficulty": "easy", "question": "...", "hint": "..." },
    { "difficulty": "medium", "question": "...", "hint": "..." },
    { "difficulty": "hard", "question": "...", "hint": "..." }
  ],
  "programming": [
    { "difficulty": "easy", "question": "...", "hint": "..." },
    { "difficulty": "medium", "question": "...", "hint": "..." },
    { "difficulty": "hard", "question": "...", "hint": "..." }
  ],
  "performance": [
    { "difficulty": "easy", "question": "...", "hint": "..." },
    { "difficulty": "medium", "question": "...", "hint": "..." },
    { "difficulty": "hard", "question": "...", "hint": "..." }
  ],
  "resumeBased": [
    { "difficulty": "easy", "question": "...", "hint": "..." },
    { "difficulty": "medium", "question": "...", "hint": "..." },
    { "difficulty": "hard", "question": "...", "hint": "..." }
  ]
}`;

    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.25 }
          })
        }
      );

      const data = await geminiRes.json();
      let text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
      text = text.replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/g, "").trim();

      const parsed = JSON.parse(text);
      return send(res, 200, parsed);
    } catch (err) {
      console.warn("Using fallback interview questions:", err.message);
      return send(res, 200, {
        basicConceptual: [
          { difficulty: "easy", question: "Explain the difference between synchronous and asynchronous execution in modern web runtimes.", hint: "Mention event loops, non-blocking I/O, callbacks, and promises." },
          { difficulty: "medium", question: "How does a Hash Table resolve collisions internally, and what is its amortized lookup time?", hint: "Discuss chaining vs open addressing, load factors, and O(1) vs worst-case O(N)." },
          { difficulty: "hard", question: "How do memory leaks occur in garbage-collected languages, and how would you debug them in production?", hint: "Mention uncollected references, closures, profiling heaps, and memory snapshots." }
        ],
        programming: [
          { difficulty: "easy", question: "Write a function to check if a string contains balanced parentheses and brackets.", hint: "Use a Stack data structure to push opening brackets and pop matching closing brackets." },
          { difficulty: "medium", question: "Implement an LRU (Least Recently Used) Cache with O(1) get and put operations.", hint: "Combine a Hash Map with a Doubly Linked List to maintain key lookup and access order." },
          { difficulty: "hard", question: "Design an algorithm to find the maximum sum sub-array of size K with duplicate element constraints.", hint: "Use a dynamic Sliding Window pattern with a frequency counter map." }
        ],
        performance: [
          { difficulty: "easy", question: "What is Big-O complexity, and why is an O(N log N) algorithm preferred over an O(N^2) sorting algorithm?", hint: "Compare scaling on large datasets with examples like Merge Sort vs Bubble Sort." },
          { difficulty: "medium", question: "How do composite indexes speed up database queries, and what is the 'leftmost prefix' rule?", hint: "Explain B-Tree search mechanics and index ordering." },
          { difficulty: "hard", question: "How would you optimize a high-throughput API endpoint experiencing CPU starvation under heavy concurrency?", hint: "Discuss connection pooling, Redis caching, async queues, and horizontal worker scaling." }
        ],
        resumeBased: [
          { difficulty: "easy", question: "Walk through the architectural design of the main project featured on your resume.", hint: "Cover client-server architecture, database layer, and deployment steps." },
          { difficulty: "medium", question: "Which technical constraint or bottleneck proved most challenging in your recent experience, and how did you resolve it?", hint: "Use the STAR method: describe the trade-off, alternatives considered, and measurable outcome." },
          { difficulty: "hard", question: "If your system's traffic increased 50x tomorrow, which layer would fail first, and how would you re-architect it?", hint: "Identify single points of failure, database read/write bottlenecks, and idempotency." }
        ]
      });
    }
  }

  // 12. CHAT COACH API
  if (req.method === "POST" && req.url === "/api/chat") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, resume, messages } = body;
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY is not set." });
    if (!Array.isArray(messages) || !messages.length) return send(res, 400, { error: "No messages provided." });

    const systemInstructionText = `You are a Senior Technical Career Coach and Resume Auditor operating under strict Receipts Mode for '${role || "Software Engineer"}'.
${sharedInstructions ? `Adhere to instructions:\n${sharedInstructions}` : ""}

Current Resume Context:
${resume || "No resume provided yet"}

RULES WHEN REQUESTED TO IMPROVE RESUME:
Always structure output into these TWO distinct sections:
### 1. What Changed & What to Check
Provide a concise Markdown table:
| Section / Original | Revised Change | Reason for Change | What Candidate Must Verify |

===UPDATED RESUME===
[Put complete, updated resume text here without commentary or code ticks]
===END RESUME===`;

    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstructionText }] },
            contents: messages.map(m => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: String(m.content) }]
            })),
            generationConfig: { temperature: 0.25 }
          })
        }
      );

      const data = await geminiRes.json();
      if (!geminiRes.ok) throw new Error(data?.error?.message || "Gemini error");

      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
      return send(res, 200, { text: text || "No response received." });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  }

  send(res, 404, { error: "Not found" });
}).listen(PORT, "0.0.0.0", () => console.log(`Career Coach running at http://localhost:${PORT}`));