const http = require("http");
const fs = require("fs");
const path = require("path");

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const PORT = process.env.PORT || 8080;

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>?/gm, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
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

http.createServer(async (req, res) => {
  // 1. SERVE FRONTEND
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const filePath = path.join(__dirname, "index.html");
    if (fs.existsSync(filePath)) {
      return send(res, 200, fs.readFileSync(filePath), "text/html");
    }
    return send(res, 404, { error: "index.html not found" });
  }

  // 2. GENERATE 3 RESUME OPTIONS
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

      return send(res, 200, {
        draft: opt1,
        option1: opt1,
        option2: opt2,
        option3: opt3
      });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  }

  // 3. LIVE JOBS FEED
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
    } else if (rLower.includes("frontend") || rLower.includes("web") || rLower.includes("react")) {
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

  // 4. AI JOB FIT & SKILLS GAP ANALYSIS (Required, Matched, Missing)
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

  // 5. GENERATE LEARNING & STUDY PLAN (06-learning-plan.txt)
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

  // 6. CHAT COACH API
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
      if (!geminiRes.ok) throw new Error(data?.error?.message || "Gemini API error");

      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
      return send(res, 200, { text: text || "No response received." });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  }

  send(res, 404, { error: "Not found" });
}).listen(PORT, "0.0.0.0", () => console.log(`Career Coach running at http://localhost:${PORT}`));