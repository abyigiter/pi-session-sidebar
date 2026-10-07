import { spawnSync } from "node:child_process";

// Keep a supervisor alive so tmux does not automatically resume its stopped direct child.
const result = spawnSync(process.argv[2], process.argv.slice(3), { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
