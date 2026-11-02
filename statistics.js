import { fetchBunnyStats, saveBunnyStats } from './storage.js';
const DEFAULT_DB = { videos: {}, likes: {}, comments: {}, channels: {} };

export async function getDatabase() {
    const db = await fetchBunnyStats();
    if (!db) return { ...DEFAULT_DB };
    return { videos: db.videos || {}, likes: db.likes || {}, comments: db.comments || {}, channels: db.channels || {} };
}

export async function saveDatabase(db) { return await saveBunnyStats(db); }

export async function addVideoToDatabase(videoData) {
    const db = await getDatabase();
    db.videos[videoData.id] = videoData;
    await saveDatabase(db);
    return videoData;
}

export async function getOrCreateChannel(uid, username) {
    const db = await getDatabase();
    if (!db.channels[uid]) {
        db.channels[uid] = {
            uid, name: username || 'New Creator',
            avatarColor: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
            subscribers: 0, totalViews: 0
        };
        await saveDatabase(db);
    }
    return db.channels[uid];
}

export async function getVideoStats(videoId) {
    const db = await getDatabase();
    return { likes: db.likes[videoId] || 0, comments: db.comments[videoId] || [] };
}

export async function addLike(videoId) {
    const db = await getDatabase();
    db.likes[videoId] = (db.likes[videoId] || 0) + 1;
    await saveDatabase(db);
}

export async function addComment(videoId, user, text) {
    const db = await getDatabase();
    if (!db.comments[videoId]) db.comments[videoId] = [];
    db.comments[videoId].unshift({ id: 'c_' + Date.now(), user, text, time: 'Just now', color: '#ff6b6b' });
    await saveDatabase(db);
}