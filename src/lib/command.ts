import { spawn } from "node:child_process";

const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowNonZero?: boolean;
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_CAPTURE_BYTES) {
        child.kill("SIGKILL");
        reject(new Error(`${command} produced too much stdout`));
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_CAPTURE_BYTES) {
        child.kill("SIGKILL");
        reject(new Error(`${command} produced too much stderr`));
        return;
      }
      stderr.push(chunk);
    });

    child.once("error", reject);
    child.once("close", (code) => {
      const result: CommandResult = {
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };

      if (result.code !== 0 && !options.allowNonZero) {
        const detail = result.stderr.trim() || result.stdout.trim();
        reject(new Error(`${command} exited with ${result.code}${detail ? `: ${detail}` : ""}`));
        return;
      }

      resolve(result);
    });
  });
}
