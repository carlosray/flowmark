export async function reloadWithMinimumFeedback(
  reload: () => Promise<void>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  minimumMilliseconds = 350,
) {
  const minimumFeedback = wait(minimumMilliseconds);

  try {
    await reload();
  } finally {
    await minimumFeedback;
  }
}
