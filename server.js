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

// Locate and load instruction and candidate files from Prompts directory
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
      } catch (e) {
        console.warn(`[Prompts] Error reading ${p}:`, e.message);
      }
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

  // 2. GENERATE 1 HIGH QUALITY FIRST DRAFT
  if (req.method === "POST" && req.url === "/api/generate-resumes") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, resume, motivation, timeline } = body;
    if (!role?.trim()) return send(res, 400, { error: "Target role is required." });
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY is missing in your environment or .env file." });

    const candidateContext = (resume && resume.trim().length > 10)
      ? resume.trim()
      : (defaultCandidateProfile || "Candidate has verified software engineering experience, project portfolios, and relevant CS background.");

    const systemPrompt = `You are an elite, evidence-based Technical Career Coach operating under strict rules:
${sharedInstructions ? `=== SHARED INSTRUCTIONS (00-shared-instructions.txt) ===\n${sharedInstructions}\n======================================================` : `
RULES:
- RECEIPTS MODE: Use ONLY facts, tools, technologies, and achievements stated in the candidate's profile.
- NEVER invent unverified metrics, employers, degrees, or certifications.
- If a metric is missing, describe qualitative scope or state [Metric needed].
- Follow ATS-compliant reverse chronological formatting.`}

TASK:
Generate EXACTLY 1 complete, professional, beautifully formatted FIRST DRAFT resume for the target role: "${role}".
Ensure standard clean sections:
1. Contact Information Header (Name, Location, Email, Phone, GitHub/LinkedIn placeholders)
2. Professional Summary (grounded purely in verified qualifications)
3. Technical Skills (categorized by Languages, Frameworks, Developer Tools, Cloud/Databases)
4. Work Experience / Professional Projects (Strong Action Verb + Scope/Architecture + Concrete Result)
5. Education & Credentials

Output ONLY the clean, ready-to-use resume text with no conversational preamble and no markdown backtick fences.`;

    const userContent = `TARGET ROLE: ${role}
MOTIVATION: ${motivation || "Career growth"}
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
      if (!geminiRes.ok) throw new Error(data?.error?.message || `Gemini API error (${geminiRes.status})`);

      const candidate = data.candidates?.[0];
      let rawText = (candidate?.content?.parts || []).map((p) => p.text || "").join("\n").trim();

      if (!rawText) {
        const finishReason = candidate?.finishReason || data.promptFeedback?.blockReason || "EMPTY_RESPONSE";
        throw new Error(`Gemini produced no output (Reason: ${finishReason}). Check your GEMINI_API_KEY and model quota.`);
      }

      let cleanDraft = rawText.replace(/^```[a-z]*\n?/i, "").replace(/```$/g, "").trim();

      // Return draft and backwards-compatible option1/2/3 so frontend never hits "unavailable"
      return send(res, 200, {
        draft: cleanDraft,
        option1: cleanDraft,
        option2: cleanDraft,
        option3: cleanDraft
      });
    } catch (err) {
      console.error("Resume Generation Failed:", err.message);
      return send(res, 500, { error: err.message });
    }
  }

  // 3. ENHANCE / IMPROVE RESUME ON TOP OF CURRENT DRAFT
  if (req.method === "POST" && req.url === "/api/improve-resume") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, currentResume, improvements } = body;
    if (!currentResume?.trim()) return send(res, 400, { error: "Current resume draft is required." });
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY is missing." });

    const systemPrompt = `You are a Career Coach applying requested improvements on top of an existing resume draft.
${sharedInstructions ? `=== SHARED INSTRUCTIONS ===\n${sharedInstructions}\n===========================` : `
RULES:
- Adhere strictly to verified facts only. Never hallucinate fake metrics.
- Keep standard ATS reverse-chronological format.`}

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
      if (!geminiRes.ok) throw new Error(data?.error?.message || "Gemini API error");

      let updatedResume = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n").trim();
      updatedResume = updatedResume.replace(/^```[a-z]*\n?/i, "").replace(/```$/g, "").trim();

      return send(res, 200, { updatedResume });
    } catch (err) {
      return send(res, 500, { error: "Improvement Error: " + err.message });
    }
  }

  // 4. LIVE JOBS API
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
      const apiRes = await fetch(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(searchKeyword)}&limit=8`);
      const data = await apiRes.json();

      let jobs = [];
      if (data && Array.isArray(data.jobs) && data.jobs.length > 0) {
        jobs = data.jobs.slice(0, 5).map(j => ({
          title: j.title,
          company: j.company_name,
          location: j.candidate_required_location || location || "Remote / US",
          workType: j.job_type ? j.job_type.replace("_", " ").toUpperCase() : workType || "Full-Time",
          salary: j.salary || "Competitive Market Rate",
          url: j.url,
          tags: Array.isArray(j.tags) && j.tags.length ? j.tags.slice(0, 5) : ["Engineering", "APIs"],
          snippet: stripHtml(j.description).slice(0, 200) + "..."
        }));
      }

      return send(res, 200, { jobs });
    } catch (e) {
      return send(res, 200, { jobs: [] });
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

    const systemInstructionText = `You are a Senior Technical Career Coach helping a candidate targeting '${role || "Software Engineer"}'.
${sharedInstructions ? `Adhere to instructions:\n${sharedInstructions}` : ""}
Current Resume:
${resume || "No resume provided yet"}
Provide concrete, actionable advice in Receipts Mode. Format cleanly with Markdown.`;

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
            generationConfig: { temperature: 0.3 }
          })
        }
      );

      const data = await geminiRes.json();
      if (!geminiRes.ok) throw new Error(data?.error?.message || "Gemini API error");

      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
      return send(res, 200, { text: text || "No response received from Gemini." });
    } catch (err) {
      return send(res, 500, { error: "Gemini Chat Error: " + err.message });
    }
  }

  send(res, 404, { error: "Not found" });
}).listen(PORT, "0.0.0.0", () => console.log(`Career Coach running at http://localhost:${PORT}`));