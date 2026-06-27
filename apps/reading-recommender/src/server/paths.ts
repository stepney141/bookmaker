import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function findWorkspaceRoot(startDir: string): string {
  let current = startDir;

  while (current !== dirname(current)) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    current = dirname(current);
  }

  return resolve(startDir);
}

export function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_ROOT ? resolve(process.env.WORKSPACE_ROOT) : findWorkspaceRoot(process.cwd());
}

export function getBooksDbPath(): string {
  return process.env.BOOKS_DB_PATH ? resolve(process.env.BOOKS_DB_PATH) : join(getWorkspaceRoot(), "data/books.sqlite");
}

export function getAppDbPath(): string {
  return process.env.READING_RECOMMENDER_DB_PATH
    ? resolve(process.env.READING_RECOMMENDER_DB_PATH)
    : join(getWorkspaceRoot(), "data/reading-recommender.sqlite");
}

export function getClientDistPath(): string {
  return join(getWorkspaceRoot(), "apps/reading-recommender/dist/client");
}
