import { spawn } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const children = [];
let closing = false;
async function healthy(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(900) })).ok;
  } catch {
    return false;
  }
}
function stop() {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === "win32")
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else child.kill("SIGTERM");
  }
}
function start(script, args = [], cwd = root) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop();
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    if (!closing && code) {
      stop();
      process.exitCode = code;
    }
  });
  return child;
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
if (!(await healthy("http://127.0.0.1:8000/api/v1/auth/session/"))) {
  start(resolve(root, "scripts/dev-api.mjs"));
  let ready = false;
  for (let i = 0; i < 40 && !closing; i++) {
    if (await healthy("http://127.0.0.1:8000/api/v1/auth/session/")) {
      ready = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready) {
    console.error(
      "The Django account service did not start. Check the backend output above.",
    );
    stop();
    process.exitCode = 1;
  }
}
if (!closing) {
  console.log("DaWest database and accounts: http://127.0.0.1:8000");
  if (!(await healthy("http://127.0.0.1:5173/")))
    start(
      resolve(root, "node_modules/vite/bin/vite.js"),
      ["--host", "127.0.0.1"],
      resolve(root, "frontend"),
    );
  else console.log("Using existing frontend: http://127.0.0.1:5173");
}
