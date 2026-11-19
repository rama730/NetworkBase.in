/**
 * A tiny square thumbnail of a workspace's cover for the sidebar and top bar (a 16–20px picture must not download the
 * full cover on every page). Public Supabase storage objects go through the image renderer; anything else is unchanged.
 */
export function coverThumbUrl(value: string, size = 64): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return value;
    }
    const source = '/object/public/', render = '/render/image/public/';
    if (url.pathname.includes(source)) url.pathname = url.pathname.replace(source, render);
    else if (!url.pathname.includes(render)) return value;
    url.searchParams.set('width', String(size));
    url.searchParams.set('height', String(size));
    url.searchParams.set('resize', 'cover');
    url.searchParams.set('quality', '75');
    return url.toString();
}
