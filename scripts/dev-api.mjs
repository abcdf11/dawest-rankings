import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const python = resolve(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
if (!existsSync(python)) {
  console.error(
    "Create the project .venv and install backend-django/requirements.txt first. See README.md.",
  );
  process.exit(1);
}
const env = {
  ...process.env,
  USE_SQLITE: process.env.USE_SQLITE ?? "1",
  USE_REDIS: process.env.USE_REDIS ?? "0",
  DJANGO_DEBUG: process.env.DJANGO_DEBUG ?? "1",
};
const cwd = resolve(root, "backend-django");
function run(args) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(python, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
}
const migrated = await run(["manage.py", "migrate", "--noinput"]);
if (migrated !== 0) process.exit(migrated);
const code = await run(["manage.py", "runserver", "127.0.0.1:8000"]);
process.exit(code);
