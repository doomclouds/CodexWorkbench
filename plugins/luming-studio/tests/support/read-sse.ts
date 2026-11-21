export async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
  deadlineMs = 3000,
): Promise<string> {
  let cancellation: Promise<void | CancellationFailure> | undefined;
  const timeout = setTimeout(() => {
    cancellation = reader.cancel().catch((error: unknown) => ({ error }));
  }, deadlineMs);

  try {
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes(marker)) {
      const part = await reader.read();
      if (part.done) {
        break;
      }

      text += decoder.decode(part.value);
    }

    if (cancellation) {
      const failed = await cancellation;
      if (failed) {
        throw failed.error;
      }
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

interface CancellationFailure {
  error: unknown;
}
