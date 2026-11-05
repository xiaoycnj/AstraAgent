# Bundled browser dependencies

Versions are recorded in versions.json. Original license files are included in each package directory.

- Marked: https://marked.js.org/ (GFM parsing)
- DOMPurify: https://github.com/cure53/DOMPurify (sanitize Markdown HTML)
- KaTeX: https://katex.org/docs/supported (supported TeX syntax), https://katex.org/docs/options (trust=false)
- CodeMirror 5: https://codemirror.net/5/doc/manual.html (editor, modes and runMode)

These files are served locally. Runtime rendering does not request CDN assets. KaTeX supports its documented math subset, not every LaTeX package. Markdown remote images become links rather than loading automatically. HTML/SVG/JavaScript file previews are rendered as text and never executed.
