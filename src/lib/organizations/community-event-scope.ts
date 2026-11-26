import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * B5.3a security review: a community event is made only by saveCommunityEventAction, which checks hosts, times, the
 * pause and writes its link and limit beside it. The generic createTaskAction refuses a community event outside this
 * scope, and the Host-label exception applies only inside it.
 */
export const communityEventScope = new AsyncLocalStorage<true>();
