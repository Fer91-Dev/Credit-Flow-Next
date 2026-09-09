import fs from "node:fs";
const src = fs.readFileSync("components/configuracion/ConfigForm.tsx", "utf8").split("\n");
let tab = null, seccion = null;
const items = [];
const reTab = /\{activeTab === "([a-z]+)"/;
const reSec = /<Section\s+title="([^"]+)"/;
const reFld = /<Field[^>]*\blabel=(?:"([^"]+)"|\{`([^`]+)`\})/;
const reSwitch = /<(?:SwitchRow|NotifRow)\s*\n?\s*title="([^"]+)"/;
for (let i = 0; i < src.length; i++) {
  const l = src[i];
  const mt = l.match(reTab); if (mt) tab = mt[1];
  const ms = l.match(reSec); if (ms) seccion = ms[1];
  const mf = l.match(reFld);
  if (mf && tab && seccion) items.push({ label: (mf[1] || mf[2]).replace(/\$\{[^}]*\}/g, "…"), tab, seccion });
  const mw = l.match(/title="([^"]+)"/);
  if (mw && /SwitchRow|NotifRow/.test(src[i - 1] ?? "") && tab && seccion) items.push({ label: mw[1], tab, seccion });
}
const vistos = new Set();
const limpio = items.filter((x) => { const k = x.tab + "|" + x.label; if (vistos.has(k)) return false; vistos.add(k); return true; });
console.log(`parametros indexados: ${limpio.length}`);
const porTab = {};
for (const x of limpio) (porTab[x.tab] ??= []).push(x);
for (const [t, xs] of Object.entries(porTab)) console.log(`  ${t.padEnd(16)} ${xs.length}`);
fs.writeFileSync("scripts/_indice.json", JSON.stringify(limpio, null, 0), "utf8");
