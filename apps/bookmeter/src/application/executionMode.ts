/**
 * 実行モードを判別可能な型として表現する。
 * CLI のサブコマンドとフラグを実行計画へ正規化する。
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { BaseError, Err, Ok } from "../libs/lib";

import type { OutputFilePath } from "../db/dataLoader";
import type { Result } from "../libs/lib";
import type { Argv } from "yargs";

export const DEFAULT_BOOKMETER_USER_ID = "1003258";
export const BOOKMETER_TARGETS = ["wish", "stacked"] as const;
export type BookmeterTarget = (typeof BOOKMETER_TARGETS)[number];

export const REFETCH_SERVICES = ["biblio", "holdings", "description"] as const;
export type RefetchService = (typeof REFETCH_SERVICES)[number];

export const EXECUTION_PHASES = [
  "compare",
  "fetchBiblio",
  "crawlDescriptions",
  "persist",
  "exportCsv",
  "uploadDb"
] as const;

export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

export type ExecutionPhaseState = Readonly<Record<ExecutionPhase, boolean>>;

export type RemoteScrapeSource = {
  type: "remote";
  doLogin: boolean;
};

export type LocalCacheScrapeSource = {
  type: "local-cache";
};

export type ScrapeSource = RemoteScrapeSource | LocalCacheScrapeSource;

export type ExecutionMode =
  | {
      type: "sync";
      doLogin?: boolean;
    }
  | {
      type: "scrape";
      doLogin?: boolean;
    }
  | {
      type: "custom";
      scrape: ScrapeSource;
      enabledPhases: readonly ExecutionPhase[];
    };

type SharedOption = {
  refetch?: readonly RefetchService[];
  ignoreDiff?: boolean;
  userId?: string;
  outputFilePath?: OutputFilePath | null;
};

export type MainFuncOption = SharedOption & {
  target: BookmeterTarget;
  execution: ExecutionMode;
};

export type ParsedCliCommand =
  | {
      type: "run";
      option: MainFuncOption;
    }
  | {
      type: "help";
    };

export type ExecutionPlan = {
  refetch: ReadonlySet<RefetchService>;
  ignoreDiff: boolean;
  target: BookmeterTarget;
  userId: string;
  outputFilePath: OutputFilePath | null;
  modeName: ExecutionMode["type"];
  scrape: ScrapeSource;
  phases: ExecutionPhaseState;
};

export const CLI_SUBCOMMANDS = ["sync", "scrape", "enrich", "export"] as const;
export type CliSubcommand = (typeof CLI_SUBCOMMANDS)[number];

type ExecutionModeErrorContext =
  | {
      type: "invalidCustomMode";
      detail: string;
    }
  | {
      type: "invalidCliArgs";
      detail: string;
    };

export class ExecutionModeError extends BaseError {
  constructor(
    public readonly context: ExecutionModeErrorContext,
    options?: { cause?: unknown }
  ) {
    super(`Execution mode error [${context.type}]`, options);
  }
}

const NO_PHASES = createPhaseState([]);
const SYNC_PHASES = createPhaseState(EXECUTION_PHASES);
const EXPORT_PHASES = ["persist", "exportCsv", "uploadDb"] as const;
const ENRICH_PHASES = ["fetchBiblio", "crawlDescriptions", "persist", "exportCsv", "uploadDb"] as const;

function createPhaseState(enabledPhases: readonly ExecutionPhase[]): ExecutionPhaseState {
  const enabled = new Set(enabledPhases);

  return {
    compare: enabled.has("compare"),
    fetchBiblio: enabled.has("fetchBiblio"),
    crawlDescriptions: enabled.has("crawlDescriptions"),
    persist: enabled.has("persist"),
    exportCsv: enabled.has("exportCsv"),
    uploadDb: enabled.has("uploadDb")
  };
}

function validateCustomMode(mode: Extract<ExecutionMode, { type: "custom" }>): Result<void, ExecutionModeError> {
  const enabledPhases = new Set(mode.enabledPhases);

  if (enabledPhases.has("uploadDb") && !enabledPhases.has("persist")) {
    return Err(
      new ExecutionModeError({
        type: "invalidCustomMode",
        detail: "Custom execution mode with uploadDb requires persist"
      })
    );
  }

  return Ok(undefined);
}

function resolveNamedExecutionMode(mode: ExecutionMode): Result<
  {
    modeName: ExecutionMode["type"];
    scrape: ScrapeSource;
    phases: ExecutionPhaseState;
  },
  ExecutionModeError
> {
  switch (mode.type) {
    case "sync":
      return Ok({
        modeName: mode.type,
        scrape: { type: "remote", doLogin: mode.doLogin ?? true },
        phases: SYNC_PHASES
      });
    case "scrape":
      return Ok({
        modeName: mode.type,
        scrape: { type: "remote", doLogin: mode.doLogin ?? true },
        phases: NO_PHASES
      });
    case "custom": {
      const validationResult = validateCustomMode(mode);
      if (!validationResult.ok) {
        return validationResult;
      }

      return Ok({
        modeName: mode.type,
        scrape: mode.scrape,
        phases: createPhaseState(mode.enabledPhases)
      });
    }
  }
}

export function resolveExecutionPlan(option: MainFuncOption): Result<ExecutionPlan, ExecutionModeError> {
  const resolvedExecution = resolveNamedExecutionMode(option.execution);
  if (!resolvedExecution.ok) {
    return resolvedExecution;
  }

  return Ok({
    refetch: new Set(option.refetch ?? []),
    ignoreDiff: option.ignoreDiff ?? false,
    target: option.target,
    userId: option.userId ?? DEFAULT_BOOKMETER_USER_ID,
    outputFilePath: option.outputFilePath ?? null,
    modeName: resolvedExecution.value.modeName,
    scrape: resolvedExecution.value.scrape,
    phases: resolvedExecution.value.phases
  });
}

function isBookmeterTarget(value: string | undefined): value is BookmeterTarget {
  return value === "wish" || value === "stacked";
}

function configureTargetPositional<T>(parser: Argv<T>): Argv<T> {
  return parser.positional("target", {
    describe: "Target book list to process",
    choices: BOOKMETER_TARGETS
  });
}

function configureUserIdOption<T>(parser: Argv<T>): Argv<T> {
  return parser.option("user-id", {
    type: "string",
    description: "Override the default Bookmeter user ID"
  });
}

function configureNoLoginOption<T>(parser: Argv<T>): Argv<T> {
  return parser.option("login", {
    type: "boolean",
    default: true,
    description: "Log in to Bookmeter before scraping. Use --no-login to skip."
  });
}

function configureRefetchOption<T>(parser: Argv<T>): Argv<T> {
  return parser.option("refetch", {
    type: "array",
    choices: REFETCH_SERVICES,
    description: "Ignore cached data for selected services. Omit services to refetch all of them."
  });
}

function configureIgnoreDiffOption<T>(parser: Argv<T>): Argv<T> {
  return parser.option("ignore-diff", {
    type: "boolean",
    default: false,
    description: "Run downstream phases even when the scraped list matches the previous snapshot."
  });
}

function extractTarget(value: unknown): Result<BookmeterTarget, ExecutionModeError> {
  if (typeof value === "string" && isBookmeterTarget(value)) {
    return Ok(value);
  }

  return Err(
    new ExecutionModeError({
      type: "invalidCliArgs",
      detail: "Specify the target mode after the subcommand: wish | stacked"
    })
  );
}

function extractUserId(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function extractLogin(value: unknown): boolean {
  return value !== false;
}

function extractBooleanFlag(value: unknown): boolean {
  return value === true;
}

function isRefetchService(value: unknown): value is RefetchService {
  return typeof value === "string" && REFETCH_SERVICES.some((service) => service === value);
}

function extractRefetchSelection(value: unknown): readonly RefetchService[] {
  if (!Array.isArray(value)) {
    return [];
  }

  if (value.length === 0) {
    return [...REFETCH_SERVICES];
  }

  return value.filter(isRefetchService);
}

function buildExecutionModeFromSubcommand(
  subcommand: CliSubcommand,
  option: Readonly<{ doLogin?: boolean }>
): ExecutionMode {
  switch (subcommand) {
    case "sync":
      return { type: "sync", doLogin: option.doLogin };
    case "scrape":
      return { type: "scrape", doLogin: option.doLogin };
    case "export":
      return {
        type: "custom",
        scrape: { type: "local-cache" },
        enabledPhases: EXPORT_PHASES
      };
    case "enrich":
      return {
        type: "custom",
        scrape: { type: "local-cache" },
        enabledPhases: ENRICH_PHASES
      };
  }
}

export function parseCliArgs(argv: string[]): Result<ParsedCliCommand, ExecutionModeError> {
  let parsedOption: MainFuncOption | null = null;
  let parserError: ExecutionModeError | null = null;

  const captureOption = (subcommand: CliSubcommand, args: Readonly<Record<string, unknown>>): void => {
    const targetResult = extractTarget(args.target);
    if (!targetResult.ok) {
      parserError = targetResult.err;
      return;
    }

    parsedOption = {
      refetch: extractRefetchSelection(args.refetch),
      ignoreDiff: extractBooleanFlag(args.ignoreDiff),
      target: targetResult.value,
      userId: extractUserId(args.userId),
      execution: buildExecutionModeFromSubcommand(subcommand, {
        doLogin: extractLogin(args.login)
      })
    };
  };

  const parser = yargs(hideBin(argv))
    .scriptName("bookmeter")
    .parserConfiguration({
      "parse-numbers": false
    })
    .usage("$0 <command> <target> [options]")
    .command(
      "sync <target>",
      "Scrape the remote list and refresh all downstream artifacts",
      (command) =>
        configureIgnoreDiffOption(
          configureRefetchOption(configureNoLoginOption(configureUserIdOption(configureTargetPositional(command))))
        ).example("$0 sync wish --user-id 42", "Sync the wish list for user 42"),
      (args) => {
        captureOption("sync", args);
      }
    )
    .command(
      "scrape <target>",
      "Scrape the remote list without running any downstream phase",
      (command) =>
        configureNoLoginOption(configureUserIdOption(configureTargetPositional(command))).example(
          "$0 scrape wish --no-login",
          "Scrape the wish list without logging in first"
        ),
      (args) => {
        captureOption("scrape", args);
      }
    )
    .command(
      "enrich <target>",
      "Load the local snapshot, fill missing metadata and descriptions, then persist and export CSV",
      (command) =>
        configureRefetchOption(configureUserIdOption(configureTargetPositional(command))).example(
          "$0 enrich wish --refetch",
          "Refetch metadata and descriptions for every book in the local wish snapshot"
        ),
      (args) => {
        captureOption("enrich", args);
      }
    )
    .command(
      "export <target>",
      "Load the local snapshot and rebuild the SQLite/CSV/upload artifacts without remote enrichment",
      (command) =>
        configureUserIdOption(configureTargetPositional(command)).example(
          "$0 export wish",
          "Reuse the local wish snapshot and rebuild downstream artifacts"
        ),
      (args) => {
        captureOption("export", args);
      }
    )
    .demandCommand(1, `Specify a subcommand: ${CLI_SUBCOMMANDS.join(" | ")}`)
    .strict()
    .recommendCommands()
    .help()
    .wrap(100)
    .exitProcess(false)
    .fail((message, error) => {
      parserError =
        error instanceof ExecutionModeError
          ? error
          : new ExecutionModeError(
              {
                type: "invalidCliArgs",
                detail: message ?? error?.message ?? "Invalid CLI arguments"
              },
              { cause: error }
            );
    });

  try {
    const parsedArgv = parser.parseSync();

    if (parserError !== null) {
      return Err(parserError);
    }

    if (parsedOption !== null) {
      return Ok({ type: "run", option: parsedOption });
    }

    if (parsedArgv.help === true) {
      return Ok({ type: "help" });
    }

    return Err(
      new ExecutionModeError({
        type: "invalidCliArgs",
        detail: "No executable subcommand was provided"
      })
    );
  } catch (error) {
    return Err(
      error instanceof ExecutionModeError
        ? error
        : new ExecutionModeError({ type: "invalidCliArgs", detail: "Failed to parse CLI arguments" }, { cause: error })
    );
  }
}

export function hasDownstreamPhase(plan: ExecutionPlan): boolean {
  return (
    plan.phases.fetchBiblio ||
    plan.phases.crawlDescriptions ||
    plan.phases.persist ||
    plan.phases.exportCsv ||
    plan.phases.uploadDb
  );
}

export function needsBrowser(plan: ExecutionPlan): boolean {
  return plan.scrape.type === "remote" || plan.phases.crawlDescriptions;
}

export function describeExecutionPlan(plan: ExecutionPlan): string {
  const scrapeLabel = plan.scrape.type === "remote" ? `remote(login=${String(plan.scrape.doLogin)})` : "local-cache";
  const enabledPhases = EXECUTION_PHASES.filter((phase) => plan.phases[phase]);
  const refetchLabel = REFETCH_SERVICES.filter((service) => plan.refetch.has(service)).join("+") || "none";

  return `mode=${plan.modeName}, target=${plan.target}, refetch=${refetchLabel}, ignoreDiff=${String(plan.ignoreDiff)}, scrape=${scrapeLabel}, phases=${
    enabledPhases.length > 0 ? enabledPhases.join(" -> ") : "none"
  }`;
}
