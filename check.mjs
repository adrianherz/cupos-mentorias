// Revisa las paginas publicas de TidyCal de cada mentor y guarda si el cupo esta agotado.
// Agotado = la pagina muestra "No hay fechas disponibles" en lugar del calendario.
// Para evitar falsos positivos, un cupo pasa a agotado solo tras 2 revisiones seguidas.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const LINKS = [
  { mentor: "Borja Rodríguez", programa: "league", url: "https://reservas.lemonfieldpartners.com/mentoria-40-league" },
  { mentor: "Borja Rodríguez", programa: "accelerator", url: "https://reservas.lemonfieldpartners.com/mentoria-40-plus-accelerator" },
  { mentor: "Eduardo Salado", programa: "league", url: "https://calendar.befocusy.com/mentoria-privada-40-plus-league" },
  { mentor: "Eduardo Salado", programa: "accelerator", url: "https://calendar.befocusy.com/mentoria-privada-40-plus-accelerator" },
  { mentor: "Melina Herzkovich", programa: "league", url: "https://schedule.vichvision.com/mentoria-privada-league" },
  { mentor: "Melina Herzkovich", programa: "accelerator", url: "https://schedule.vichvision.com/mentoria-privada-accelerator" },
  { mentor: "Cynthia Robotti", programa: "league", url: "https://tidycal.com/cynthiarobotti/mentoria-marca-personal-linkedin-40plus-league" },
  { mentor: "Cynthia Robotti", programa: "accelerator", url: "https://tidycal.com/cynthiarobotti/mentoria-marca-personal-linkedin" },
  { mentor: "René Zuleta", programa: "league", url: "https://tidycal.com/renezuleta/mentoria-league" },
  { mentor: "René Zuleta", programa: "accelerator", url: "https://tidycal.com/renezuleta/mentoria-accelerator" },
];
const SOLD_OUT = /no se encontraron fechas|no hay fechas disponibles|no dates available|no availability/i;
const STATUS_FILE = "status.json";
const CONFIRMACIONES = 2;

const prev = (() => { try { return JSON.parse(readFileSync(STATUS_FILE, "utf8")); } catch { return {}; } })();
const next = {};
const cambios = [];
mkdirSync("debug", { recursive: true });

const browser = await chromium.launch();
for (const l of LINKS) {
  const key = `${l.mentor}|${l.programa}`;
  const old = prev[key] ?? { estado: "disponible", racha: 0 };
  let lectura = "desconocido";
  try {
    const page = await browser.newPage({ locale: "es-ES" });
    await page.goto(l.url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2500);
    const texto = await page.evaluate(() => document.body.innerText);
    const hayCalendario = (await page.locator("button:has-text('1'), [class*='calendar'], [class*='day']").count()) > 0;
    if (SOLD_OUT.test(texto)) lectura = "agotado";
    else if (hayCalendario) lectura = "disponible";
    await page.screenshot({ path: `debug/${l.programa}-${l.mentor.split(" ")[0]}.png`, fullPage: true });
    writeFileSync(`debug/${l.programa}-${l.mentor.split(" ")[0]}.txt`, texto.slice(0, 3000));
    await page.close();
  } catch (e) {
    console.error(key, "error:", e.message);
  }
  // Lectura desconocida: no cambia nada.
  let estado = old.estado, racha = old.racha;
  if (lectura === "desconocido") {
    console.log(key, "lectura desconocida, se mantiene", estado);
  } else if (lectura === estado) {
    racha = 0;
  } else {
    racha += 1;
    if (racha >= (lectura === "agotado" ? CONFIRMACIONES : 1)) { estado = lectura; racha = 0; cambios.push({ ...l, estado }); }
  }
  next[key] = { estado, racha, actualizado: new Date().toISOString(), lectura };
  console.log(key, "->", lectura, "| estado:", estado);
}
await browser.close();
writeFileSync(STATUS_FILE, JSON.stringify(next, null, 2) + "\n");

if (cambios.length && process.env.SLACK_WEBHOOK_URL) {
  const texto = cambios.map(c => `${c.estado === "agotado" ? "🔴 AGOTADO" : "🟢 Disponible"}: ${c.mentor} (${c.programa})`).join("\n");
  await fetch(process.env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: texto }) });
}
