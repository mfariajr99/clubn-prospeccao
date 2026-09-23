// Builds the clickable demo as ONE self-contained HTML file:
//   dist-demo/demo.html      full document (open locally or host anywhere static)
//   dist-demo/artifact.html  same content without <html>/<head>/<body> wrappers (for hosts that add the skeleton)
import { execSync } from "node:child_process";
import fs from "node:fs";

execSync("npx vite build --config vite.demo.config.ts", { stdio: "inherit" });
const logo = `data:image/png;base64,${fs.readFileSync("public/logo-clubn.png").toString("base64")}`;
let html = fs.readFileSync("dist-demo/demo.html", "utf8").split("/logo-clubn.png").join(logo);
fs.writeFileSync("dist-demo/demo.html", html);
fs.rmSync("dist-demo/logo-clubn.png", { force: true });

// The inlined JS itself contains strings like "</head>", so slice by the LAST wrapper tags.
const head = html.slice(html.indexOf("<head>") + 6, html.lastIndexOf("</head>"));
const body = html.slice(html.lastIndexOf("<body>") + 6, html.lastIndexOf("</body>"));
const keptHead = head
  .replace(/<meta charset[^>]*>/i, "")
  .replace(/<meta name="viewport"[^>]*>/i, "");
fs.writeFileSync("dist-demo/artifact.html", `${keptHead.trim()}\n${body.trim()}\n`);
console.log("demo:", (fs.statSync("dist-demo/artifact.html").size / 1e6).toFixed(2), "MB");

// Multi-file version for static hosting (small page + app.js + app.css).
const art = fs.readFileSync("dist-demo/artifact.html", "utf8");
const jsStart = art.indexOf('<script type="module" crossorigin>') + '<script type="module" crossorigin>'.length;
const jsEnd = art.lastIndexOf("</script>");
const cssOpen = art.indexOf("<style", jsEnd);
const cssStart = art.indexOf(">", cssOpen) + 1;
const cssEnd = art.lastIndexOf("</style>");
fs.mkdirSync("dist-demo/site", { recursive: true });
fs.writeFileSync("dist-demo/site/app.js", art.slice(jsStart, jsEnd).split("preview-panel").join("lead-sheet"));
fs.writeFileSync("dist-demo/site/app.css", art.slice(cssStart, cssEnd));
fs.writeFileSync(
  "dist-demo/site/index.html",
  `<title>Club’n Prospecção</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="app.css">
<div id="root"></div>
<script type="module" src="app.js"></script>
`,
);
console.log("site: dist-demo/site/");
