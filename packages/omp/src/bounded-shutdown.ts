export async function boundedShutdownWait(
  operation: Promise<unknown>,
  milliseconds: number,
): Promise<void> {
  if (milliseconds <= 0) return;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
