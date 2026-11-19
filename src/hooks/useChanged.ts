import { useEffect, useRef } from "react";

/**
 * True on the render where `value` differs from the last one, never on the first. A count marked with it settles in once
 * when it changes (shell redesign), and doesn't animate on every page load.
 */
export function useChanged<T>(value: T): boolean {
    const previous = useRef(value);
    const changed = !Object.is(previous.current, value);
    useEffect(() => { previous.current = value; }, [value]);
    return changed;
}
