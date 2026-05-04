# 📰 AI Newsroom

4-Agent Editorial Pipeline web app. Research → Writing → Fact-Check → Editorial.

## Setup

```bash
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000

## API Keys needed
- **Groq** (required): https://console.groq.com
- **NewsAPI** (optional): https://newsapi.org/register  
- **Unsplash** (optional): https://unsplash.com/developers

Keys are saved in browser localStorage — never sent to any server other than their respective APIs.

## Folder structure
```
ai-newsroom/
├── app.py              # Flask backend + all pipeline logic
├── requirements.txt
├── templates/
│   └── index.html      # Single-page HTML
└── static/
    ├── css/
    │   └── style.css   # Full black/grey/red theme
    └── js/
        └── main.js     # SSE pipeline runner + UI logic
```
