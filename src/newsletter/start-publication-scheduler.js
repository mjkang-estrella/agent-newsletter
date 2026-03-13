import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createPublicationScheduler,
  resolvePublicationScheduleFromRuntimeConfig,
} from "./publication-schedule.js";
import { DEFAULT_PUBLICATION_TASK_MODULE_PATH } from "./default-publication-task.js";
import { createNewsletterRuntimeConfig } from "./runtime-config.js";

export async function startPublicationScheduler({
  env = process.env,
  importTaskModule = loadPublicationTaskModule,
  createScheduler = createPublicationScheduler,
  logInfo = (...args) => console.info(...args),
  processRef = process,
} = {}) {
  const taskModulePath =
    env.NEWSLETTER_PUBLICATION_TASK_MODULE ?? DEFAULT_PUBLICATION_TASK_MODULE_PATH;
  const taskExportName = env.NEWSLETTER_PUBLICATION_TASK_EXPORT ?? "publishNewsletterEdition";
  const config = createNewsletterRuntimeConfig(env);
  const schedule = resolvePublicationScheduleFromRuntimeConfig(config);

  if (typeof importTaskModule !== "function") {
    throw new TypeError("importTaskModule must be a function");
  }

  if (typeof createScheduler !== "function") {
    throw new TypeError("createScheduler must be a function");
  }

  if (typeof logInfo !== "function") {
    throw new TypeError("logInfo must be a function");
  }

  if (
    !processRef ||
    typeof processRef.on !== "function" ||
    typeof processRef.exit !== "function"
  ) {
    throw new TypeError("processRef must expose on(signal, handler) and exit(code)");
  }

  const taskModule = await importTaskModule(taskModulePath);
  const publishNewsletterEdition = taskModule[taskExportName];

  if (typeof publishNewsletterEdition !== "function") {
    throw new TypeError(
      `${taskModulePath} must export a ${taskExportName} function for the publication scheduler`,
    );
  }

  const scheduler = createScheduler({
    schedule,
    publishNewsletterEdition,
  });

  const nextRunAt = scheduler.start();

  logInfo("Newsletter publication scheduler started.", {
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    nextRunAt,
  });

  const stop = () => {
    scheduler.stop();
    processRef.exit(0);
  };

  for (const signal of ["SIGINT", "SIGTERM"]) {
    processRef.on(signal, stop);
  }

  return {
    config,
    nextRunAt,
    schedule,
    scheduler,
    stop,
    taskExportName,
    taskModulePath,
  };
}

async function loadPublicationTaskModule(taskModulePath) {
  const moduleUrl = pathToFileURL(resolve(taskModulePath)).href;
  return import(moduleUrl);
}

function isExecutedDirectly() {
  return process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  await startPublicationScheduler();
}
