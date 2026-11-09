/** The first-load skeleton only when there's data to wait for and none in memory yet (unified back B11). */
export function needsInitialSkeleton(wantsData: boolean, hasCachedData: boolean) {
  return wantsData && !hasCachedData;
}
