const MAX_APPEND = 400;

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(normalizeNewlines(text).slice(0, MAX_APPEND));
}

export type Edit =
  | { type: 'noop' }
  | { type: 'append'; text: string }
  | { type: 'backspace' }
  | { type: 'reject' };

/** Terminal edits only: append at the end, or delete the final code point. */
export function planEdit(sent: string, value: string): Edit {
  const next = normalizeNewlines(value);
  if (next === sent) return { type: 'noop' };
  if (next.startsWith(sent)) {
    const extra = next.slice(sent.length).slice(0, MAX_APPEND);
    if (!extra) return { type: 'noop' };
    return { type: 'append', text: extra };
  }
  if (sent.startsWith(next)) {
    const removed = Array.from(sent.slice(next.length));
    if (removed.length === 1) return { type: 'backspace' };
  }
  return { type: 'reject' };
}

export function applyIncoming(text: string, chunk: string): string {
  let out = text;
  for (const char of chunk) {
    if (char === '\b' || char === '\u007f') {
      const chars = Array.from(out);
      chars.pop();
      out = chars.join('');
      continue;
    }
    if (char === '\n' || char === '\t') {
      out += char;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (code < 32) continue;
    out += char;
  }
  const chars = Array.from(out);
  if (chars.length > 8000) return chars.slice(-8000).join('');
  return out;
}

export class ByteStreamDecoder {
  private decoder = new TextDecoder('utf-8', { fatal: false });

  reset(): void {
    this.decoder = new TextDecoder('utf-8', { fatal: false });
  }

  push(byte: number): string {
    return this.decoder.decode(new Uint8Array([byte]), { stream: true });
  }
}
