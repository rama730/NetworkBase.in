"use server";

import { type ApplicationRequestHistoryItem } from "@/app/actions/applications";
import { type ConnectionRequestHistoryItem, } from "@/app/actions/connections";

export type UnifiedRequestHistoryItem =
  | (ConnectionRequestHistoryItem & { source: "connection" })
  | (ApplicationRequestHistoryItem & { source: "application" });

