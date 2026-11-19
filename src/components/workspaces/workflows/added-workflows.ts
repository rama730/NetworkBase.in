"use client";

import { createContext, useContext } from "react";

/**
 * The workflows added to the open workspace, for parts deep in its tabs (the Documents rail's sections, report 38.3;
 * cards' type marks, 38.2 S5). Its own file so cards can read it without loading the realtime client.
 */
export const AddedWorkflowsContext = createContext<string[] | null>(null);
export const useAddedWorkflows = () => useContext(AddedWorkflowsContext) ?? [];
/** Null outside a workspace (My Work, search): there a card can't tell whether a type's workflow was hidden. */
export const useKnownWorkflows = () => useContext(AddedWorkflowsContext);
