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

http.createServer(async (req, res) => {
  // 1. SERVE FRONTEND
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const filePath = path.join(__dirname, "index.html");
    if (fs.existsSync(filePath)) {
      return send(res, 200, fs.readFileSync(filePath), "text/html");
    }
    return send(res, 404, { error: "index.html not found" });
  }

  // 2. LIVE DYNAMIC RESUME GENERATION (100% Gemini API - No Hardcoded Text)
  if (req.method === "POST" && req.url === "/api/generate-resumes") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, resume, motivation, timeline } = body;
    if (!role?.trim()) return send(res, 400, { error: "Target role is required." });
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY is missing in your .env file." });

    const systemPrompt = `You are an expert Executive Technical Career Coach and Resume Strategist operating in strict 'Receipts Mode'.
Generate 3 distinct, submission-ready, full-length resumes tailored specifically for the target role: '${role}'.

Strict Grounding Rules:
- If the candidate provided resume notes/projects, base every bullet strictly on their facts without inventing fake companies or degrees.
- If the candidate is building from scratch or provided minimal notes, draft a comprehensive, realistic resume for a candidate targeting '${role}' with career driver '${motivation || "New grad"}'.

You MUST structure your output using these EXACT 3 delimiters so the system can parse each option:
===OPTION 1===
[Full complete resume text for Option 1 - Focus on Deliverables, Scope, and Outcomes]
===OPTION 2===
[Full complete resume text for Option 2 - Focus on Technical Architecture, Engineering Depth, and System Design]
===OPTION 3===
[Full complete resume text for Option 3 - Focus on Clean, Modern, Concise Structure]`;

    const userContent = `TARGET ROLE: ${role}
MOTIVATION: ${motivation || "New grad"}
TIMELINE: ${timeline || "As soon as possible"}
CANDIDATE INPUT BACKGROUND:
${resume || "[Candidate starting from scratch / No existing resume provided]"}`;

    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userContent }] }],
            generationConfig: { temperature: 0.3 }
          }),
        }
      );

      const data = await geminiRes.json();
      if (!geminiRes.ok) throw new Error(data?.error?.message || "Gemini API error");

      const rawText = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");

      let opt1 = "", opt2 = "", opt3 = "";
      if (rawText.includes("===OPTION 1===")) {
        const parts = rawText.split(/===OPTION [123]===/);
        opt1 = (parts[1] || "").trim();
        opt2 = (parts[2] || "").trim();
        opt3 = (parts[3] || "").trim();
      } else {
        opt1 = rawText;
        opt2 = rawText;
        opt3 = rawText;
      }

      return send(res, 200, { option1: opt1, option2: opt2, option3: opt3 });
    } catch (err) {
      console.error("Gemini Resume Generation Failed:", err.message);
      return send(res, 500, { error: "Gemini Resume Generation Error: " + err.message });
    }
  }

  // 3. LIVE JOBS API (Real-Time Search)
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

  // 4. DYNAMIC AI COACH CHAT (100% Live Gemini API)
  if (req.method === "POST" && req.url === "/api/chat") {
    let raw = "";
    for await (const c of req) raw += c;
    let body = {};
    try { body = JSON.parse(raw); } catch {}

    const { role, resume, messages } = body;
    if (!KEY) return send(res, 500, { error: "GEMINI_API_KEY is not set in .env file." });
    if (!Array.isArray(messages) || !messages.length) return send(res, 400, { error: "No messages provided." });

    const systemInstructionText = `You are a Senior Technical Career Coach helping a candidate targeting '${role || "Software Engineer"}'.
Candidate Resume / Context:
${resume || "No resume provided yet"}

Guidelines:
- When asked technical questions (e.g. "explain kafka", "how does binary search work"), provide deep, accurate architectural explanations with code, trade-offs, and interview talking points.
- When asked career questions, provide concrete, actionable advice in Receipts Mode.
- Format cleanly with Markdown.`;

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
            generationConfig: { temperature: 0.4 }
          })
        }
      );

      const data = await geminiRes.json();
      if (!geminiRes.ok) throw new Error(data?.error?.message || "Gemini API error");

      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
      return send(res, 200, { text: text || "No response received from Gemini." });
    } catch (err) {
      console.error("Gemini Chat Error:", err.message);
      return send(res, 500, { error: "Gemini Chat Error: " + err.message });
    }
  }

  send(res, 404, { error: "Not found" });
}).listen(PORT, "0.0.0.0", () => console.log(`Career Coach running at http://localhost:${PORT}`));