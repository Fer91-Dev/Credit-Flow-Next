// Detecta la región del pooler de Supabase probando el handshake de Postgres
// vía IPv4 contra cada región. No usa dependencias externas (solo 'net').
const net = require("net");

const PROJECT_REF = "klxncemyxugoltdriguv";
const USER = `postgres.${PROJECT_REF}`;

const REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-central-2", "eu-north-1",
  "ap-south-1", "ap-southeast-1", "ap-southeast-2",
  "ap-northeast-1", "ap-northeast-2", "ap-northeast-3",
  "sa-east-1", "ca-central-1",
];
const PREFIXES = ["aws-0", "aws-1"];

function buildStartup(user) {
  const params = `user\0${user}\0database\0postgres\0\0`;
  const pbuf = Buffer.from(params, "utf8");
  const buf = Buffer.alloc(8 + pbuf.length);
  buf.writeInt32BE(buf.length, 0);
  buf.writeInt32BE(196608, 4); // protocol 3.0
  pbuf.copy(buf, 8);
  return buf;
}

function probe(host, port = 6543) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      resolve(result);
    };
    sock.setTimeout(4000);
    sock.on("timeout", () => finish({ host, status: "timeout" }));
    sock.on("error", (e) => finish({ host, status: "error", detail: e.code || e.message }));
    sock.connect(port, host, () => {
      sock.write(buildStartup(USER));
    });
    sock.on("data", (data) => {
      const type = String.fromCharCode(data[0]);
      const body = data.toString("utf8");
      if (type === "R") {
        // Authentication request -> tenant existe en esta región
        finish({ host, port, status: "TENANT_OK" });
      } else if (type === "E") {
        if (/not found/i.test(body)) {
          // "tenant/user ... not found" => región equivocada
          finish({ host, status: "wrong_region" });
        } else {
          // Otro error (p.ej. pide password/SSL/auth) => tenant reconocido
          finish({ host, port, status: "TENANT_OK", note: body.replace(/[^\x20-\x7e]/g, " ").trim().slice(0, 80) });
        }
      } else {
        finish({ host, status: "unknown", type });
      }
    });
  });
}

(async () => {
  const candidates = [];
  for (const p of PREFIXES) {
    for (const r of REGIONS) {
      candidates.push(`${p}-${r}.pooler.supabase.com`);
    }
  }
  console.log(`Probando ${candidates.length} hosts de pooler...\n`);
  for (const host of candidates) {
    const res = await probe(host);
    if (res.status === "TENANT_OK") {
      console.log(`✅ ENCONTRADO: ${res.host}:${res.port}`);
      if (res.note) console.log(`   nota: ${res.note}`);
      process.exit(0);
    }
  }
  console.log("❌ No se encontró la región. Revisar manualmente en el dashboard.");
  process.exit(1);
})();
