import { createCodexAppServerClient } from "../lib/codex-app-server-client.mjs";

const commandArgument = process.argv.find((value) => value.startsWith("--command="));
const command = commandArgument ? commandArgument.slice("--command=".length) : undefined;
const client = createCodexAppServerClient({ command });

try {
  const probe = await client.probe();
  const output = { probe };
  if (probe.ok) {
    const [threads, skills] = await Promise.all([
      client.listThreads({ limit: 100, archived: false }),
      client.listSkills({ forceReload: false })
    ]);
    output.capabilities = {
      activeThreadCount: Array.isArray(threads?.data) ? threads.data.length : 0,
      skillGroupCount: Array.isArray(skills?.data) ? skills.data.length : 0,
      skillCount: (Array.isArray(skills?.data) ? skills.data : []).reduce(
        (total, group) => total + (Array.isArray(group?.skills) ? group.skills.length : 0),
        0
      )
    };
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!probe.ok) process.exitCode = 2;
} finally {
  await client.close();
}
