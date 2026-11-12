// ffmpeg argument builders and process helpers.

import { spawn } from 'node:child_process';

const num = (n) => String(Math.round(n * 1000) / 1000);

export function buildAssembleArgs({ video, segments, audios, srt, output, crf = 20 }) {
  const args = ['-y', '-i', video];
  audios.forEach((a) => args.push('-i', a.file));
  const srtIndex = srt ? 1 + audios.length : -1;
  if (srt) args.push('-i', srt);

  const parts = segments.map((s, i) => {
    const pts = s.speed === 1 ? 'PTS-STARTPTS' : `(PTS-STARTPTS)/${num(s.speed)}`;
    return `[0:v]trim=start=${num(s.from)}:end=${num(s.to)},setpts=${pts}[v${i}]`;
  });
  parts.push(`${segments.map((_, i) => `[v${i}]`).join('')}concat=n=${segments.length}:v=1:a=0[vout]`);
  if (audios.length) {
    audios.forEach((a, i) => parts.push(`[${i + 1}:a]adelay=${Math.round(a.at * 1000)}:all=1[a${i}]`));
    parts.push(`${audios.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audios.length}:duration=longest:normalize=0[aout]`);
  }
  args.push('-filter_complex', parts.join(';'));

  args.push('-map', '[vout]');
  if (audios.length) args.push('-map', '[aout]');
  if (srt) args.push('-map', `${srtIndex}:s`);
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', '25');
  if (audios.length) args.push('-c:a', 'aac', '-b:a', '160k');
  if (srt) args.push('-c:s', 'mov_text', '-metadata:s:s:0', 'language=spa');
  args.push('-movflags', '+faststart', output);
  return args;
}

export function run(cmd, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim().split('\n').slice(-5).join('\n')}`));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

export async function probeDuration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d)) throw new Error(`ffprobe: no duration for ${file}`);
  return d;
}
