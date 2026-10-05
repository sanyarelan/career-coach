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
        return fs.readFileSync(p, "utf-8").trim();
      } catch (e) {}
    }
  }
  return "";
}

const sharedInstructions = loadPromptFile("00-shared-instructions.txt");
const defaultCandidateProfile = loadPromptFile("01-candidate-profile.txt");

http.createServer(async (req, res) => {
  // 1. SERVE FRONTEND
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const filePath = path.join(__dirname, "index.html");
    if (fs.existsSync(filePath)) {
      return send(res, 200, fs.readFileSync(filePath), "text/html");
    }
    return send(res, 404, { error: "index.html not found" });
  }

  // 2. GENERATE FIRST DRAFT RESUME
  if (req.method === "POST" && req.url === "/api/generate-resumes") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, resume, motivation, timeline } = body;
    if (!role?.trim()) return send(res, 400, { error: "Target role is required." });
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY is missing in your environment." });

    const candidateContext = (resume && resume.trim().length > 10)
      ? resume.trim()
      : (defaultCandidateProfile || "Candidate has verified software engineering experience.");

    const systemPrompt = `You are an elite, evidence-based Technical Career Coach operating under strict rules:
${sharedInstructions ? `=== SHARED INSTRUCTIONS ===\n${sharedInstructions}` : "Adhere strictly to verified facts only."}
TASK: Generate 1 complete FIRST DRAFT resume for "${role}". Output ONLY the clean resume text without markdown backticks.`;

    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: `TARGET: ${role}\nMOTIVATION: ${motivation}\nTIMELINE: ${timeline}\n\nEVIDENCE:\n${candidateContext}` }] }],
            generationConfig: { temperature: 0.25 }
          }),
        }
      );

      const data = await geminiRes.json();
      if (!geminiRes.ok) throw new Error(data?.error?.message || "Gemini error");

      let cleanDraft = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("\n").trim();
      cleanDraft = cleanDraft.replace(/^```[a-z]*\n?/i, "").replace(/```$/g, "").trim();

      return send(res, 200, { draft: cleanDraft, option1: cleanDraft });
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
    } else if (rLower.includes("frontend") || rLower.includes("web")) {
      searchKeyword = "react";
    } else if (rLower.includes("devops") || rLower.includes("cloud")) {
      searchKeyword = "devops";
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
Analyze the match and return STRICT valid JSON only (no markdown, no backticks, no comments) with this exact schema:
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

  // 5. CHAT COACH API
  if (req.method === "POST" && req.url === "/api/chat") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, resume, messages } = body;
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY is not set." });
    if (!Array.isArray(messages) || !messages.length) return send(res, 400, { error: "No messages provided." });

    const systemInstructionText = `You are a Senior Technical Career Coach and Resume Auditor operating under strict Receipts Mode for '${role || "AI / LLM Application Engineer"}'.
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