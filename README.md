# Daily British English — for [cousin's name]

A simple two-page site:

- **index.html** — what your cousin uses. Pick a lesson → read/listen to sentences → tap underlined words for the meaning.
- **admin.html** — what YOU use. Record audio straight in the browser, write sentences, and export updated content files. Not linked from the student page — just open it directly when you want to add content.

## Folder structure

```
index.html          student-facing app
admin.html           your content tool
css/style.css        shared styling
js/app.js            student app logic
js/admin.js          admin tool logic
data/sentences.json  all lessons + sentences (edit this to add content)
data/dictionary.json all clickable word definitions
audio/                your recorded .webm files go here
```

## How to add new content (once it's live on GitHub)

1. Open `admin.html` on the live site (e.g. `yourusername.github.io/your-repo/admin.html`)
2. Record the sentence, type the Sentence ID first (e.g. `l04-s01`) so the filename matches
3. Save the audio file — it downloads to your computer
4. Fill in the English, Chinese, lesson, and clickable words, click "Add sentence to lesson"
5. Repeat for more sentences, then click "Download sentences.json"
6. In your GitHub repo: upload the new `.webm` file(s) into the `audio/` folder, and replace `data/sentences.json` with the one you just downloaded
7. Same process for dictionary words on the other tab → replace `data/dictionary.json`
8. Commit — the live site updates automatically within a minute or two

No coding needed for any of this — just recording, filling in forms, and dragging files into GitHub's website.
