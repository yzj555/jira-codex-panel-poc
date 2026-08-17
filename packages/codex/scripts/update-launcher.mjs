import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";

const configPath = process.argv[2];
if (!configPath) process.exit(2);

let exitCode = 1;
try {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const executable = String(config?.executable || "");
  const args = Array.isArray(config?.args) ? config.args.map((value) => String(value)) : [];
  if (!executable || !args.length) {
    exitCode = 2;
  } else {
    const updater = spawn(executable, args, {
      windowsHide: true,
      stdio: "ignore"
    });
    exitCode = await new Promise((resolve) => {
      let settled = false;
      const finish = (code) => {
        if (settled) return;
        settled = true;
        resolve(code);
      };
      updater.once("error", () => finish(1));
      updater.once("exit", (code) => finish(Number.isInteger(code) ? code : 1));
    });
  }
} catch {
  exitCode = 1;
} finally {
  await rm(configPath, { force: true }).catch(() => {});
}

process.exitCode = exitCode;
