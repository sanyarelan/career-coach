const http = require("http");
const fs = require("fs");
const path = require("path");

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const PORT = process.env.PORT || 8080;

const RULES = `You are a personalized, evidence-based Career Coach helping a candidate prepare for their target role.
HARD RULES:
- Use ONLY facts stated in the candidate's resume/profile. Never invent experience, metrics, employers, certifications, or technologies.
- If the resume lacks evidence for something, say "Missing evidence" rather than filling the gap.
- No job description is provided; hiring signals are INFERRED from the target role. Label them as inference.
- Tailor your strategy to their career motivation (e.g., 'New grad' = focus on framing foundational projects & growth potential; 'Better work-life balance' = focus on role scoping; 'A fresh start' = highlight transferable skills).
- Tailor urgency to their timeline (e.g., 'As soon as possible' = high-impact fast-track interview prep & 7-day quick sprints; 'Whenever I find the right fit' = high differentiation & deep skill development).
- If a resume bullet needs a number the candidate did not give, write "Metric needed" instead of inventing a number.

When first analyzing, address the candidate by name and produce these structured Markdown sections:
1) Inferred Hiring Decision Signals (Key screening filters for this role)
2) Evidence Map (Table: Signal | Evidence from Profile | Match Strength: Strong/Partial/Weak/Missing | Gap Analysis)
3) "Why You" Narrative Pitch (Tailored to their career driver & timeline, authentic proof points, biggest concern, and how to address it honestly)
4) 3 Defensible Resume Bullets (Action + Context + Skill + Deliverable), each with a Receipt Status (Verified / Metric needed) and the source line from their profile
5) Skill Gap Acceleration Roadmap (Estimated effort in hours, honest gap identification, free learning resources)
6) 2-Week Structured Interview Readiness Plan tailored to their timeline.

For follow-up questions, answer conversationally under the exact same guardrails.`;

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    return send(res, 200, fs.readFileSync(path.join(__dirname, "index.html")), "text/html");
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    let raw = "";
    for await (const c of req) {
      raw += c;
      if (raw.length > 200000) return send(res, 413, { error: "Input too long (limit ~200k characters)." });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "Invalid JSON." }); }
    
    const { username, motivation, timeline, role, resume, messages } = body;
    if (!role?.trim()) return send(res, 400, { error: "Target role is required." });
    if (!resume?.trim()) return send(res, 400, { error: "Resume / profile is required." });
    if (!Array.isArray(messages) || !messages.length) return send(res, 400, { error: "No messages." });
    if (!KEY || KEY.includes("your-real-key")) return send(res, 500, { error: "GEMINI_API_KEY is not set." });

    const candidateContext = `CANDIDATE NAME: ${username || "Candidate"}
PRIMARY MOTIVATION: ${motivation || "Explore new opportunities"}
TIMELINE: ${timeline || "Whenever I find the right fit"}
TARGET ROLE: ${role}
CANDIDATE RAW PROFILE:
${resume}`;

    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": KEY },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: `${RULES}\n\n${candidateContext}` }],
            },
            contents: messages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: String(m.content) }],
            })),
          }),
        }
      );
      const data = await r.json();
      if (!r.ok) {
        const msg = r.status === 429 ? "Rate limited. Wait a moment and retry." : data?.error?.message || "Gemini API error";
        return send(res, r.status, { error: msg });
      }
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
      if (!text) return send(res, 502, { error: "The model returned no text (it may have been blocked). Try rephrasing." });
      return send(res, 200, { text });
    } catch (e) {
      return send(res, 502, { error: "Could not reach the Gemini API: " + e.message });
    }
  }
  send(res, 404, { error: "Not found" });
}).listen(PORT, "0.0.0.0", () => console.log(`Career Coach running on port ${PORT}`));