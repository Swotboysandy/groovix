export const JAM_LINK_PREFIX = 'groovix://';

export function createJamInviteLink(roomCode: string): string {
    return `${JAM_LINK_PREFIX}jam/${encodeURIComponent(roomCode.trim().toUpperCase())}`;
}
