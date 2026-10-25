// Build de Vercel (vercel.json → buildCommand): copia el sitio a dist/ y
//  1. agrega ?v=<commit> a los .css y .js propios de cada página, así se pueden cachear un año (vercel.json)
//  2. en index.html mete site.css y config.js adentro del <head>: el primer dibujo no espera ninguna descarga.
// Sin build (abriendo los archivos tal cual) el sitio funciona igual.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, ".."), OUT = path.join(ROOT, "dist");
const AFUERA = new Set([".git", ".github", ".vercel", "node_modules", "dist", "scripts", "supabase", "README.md", "vercel.json", ".gitignore"]);
const V = (process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36)).slice(0, 10);

fs.rmSync(OUT, { recursive: true, force: true });
for (const f of fs.readdirSync(ROOT)) {
  if (AFUERA.has(f) || /^[^/]+\.png$/.test(f)) continue; // las capturas sueltas de la raíz no se publican
  fs.cpSync(path.join(ROOT, f), path.join(OUT, f), { recursive: true });
}

const leer = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const css = leer("css/site.css")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/url\((["']?)\.\.\//g, "url($1") // desde index.html las rutas ya no arrancan en css/
  .replace(/\n\s*/g, "\n");
const config = leer("js/config.js");

for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith(".html"))) {
  let h = fs.readFileSync(path.join(OUT, f), "utf8");
  if (f === "index.html") {
    h = h.replace('<script src="js/config.js"></script>', () => `<script>${config}</script>`)
         .replace('<link rel="stylesheet" href="css/site.css">', () => `<style>${css}</style>`);
  }
  h = h.replace(/(src|href)="(\/?(?:js|css)\/[^"?#]+\.(?:js|css))"/g, (_, a, u) => `${a}="${u}?v=${V}"`);
  fs.writeFileSync(path.join(OUT, f), h);
}
console.log(`dist/ listo (v=${V})`);
