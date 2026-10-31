/** `report.pdf` version 3 saves as `report.v3.pdf`, so the file still opens with its usual app. */
export function versionedFilename(name: string, version: number) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}.v${version}${name.slice(dot)}` : `${name}.v${version}`;
}
