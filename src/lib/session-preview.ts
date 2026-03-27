export const PREVIEW_RELOAD_SEARCH_PARAM = '__viba_preview_reload';

const stripPreviewReloadNonce = (previewUrl: string): string => {
    const trimmed = previewUrl.trim();
    if (!trimmed) {
        return '';
    }

    try {
        const parsed = new URL(trimmed);
        parsed.searchParams.delete(PREVIEW_RELOAD_SEARCH_PARAM);
        return parsed.toString();
    } catch {
        return trimmed;
    }
};

export const shouldForcePreviewRemount = (currentPreviewUrl: string, nextPreviewUrl: string): boolean => {
    const currentComparableUrl = stripPreviewReloadNonce(currentPreviewUrl);
    const nextComparableUrl = stripPreviewReloadNonce(nextPreviewUrl);

    return currentComparableUrl.length > 0
        && currentComparableUrl === nextComparableUrl;
};

export const buildPreviewReloadUrl = (previewUrl: string, nonce = Date.now()): string => {
    const parsed = new URL(previewUrl);
    parsed.searchParams.set(PREVIEW_RELOAD_SEARCH_PARAM, String(nonce));
    return parsed.toString();
};
