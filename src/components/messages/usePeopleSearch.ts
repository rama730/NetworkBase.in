"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { searchPeople } from "@/app/actions/chat/members";
import { queryKeys } from "@/lib/query-keys";

/**
 * People you may message, searched 250 ms after typing stops (2+ characters). `pending` is true
 * while the typed text hasn't been searched yet, so callers never flash "No people found".
 */
export function usePeopleSearch(query: string, enabled = true) {
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const result = useQuery({
    queryKey: queryKeys.chat.people(debounced.toLowerCase()),
    enabled: enabled && debounced.length >= 2,
    queryFn: async () => {
      const result = await searchPeople({ query: debounced });
      return result.success ? result.people : [];
    },
    staleTime: 60_000,
  });
  return { ...result, pending: query.trim() !== debounced || result.isFetching };
}
