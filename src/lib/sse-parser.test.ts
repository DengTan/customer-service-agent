import { describe, it, expect } from 'vitest';
import { parseSSEText, extractFinalFromSSEText, parseSSEStream, ParsedSSEChunk } from './sse-parser';

// Helper to build a ReadableStreamDefaultReader-like wrapper around
// an array of Uint8Array chunks. The reader mimics Web Streams semantics
// (stream: true decoder is the caller's responsibility; we just hand bytes).
function makeReader(chunks: Uint8Array[]): ReadableStreamDefaultReader<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return stream.getReader();
}

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('sse-parser: parseSSEStream chunk buffering', () => {
  it('reassembles a single data line split across two Uint8Array chunks', async () => {
    // Stream chunks split mid-JSON value. The whole `data: {...}` line must survive.
    const part1 = 'data: {"content":"hel';
    const part2 = 'lo"}\n';
    const done = 'data: {"done":true,"message_count":1}\n';

    const reader = makeReader([encodeUtf8(part1), encodeUtf8(part2), encodeUtf8(done)]);
    const result = await parseSSEStream(reader);

    expect(result.content).toBe('hello');
    expect(result.message_count).toBe(1);
    expect(result.hadError).toBe(false);
  });

  it('reassembles a done chunk split across two Uint8Array chunks', async () => {
    // The whole `{"done":true,"message_count":7,"timed_out":true}` JSON spans two chunks.
    const part1 = 'data: {"done":tr';
    const part2 = 'ue,"message_count":7,"timed_out":true}\n';

    const reader = makeReader([encodeUtf8(part1), encodeUtf8(part2)]);
    const result = await parseSSEStream(reader);

    expect(result.message_count).toBe(7);
    expect(result.timed_out).toBe(true);
  });

  it('preserves UTF-8 multi-byte chars split across Uint8Array chunks', async () => {
    // The character 你 is 3 bytes (E4 BD A0) in UTF-8. Split right in the middle.
    const part1 = encodeUtf8('data: {"content":"\u4f60'); // bytes for "你" minus last byte
    const part2 = encodeUtf8('"}\n'); // remaining byte of 你 + closing JSON + newline
    const reader = makeReader([part1, part2]);

    const result = await parseSSEStream(reader);

    expect(result.content).toBe('\u4f60'); // "你"
  });

  it('delivers every chunk via onChunk even when split across chunks', async () => {
    const chunksSeen: ParsedSSEChunk[] = [];
    const reader = makeReader([
      encodeUtf8('data: {"content":"a"}\n'),
      encodeUtf8('data: {"content":"b'),
      encodeUtf8('"}\n'),
      encodeUtf8('data: {"done":true,"message_count":2}\n'),
    ]);

    await parseSSEStream(reader, (chunk) => chunksSeen.push(chunk));

    // We should have observed three parsed chunks (two content + one done)
    expect(chunksSeen.length).toBe(3);
    expect(chunksSeen[0]?.content).toBe('a');
    expect(chunksSeen[1]?.content).toBe('b');
    expect(chunksSeen[2]?.done).toBe(true);
    expect(chunksSeen[2]?.message_count).toBe(2);
  });

  it('handles data lines split across many tiny chunks (one byte each)', async () => {
    const line = 'data: {"content":"x","done":true,"message_count":3}\n';
    const reader = makeReader(line.split('').map((c) => encodeUtf8(c)));

    const result = await parseSSEStream(reader);

    expect(result.content).toBe('x');
    expect(result.message_count).toBe(3);
  });

  it('does not call onChunk for partial lines that are not yet complete', async () => {
    // If a chunk ends mid-line, onChunk should not be invoked until the line completes.
    const reader = makeReader([
      encodeUtf8('data: {"content":"hel'), // incomplete
      encodeUtf8('lo"}\n'),
    ]);

    const calls: ParsedSSEChunk[] = [];
    const result = await parseSSEStream(reader, (c) => calls.push(c));

    expect(calls.length).toBe(1);
    expect(calls[0]?.content).toBe('hello');
    expect(result.content).toBe('hello');
  });

  it('preserves error chunk detection across chunk boundaries', async () => {
    // Error chunk split across chunks
    const reader = makeReader([
      encodeUtf8('data: {"content":"par'),
      encodeUtf8('tial"}\ndata: {"error":"处理失败"}\n'),
    ]);

    const result = await parseSSEStream(reader);

    expect(result.content).toBe('partial');
    expect(result.hadError).toBe(true);
    expect(result.error).toBe('处理失败');
  });

  it('returns empty defaults when reader is null', async () => {
    const result = await parseSSEStream(null);
    expect(result.content).toBe('');
    expect(result.hadError).toBe(false);
  });
});

