import { watch } from "chokidar";

import { computeDueScheduledRun, computeNextScheduledRun } from "./schedule";

import type { ReadingRecommenderService } from "./service";
import type { FSWatcher } from "chokidar";

const DEFAULT_SOURCE_DEBOUNCE_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_RETRY_COUNT = 3;

export type RecommendationAutomation = {
  readonly start: () => void;
  readonly stop: () => void;
};

export function createRecommendationAutomation(input: {
  readonly service: ReadingRecommenderService;
  readonly booksDbPath: string;
  readonly sourceDebounceMs?: number;
  readonly retryDelayMs?: number;
  readonly retryCount?: number;
}): RecommendationAutomation {
  const sourceDebounceMs = input.sourceDebounceMs ?? DEFAULT_SOURCE_DEBOUNCE_MS;
  const retryDelayMs = input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const retryCount = input.retryCount ?? DEFAULT_RETRY_COUNT;
  let started = false;
  let stopped = false;
  let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  let sourceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  let unsubscribeSettings: (() => void) | null = null;
  let unsubscribeClose: (() => void) | null = null;

  function clearScheduleTimer(): void {
    if (scheduleTimer) {
      clearTimeout(scheduleTimer);
      scheduleTimer = null;
    }
  }

  function clearSourceTimer(): void {
    if (sourceTimer) {
      clearTimeout(sourceTimer);
      sourceTimer = null;
    }
  }

  function sourcePaths(): readonly string[] {
    return [input.booksDbPath, `${input.booksDbPath}-wal`, `${input.booksDbPath}-shm`];
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async function runSourceChangedWithRetry(): Promise<void> {
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        await input.service.runIfSourceChanged();
        return;
      } catch {
        if (attempt === retryCount) {
          return;
        }
        await delay(retryDelayMs * (attempt + 1));
      }
    }
  }

  async function runDueScheduled(): Promise<void> {
    const scheduledFor = computeDueScheduledRun({
      settings: input.service.getSettings(),
      latestScheduledFor: input.service.getLatestScheduledFor()
    });

    if (scheduledFor) {
      await input.service.runScheduled(scheduledFor);
    }
  }

  function scheduleNextRun(): void {
    clearScheduleTimer();

    if (stopped) {
      return;
    }

    const scheduledFor = computeNextScheduledRun(input.service.getSettings());
    const delayMs = Math.max(0, Date.parse(scheduledFor) - Date.now());
    scheduleTimer = setTimeout(() => {
      void input.service.runScheduled(scheduledFor).finally(scheduleNextRun);
    }, delayMs);
  }

  function scheduleSourceChangedRun(): void {
    clearSourceTimer();

    if (stopped) {
      return;
    }

    sourceTimer = setTimeout(() => {
      void runSourceChangedWithRetry();
    }, sourceDebounceMs);
  }

  function stop(): void {
    stopped = true;
    clearScheduleTimer();
    clearSourceTimer();
    unsubscribeSettings?.();
    unsubscribeClose?.();
    unsubscribeSettings = null;
    unsubscribeClose = null;

    if (watcher) {
      void watcher.close();
      watcher = null;
    }
  }

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      stopped = false;
      unsubscribeSettings = input.service.onSettingsChanged(scheduleNextRun);
      unsubscribeClose = input.service.onClose(stop);
      void runDueScheduled().finally(scheduleNextRun);
      watcher = watch([...sourcePaths()], {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 2_000,
          pollInterval: 250
        }
      });
      watcher.on("all", scheduleSourceChangedRun);
    },

    stop
  };
}
