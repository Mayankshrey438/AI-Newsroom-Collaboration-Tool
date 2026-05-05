import re
import requests
import os
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import json

app = Flask(__name__)

GROQ_MODEL   = "llama-3.3-70b-versatile"
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
NEWS_URL     = "https://newsapi.org/v2/everything"
UNSPLASH_URL = "https://api.unsplash.com/search/photos"
TOKEN_LIMIT  = 11_000

# ── API Keys (hardcoded — no user input required) ─────────────────────────────
GROQ_API_KEY     = "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"
NEWS_API_KEY     = "cdced59a457d4b4ba950a544509c3d8a"
UNSPLASH_API_KEY = "Ghuft0Zg18OyNbKYG93Sc1Xeo0JRRDFNV0M4qcNGW_c"
# ─────────────────────────────────────────────────────────────────────────────



def trim(text, max_chars):
    return text[:max_chars] + ("..." if len(text) > max_chars else "")

def call_groq(groq_key, system, user, max_tokens):
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {groq_key}"}
    payload = {
        "model": GROQ_MODEL,
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    r = requests.post(GROQ_URL, headers=headers, json=payload, timeout=60)
    if not r.ok:
        try:
            err = r.json().get("error", {}).get("message", r.text)
        except:
            err = r.text
        raise RuntimeError(f"Groq error ({r.status_code}): {err}")
    data   = r.json()
    tokens = data.get("usage", {}).get("total_tokens", max_tokens)
    return data["choices"][0]["message"]["content"], tokens

def fetch_news(idea):
    params = {"q": " ".join(idea.split()[:4]), "sortBy": "publishedAt",
              "pageSize": 3, "language": "en", "apiKey": NEWS_API_KEY}
    try:
        r    = requests.get(NEWS_URL, params=params, timeout=15)
        data = r.json()
        if data.get("status") != "ok" or not data.get("articles"):
            return "No recent articles found."
        lines = []
        for i, a in enumerate(data["articles"][:3], 1):
            date = (a.get("publishedAt") or "")[:10]
            lines.append(f"[{i}] {a['title']} — {a['source']['name']} ({date})")
        return "\n".join(lines)
    except Exception as e:
        return f"NewsAPI error: {e}"

def extract_confidence(text):
    m = re.search(r"confidence score[:\s]*(\d+)", text, re.IGNORECASE)
    return int(m.group(1)) if m else 75

def ai_keyword_agent(headline, tags, body_excerpt):
    """AI agent that picks the single best Unsplash search keyword."""
    tags_str = ", ".join(tags) if tags else "none"
    prompt = (
        f"You are an image search specialist for a news website.\n\n"
        f"Article headline: {headline}\n"
        f"Article tags: {tags_str}\n"
        f"Article excerpt: {body_excerpt[:300]}\n\n"
        f"Pick ONE single keyword or short phrase (2–3 words max) that will return "
        f"the most visually relevant and compelling photo on Unsplash for this article.\n"
        f"Rules:\n"
        f"- Prefer concrete visual subjects over abstract concepts\n"
        f"- Prefer the specific technology, person, place, or object the article is about\n"
        f"- If it's about AI, pick a more specific term (e.g. 'neural network', 'robot hand', 'data center')\n"
        f"- Do NOT include adjectives like 'latest', 'new', 'global'\n"
        f"- Reply with ONLY the keyword/phrase, nothing else."
    )
    try:
        keyword, _ = call_groq(
            GROQ_API_KEY,
            "You are a concise image search keyword specialist. Reply with only the keyword.",
            prompt,
            20,
        )
        return keyword.strip().strip('"').strip("'").strip()
    except Exception:
        # Fallback: first meaningful tag or headline word
        return tags[0] if tags else headline.split()[0]

def fetch_unsplash_image(keyword):
    params  = {"query": keyword, "per_page": 1, "orientation": "landscape",
                "content_filter": "high", "order_by": "relevant"}
    headers = {"Authorization": f"Client-ID {UNSPLASH_API_KEY}"}
    try:
        r       = requests.get(UNSPLASH_URL, headers=headers, params=params, timeout=15)
        results = r.json().get("results", [])
        if not results:
            return None
        img = results[0]
        return {
            "url":          img["urls"]["regular"],
            "thumb":        img["urls"]["small"],
            "photographer": img["user"]["name"],
            "profile":      img["user"]["links"]["html"],
        }
    except:
        return None

def emit(event, data):
    return f"data: {json.dumps({'event': event, **data})}\n\n"

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/run", methods=["GET"])
def run_pipeline():
    idea = request.args.get("idea", "").strip()

    if not idea:
        return jsonify({"error": "idea is required"}), 400

    def generate():
        total_tokens = 0
        try:
            yield emit("step", {"agent": "news", "status": "running", "label": "Fetching latest news headlines..."})
            news_ctx         = fetch_news(idea)
            news_ctx_trimmed = trim(news_ctx, 400)
            yield emit("step", {"agent": "news", "status": "done", "label": "News context fetched", "tokens": 0})

            yield emit("step", {"agent": "research", "status": "running", "label": "Research Agent analyzing topic..."})
            research_prompt = f"""News idea: "{trim(idea, 120)}"\n\nRecent headlines:\n{news_ctx_trimmed}\n\nOutput concisely:\n\nTopic: [category]\nKey Questions: [5 bullet questions]\nBackground: [1 short paragraph]\nTrends: [3 bullets]\nSources: [4 credible sources]"""
            research_out, t1 = call_groq(GROQ_API_KEY, "Senior research analyst. Be concise and factual.", research_prompt, 700)
            total_tokens += t1
            yield emit("step", {"agent": "research", "status": "done", "label": "Research Agent — complete", "output": research_out, "tokens": total_tokens})

            yield emit("step", {"agent": "writing", "status": "running", "label": "Writing Agent drafting article..."})
            writing_prompt = f"""News idea: "{trim(idea, 120)}"\n\nResearch notes:\n{trim(research_out, 700)}\n\nWrite a 400-word professional news article:\n\nHeadline: [compelling headline]\n\nArticle Body:\n[Strong intro hook]\n[Context paragraph]\n[Key developments — cite as "according to officials" or "analysts report"]\n[Conclusion & outlook]\n\nNeutral, factual tone. Max 400 words."""
            writing_out, t2 = call_groq(GROQ_API_KEY, "Award-winning journalist. Write concise, factual news.", writing_prompt, 750)
            total_tokens += t2
            yield emit("step", {"agent": "writing", "status": "done", "label": "Writing Agent — complete", "output": writing_out, "tokens": total_tokens})

            yield emit("step", {"agent": "factcheck", "status": "running", "label": "Fact-Check Agent validating claims..."})
            factcheck_prompt = f"""Fact-check this article briefly:\n\n{trim(writing_out, 900)}\n\nOutput:\nVerified Claims: [3 bullets]\nRisky Claims: [2 bullets]\nFixes: [2 bullets]\nConfidence Score: [0-100]%\nRationale: [1 sentence]"""
            factcheck_out, t3 = call_groq(GROQ_API_KEY, "Senior fact-checker. Be concise and precise.", factcheck_prompt, 550)
            confidence    = extract_confidence(factcheck_out)
            total_tokens += t3
            yield emit("step", {"agent": "factcheck", "status": "done", "label": f"Fact-Check — complete · Confidence: {confidence}%", "output": factcheck_out, "confidence": confidence, "tokens": total_tokens})

            yield emit("step", {"agent": "editorial", "status": "running", "label": "Editorial Agent polishing for publication..."})
            editorial_prompt = f"""Polish this article for publication.\n\nDraft:\n{trim(writing_out, 800)}\n\nFact-checker notes:\n{trim(factcheck_out, 400)}\n\nOutput EXACTLY:\n\nFinal Headline: [headline]\n\nFinal Article:\n[~400 words, add subheadings, apply fixes, no [Source X] placeholders]\n\nTags/Categories: [6 comma-separated tags]"""
            editorial_out, t4 = call_groq(GROQ_API_KEY, "Editor-in-Chief. Polish for publication. Be concise.", editorial_prompt, 650)
            total_tokens += t4
            yield emit("step", {"agent": "editorial", "status": "done", "label": "Editorial Agent — complete", "output": editorial_out, "tokens": total_tokens})

            h_match        = re.search(r"final headline[:\s]*(.+)", editorial_out, re.IGNORECASE)
            final_headline = h_match.group(1).strip().strip("*") if h_match else idea
            body_match     = re.search(r"final article[:\s]*([\s\S]+?)(?:\ntags|$)", editorial_out, re.IGNORECASE)
            final_body     = body_match.group(1).strip() if body_match else editorial_out
            tags_match     = re.search(r"tags[/\s]*categories[:\s]*(.+)", editorial_out, re.IGNORECASE)
            tags_raw       = tags_match.group(1).strip() if tags_match else ""
            tags           = [t.strip().strip("*") for t in re.split(r"[,;|]", tags_raw) if t.strip()][:6]

            # ── AI Keyword Agent ──────────────────────────────────────────────
            yield emit("step", {"agent": "image", "status": "running", "label": "AI Keyword Agent finding best photo keyword..."})
            image_keyword = ai_keyword_agent(final_headline, tags, final_body)
            photo         = fetch_unsplash_image(image_keyword)
            yield emit("step", {"agent": "image", "status": "done", "label": f"Photo fetched · AI keyword: '{image_keyword}'"})
            # ─────────────────────────────────────────────────────────────────

            yield emit("result", {
                "headline": final_headline, "body": final_body, "tags": tags,
                "confidence": confidence, "total_tokens": total_tokens,
                "image_keyword": image_keyword, "photo": photo,
                "research_out": research_out, "writing_out": writing_out,
                "factcheck_out": factcheck_out, "editorial_out": editorial_out,
            })
        except Exception as e:
            yield emit("error", {"message": str(e)})

    return Response(stream_with_context(generate()), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
