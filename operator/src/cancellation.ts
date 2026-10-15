export async function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, {once: true});
  });
  try {
    const result = await Promise.race([Promise.resolve().then(work), cancelled]);
    signal.throwIfAborted();
    return result;
  } finally {signal.removeEventListener('abort', abort);}
}
