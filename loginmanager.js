// loginmanager.js
import { getOrCreateChannel } from './statistics.js';

export function initLoginManager(onUserChanged) {
    document.addEventListener('DOMContentLoaded', () => {
        if (window.PIXELTubeAuth) {
            window.PIXELTubeAuth.onChange(async (user) => {
                try {
                    if (user) {
                        const channel = await getOrCreateChannel(user.uid, user.username);
                        window.PIXELTubeChannel = channel;
                        if (onUserChanged) onUserChanged(channel);
                    } else {
                        window.PIXELTubeChannel = null;
                        if (onUserChanged) onUserChanged(null);
                    }
                } catch (e) {
                    console.error("Auth manager failed to load channel:", e);
                    // Fallback: still render the user if possible
                    if (onUserChanged) onUserChanged({ name: user.username || 'User', avatarColor: '#333', uid: user.uid });
                }
            });
        }
    });
}