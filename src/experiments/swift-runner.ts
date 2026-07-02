import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Root of the packaged/dev app (dist/experiments/.. -> project root).
const NATIVE_DIR = path.join(__dirname, '..', '..', 'native');
const BIN_DIR = path.join(NATIVE_DIR, 'bin');

export interface SwiftResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], timeoutMs = 15000): Promise<SwiftResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException).code === 'number'
        ? Number((err as NodeJS.ErrnoException).code)
        : err
          ? 1
          : 0;
      resolve({ ok: !err, code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// Compile the helper once (or when its source changes) to a STABLE binary path.
// The stable path matters: macOS TCC (Accessibility) grants attach to the binary
// identity, so a per-run temp compile would need re-granting every time.
async function ensureCompiled(name: string): Promise<string> {
  const src = path.join(NATIVE_DIR, `${name}.swift`);
  const bin = path.join(BIN_DIR, name);
  if (!fs.existsSync(src)) throw new Error(`Swift source missing: ${src}`);
  fs.mkdirSync(BIN_DIR, { recursive: true });

  const fresh =
    fs.existsSync(bin) && fs.statSync(bin).mtimeMs >= fs.statSync(src).mtimeMs;
  if (fresh) return bin;

  const build = await run('/usr/bin/xcrun', ['swiftc', '-O', src, '-o', bin], 60000);
  if (!build.ok) {
    throw new Error(`swiftc failed for ${name}: ${build.stderr || build.stdout}`);
  }
  return bin;
}

export async function runSwiftHelper(name: string, args: string[]): Promise<SwiftResult> {
  try {
    const bin = await ensureCompiled(name);
    return await run(bin, args);
  } catch (err) {
    return {
      ok: false,
      code: -1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

export { BIN_DIR };
