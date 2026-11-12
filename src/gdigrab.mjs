// Recorder "gdigrab": ego-browser drives the page, ffmpeg gdigrab grabs the page area of the screen.
// Pure helpers (region math, ffmpeg args, calibration) plus the launcher that runs src/ego-runner.mjs
// inside `ego-browser nodejs`.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CALIBRATION_COLOR } from './overlays.mjs';

const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Ego frame thickness on the right and bottom of the page, in physical pixels.
 * Measured on ego lite 0.6.2.7 maximized at 125 %: content x 308..1913 of 1920, y 59..1133 of 1140.
 */
export const EGO_FRAME_PX = 7;

/**
 * Physical-pixel rectangle of the page viewport on the desktop.
 * The content is anchored to the bottom-right corner of the window, inside a thin frame: ego puts a
 * vertical tab strip on the left, so the (outer - inner) / 2 rule for a symmetric border does not hold.
 * Width and height are rounded down to even numbers (libx264 + yuv420p).
 */
export function contentRegion({
  screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight, devicePixelRatio: dpr, frame = EGO_FRAME_PX,
}) {
  return {
    x: Math.round((screenX + outerWidth - innerWidth) * dpr) - frame,
    y: Math.round((screenY + outerHeight - innerHeight) * dpr) - frame,
    width: even(innerWidth * dpr),
    height: even(innerHeight * dpr),
  };
}

/** The visible window in physical pixels; the calibration grab searches inside it. */
export function windowArea({ screenX, screenY, outerWidth, outerHeight, devicePixelRatio: dpr }) {
  return {
    x: Math.round(screenX * dpr),
    y: Math.round(screenY * dpr),
    width: even(outerWidth * dpr),
    height: even(outerHeight * dpr),
  };
}

export function buildGdigrabArgs({ region, framerate = 25, drawMouse = true, output }) {
  return [
    '-y', '-f', 'gdigrab', '-framerate', String(framerate), '-draw_mouse', drawMouse ? '1' : '0',
    '-offset_x', String(region.x), '-offset_y', String(region.y), '-video_size', `${region.width}x${region.height}`,
    '-i', 'desktop',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', output,
  ];
}

/** One raw RGB24 frame of a desktop area written to stdout. */
export function buildFrameGrabArgs(area) {
  return [
    '-loglevel', 'error', '-f', 'gdigrab', '-offset_x', String(area.x), '-offset_y', String(area.y),
    '-video_size', `${area.width}x${area.height}`, '-i', 'desktop',
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ];
}

/**
 * Bounding box (even size) of the calibration color in an RGB24 frame, or null when it is not on screen
 * (window hidden, covered or unpainted). Needs at least 1 % of the area to match.
 */
export function detectRegion(buf, width, height, color = CALIBRATION_COLOR, tolerance = 40) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    let i = y * width * 3;
    for (let x = 0; x < width; x++, i += 3) {
      if (Math.abs(buf[i] - color.r) <= tolerance && Math.abs(buf[i + 1] - color.g) <= tolerance
        && Math.abs(buf[i + 2] - color.b) <= tolerance) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count < Math.max(100, width * height * 0.01)) return null;
  return { x: minX, y: minY, width: even(maxX - minX + 1), height: even(maxY - minY + 1) };
}

/** Raw CSS can be checked inside the page; ego selector syntaxes (@ref, loc=, text=, ...) cannot. */
export function isCssSelector(selector) {
  return !/^(@|ref=|text=|loc=|xpath=|css=)/.test(selector) && !/:has-text\(|:text-is\(|>>/.test(selector);
}

/**
 * PowerShell (P/Invoke) that shows and raises the hidden top-level window of an ego task space.
 * ego keeps Agent task-space windows hidden; only the space selected in its UI is shown.
 */
export function showWindowScript(title) {
  const t = title.replace(/'/g, "''");
  return `Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class NarrateWin {
  public delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EP f, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
$ids = @((Get-Process ego -ErrorAction SilentlyContinue).Id)
$found = New-Object System.Collections.ArrayList
[NarrateWin]::EnumWindows({ param($h, $l) $p = 0; [void][NarrateWin]::GetWindowThreadProcessId($h, [ref]$p)
  if ($ids -contains $p) { $sb = New-Object Text.StringBuilder 512; [void][NarrateWin]::GetWindowText($h, $sb, 512)
    if ($sb.ToString() -eq '${t}') { [void]$found.Add($h) } }
  $true }, [IntPtr]::Zero) | Out-Null
foreach ($h in $found) { [void][NarrateWin]::ShowWindow($h, 3); [void][NarrateWin]::SetForegroundWindow($h) }
Write-Output $found.Count`;
}

export const spaceNameFor = (narrationFile) => `narrate-${basename(narrationFile).replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-')}`;

/** Pipeline side: write the runner inputs, run `ego-browser nodejs` without a shell, stream its log. */
export async function recordGdigrab(job, log = () => {}) {
  if (process.platform !== 'win32') throw new Error('recorder gdigrab: Windows only (ffmpeg gdigrab)');
  const ttsPath = join(job.workDir, 'tts.json');
  if (!existsSync(ttsPath)) throw new Error(`${ttsPath} not found; run "narrate tts" first`);
  const inputPath = join(job.workDir, 'ego-input.json');
  const entryPath = join(job.workDir, 'ego-entry.mjs');
  const fwd = (p) => p.replace(/\\/g, '/');
  writeFileSync(inputPath, JSON.stringify({
    narrationPath: fwd(job.file),
    workDir: fwd(job.workDir),
    ttsPath: fwd(ttsPath),
    spaceName: spaceNameFor(job.file),
    ffmpeg: process.env.NARRATE_FFMPEG ?? 'ffmpeg',
  }, null, 2));
  const runner = new URL('./ego-runner.mjs', import.meta.url).href;
  writeFileSync(entryPath, `const { main } = await import(${JSON.stringify(runner)});\nawait main(${JSON.stringify(fwd(inputPath))});\n`);

  const egoBin = process.env.NARRATE_EGO_BROWSER ?? 'ego-browser';
  const code = `await import('${pathToFileURL(entryPath).href}')`;
  const tail = [];
  const exit = await new Promise((resolve, reject) => {
    const child = spawn(egoBin, ['nodejs', '-e', code], { windowsHide: true });
    const onData = (d) => {
      for (const line of String(d).split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 12) tail.shift();
        log(line);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => reject(new Error(`${egoBin}: ${e.message}`)));
    child.on('close', resolve);
  });
  if (exit !== 0) throw new Error(`ego-browser exited ${exit}; last lines:\n${tail.slice(-3).join('\n')}`);
  const marks = JSON.parse(readFileSync(join(job.workDir, 'scenes.json'), 'utf8'));
  if (marks.recorder !== 'gdigrab') throw new Error('ego runner finished without writing scenes.json');
  return { videoPath: join(job.workDir, marks.video), marks: marks.scenes };
}
