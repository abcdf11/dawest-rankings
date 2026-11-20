import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const python = resolve(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
if (!existsSync(python)) {
  console.error(
    "Install backend-django/requirements.txt in the project .venv first.",
  );
  process.exit(1);
}
const env = {
  ...process.env,
  USE_SQLITE: process.env.USE_SQLITE ?? "1",
  USE_REDIS: process.env.USE_REDIS ?? "0",
};
const child = spawn(
  python,
  ["manage.py", "create_dev", ...process.argv.slice(2)],
  {
    cwd: resolve(root, "backend-django"),
    env,
    stdio: "inherit",
    windowsHide: true,
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
