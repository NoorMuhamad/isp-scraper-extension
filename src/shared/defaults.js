/** Settings the user can change in the side panel's Settings tab. */
export const DEFAULT_SETTINGS = {
  keywords: [
    "Internet Service Provider",
    "Internet Company",
    "Broadband Internet Provider",
    "Fiber Internet Provider",
    "Wireless Internet Provider",
    "Local ISP",
    "Internet Service Company",
  ],
  /** Listings opened per search. Google Maps lists roughly 100-120 at most. */
  maxPerSearch: 60,
  /** Pause after each listing, so the pace stays modest. */
  pauseBetweenPlacesMs: 1500,
  /** A search with no progress for this long is treated as stuck and retried. */
  stallTimeoutMs: 120000,
  /** Attempts per city+keyword before it is marked failed. */
  maxAttempts: 3,
  /** A listing collected within this many days is not opened again (it is still deduplicated). */
  refreshAfterDays: 30,
  schedule: { enabled: false, everyHours: 168 },
  sheet: { webhookUrl: "", token: "", sheetName: "ISPs", batchSize: 25 },
};

export const RUN_IDLE = { status: "idle", queue: [], current: null, totalTasks: 0, doneTasks: 0, newThisRun: 0 };