describe('sse-parser: parseSSEStream AbortSignal', () => {
  it('throws AbortError synchronously when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort('user-canceled');
    const reader = makeReader([encodeUtf8('data: {"content":"x"}\n')]);

    try {
      await parseSSEStream(reader, undefined, controller.signal);
      throw new Error('expected throw');
    } catch (e) {
      // The thrown error must be an AbortError with name === 'AbortError'.
      // In browsers, throwIfAborted throws a DOMException with message equal
      // to signal.reason's message. In Node, it throws an AbortError whose
      // `.message` is the reason string. We accept either as long as the
      // shape carries the reason through.
      expect((e as Error).name).toBe('AbortError');
      expect((e as Error).message).toBe('user-canceled');
    }
  });

  it('throws AbortError with default message when signal has no reason', async () => {
    const controller = new AbortController();
    controller.abort();
    const reader = makeReader([encodeUtf8('data: {"content":"x"}\n')]);

    try {
      await parseSSEStream(reader, undefined, controller.signal);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error).name).toBe('AbortError');
    }
  });

  it('throws AbortError during the read loop if signal aborts after start', async () => {
    // Build a stream that emits one chunk then waits forever — controller will abort mid-read
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodeUtf8('data: {"content":"a"}\n'));
        // Never close; the reader.read() on next iteration will hang until the controller aborts
      },
    });
    const reader = stream.getReader();
    const abortController = new AbortController();

    // parseSSEStream registers a listener that cancels the reader when the
    // signal aborts, so the in-flight reader.read() resolves and the next
    // iteration's throwIfAborted fires.
    const promise = parseSSEStream(reader, undefined, abortController.signal);
    // Wait a tick so the first chunk is consumed and we're inside reader.read()
    await new Promise((resolve) => setTimeout(resolve, 5));
    abortController.abort('test-abort');

    try {
      await promise;
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error).name).toBe('AbortError');
      expect((e as Error).message).toBe('test-abort');
    }
  });
});

describe('sse-parser: extractFinalFromSSEText (regression)', () => {
  it('parses message_count and timed_out from a done chunk', () => {
    const sseText = [
      'data: {"content":"hello "}',
      'data: {"content":"world"}',
      'data: {"done":true,"message_count":7,"timed_out":true,"sources":[]}',
      '',
    ].join('\n');

    const result = extractFinalFromSSEText(sseText);

    expect(result.content).toBe('hello world');
    expect(result.message_count).toBe(7);
    expect(result.timed_out).toBe(true);
    expect(result.hadError).toBe(false);
  });

  it('tracks hadError and error when an error chunk is present without done', () => {
    const sseText = [
      'data: {"content":"partial"}',
      'data: {"error":"处理消息时发生错误"}',
      '',
    ].join('\n');

    const result = extractFinalFromSSEText(sseText);

    expect(result.content).toBe('partial');
    expect(result.hadError).toBe(true);
    expect(result.error).toBe('处理消息时发生错误');
    expect(result.message_count).toBeUndefined();
  });

  it('omits message_count when done chunk lacks the field', () => {
    const sseText = [
      'data: {"content":"ok"}',
      'data: {"done":true}',
      '',
    ].join('\n');

    const result = extractFinalFromSSEText(sseText);

    expect(result.content).toBe('ok');
    expect(result.message_count).toBeUndefined();
    expect(result.timed_out).toBeUndefined();
    expect(result.hadError).toBe(false);
  });

  it('keeps hadError false when only malformed lines are present', () => {
    const sseText = [
      'data: not-json',
      '',
      'data: {"content":"survives"}',
      '',
    ].join('\n');

    const result = extractFinalFromSSEText(sseText);

    expect(result.content).toBe('survives');
    expect(result.hadError).toBe(false);
  });
});

describe('sse-parser: parseSSEText (regression)', () => {
  it('preserves message_count and timed_out on chunk types', () => {
    const chunks = parseSSEText(
      [
        'data: {"content":"a"}',
        'data: {"done":true,"message_count":3,"timed_out":false}',
      ].join('\n'),
    );

    const doneChunk = chunks.find((c) => c.done);
    expect(doneChunk).toBeDefined();
    expect(doneChunk?.message_count).toBe(3);
    expect(doneChunk?.timed_out).toBe(false);
  });
});