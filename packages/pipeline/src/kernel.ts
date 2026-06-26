// The seam between the TS web tier and the R compute kernel (ADR-0001, ADR-0012). Every kernel call
// goes through runRKernel: it resolves the script under services/kernel, ships the payload (piped on
// stdin, or written to a temp config file whose path is passed as argv[1] — the two conventions the
// kernels expect), checks the exit status, and parses stdout as JSON. Centralizing it means the
// eventual move from "Rscript subprocess" to a durable job queue is a change to this one module, not
// to the eight call sites it replaced.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { kernelDir } from "./paths";

/** Wall-clock ceiling for a single kernel subprocess (ms). A kernel that hangs (deadlocked Rscript,
 *  runaway REML) must fail loud rather than wedge the orchestrator. Override with KERNEL_TIMEOUT_MS. */
export const KERNEL_TIMEOUT_MS = Number(process.env.KERNEL_TIMEOUT_MS) || 120_000;

/** Thrown when a kernel subprocess fails to spawn, times out, or is killed by a signal — distinct from
 *  a clean non-zero exit (which carries the script's stderr). */
export class KernelProcessError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KernelProcessError";
  }
}

/** Absolute path to a kernel script by file name (e.g. 'analyze.R'). Resolved lazily from the repo
 *  root so it works under both the tsx CLI and the bundled Next.js server. */
export function kernelPath(name: string): string {
  return resolve(kernelDir(), name);
}

export interface RunKernelOpts {
  /** How the payload reaches the script: piped on stdin (default) or written to a temp config file
   *  whose path is passed as the first argument. Each kernel reads one or the other. */
  transport?: "stdin" | "cfg-file";
  /** Max stdout bytes to buffer (default 256 MiB — genomic blocks are large). */
  maxBuffer?: number;
}

/** Run an R kernel script and parse its JSON stdout. Throws with the script's stderr on a non-zero
 *  exit, or with a truncated stdout preview when the output is not JSON. */
export function runRKernel<T = unknown>(name: string, payload: unknown, opts: RunKernelOpts = {}): T {
  const script = kernelPath(name);
  const maxBuffer = opts.maxBuffer ?? 1 << 28;
  const json = JSON.stringify(payload);

  const timeout = KERNEL_TIMEOUT_MS;
  let proc;
  if (opts.transport === "cfg-file") {
    const cfg = join(tmpdir(), `verdant-${name.replace(/\.R$/, "")}.cfg.json`);
    writeFileSync(cfg, json);
    proc = spawnSync("Rscript", [script, cfg], { encoding: "utf8", maxBuffer, timeout });
  } else {
    proc = spawnSync("Rscript", [script], { input: json, encoding: "utf8", maxBuffer, timeout });
  }

  // Failed to spawn (e.g. Rscript not on PATH) or killed — surface as a typed process error. spawnSync
  // sets `error` on spawn failure and on timeout (with signal 'SIGTERM'); a clean non-zero exit does not.
  if (proc.error || proc.signal) {
    const timedOut =
      proc.signal === "SIGTERM" && (proc.error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT";
    const reason = timedOut
      ? `timed out after ${timeout} ms`
      : proc.signal
        ? `killed by ${proc.signal}`
        : String(proc.error);
    throw new KernelProcessError(`${name} ${reason}\n${proc.stderr ?? ""}`, { cause: proc.error });
  }
  if (proc.status !== 0) {
    throw new Error(`${name} failed (exit ${proc.status}):\n${proc.stderr}`);
  }
  try {
    return JSON.parse(proc.stdout) as T;
  } catch {
    throw new Error(`${name} did not return JSON:\n${proc.stdout.slice(0, 500)}\n${proc.stderr}`);
  }
}
