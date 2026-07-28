import { link, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function syncDirectory(directoryPath: string) {
  const directory = await open(directoryPath, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function atomicWrite(filePath: string, content: string) {
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const handle = await open(temporaryPath, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, filePath);
    await syncDirectory(dirname(filePath));
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function atomicCreate(filePath: string, content: string) {
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const handle = await open(temporaryPath, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporaryPath, filePath);
    await syncDirectory(dirname(filePath));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await rm(temporaryPath, { force: true });
    await syncDirectory(dirname(filePath));
  }
}

export class FileMutation {
  private originals = new Map<string, string | null>();

  private async capture(filePath: string) {
    if (this.originals.has(filePath)) return;
    try {
      this.originals.set(filePath, await readFile(filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.originals.set(filePath, null);
    }
  }

  async write(filePath: string, content: string) {
    await this.capture(filePath);
    await atomicWrite(filePath, content);
  }

  async remove(filePath: string) {
    await this.capture(filePath);
    await rm(filePath, { force: true });
    await syncDirectory(dirname(filePath));
  }

  async move(sourcePath: string, targetPath: string) {
    await this.capture(sourcePath);
    await this.capture(targetPath);
    await rename(sourcePath, targetPath);
    for (const directoryPath of new Set([dirname(sourcePath), dirname(targetPath)])) {
      await syncDirectory(directoryPath);
    }
  }

  async rollback() {
    const originals = [...this.originals.entries()].reverse();
    const errors: unknown[] = [];
    for (const [filePath, content] of originals) {
      try {
        if (content === null) {
          await rm(filePath, { force: true });
          await syncDirectory(dirname(filePath));
        } else {
          await atomicWrite(filePath, content);
        }
      } catch (error) {
        errors.push(error);
      }
    }
    this.originals.clear();
    if (errors.length > 0)
      throw new AggregateError(errors, "One or more files could not be restored.");
  }

  commit() {
    this.originals.clear();
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function rollbackAndRethrow(
  transaction: Pick<FileMutation, "rollback">,
  originalError: unknown,
): Promise<never> {
  try {
    await transaction.rollback();
  } catch (rollbackError) {
    throw new AggregateError(
      [originalError, rollbackError],
      `${errorMessage(originalError)} Rollback also failed: ${errorMessage(rollbackError)}`,
      { cause: originalError },
    );
  }
  throw originalError;
}
