// minis.js
export function renderMinisView(container, minis) {
    container.innerHTML = `
        <div class="minis-container">
            <div class="minis-header">
                <h2>Minis</h2>
                <span style="color:var(--text-dim); font-size:14px;">Swipe up to watch</span>
            </div>
            <div class="minis-grid">
                ${minis.map(m => `
                    <div class="mini-shorts-card" data-video="${m.id}">
                        <div class="mini-shorts-thumb" style="background-image: url('${m.thumbnail}')">
                            <div class="mini-shorts-overlay">
                                <span class="mini-shorts-title">${m.title}</span>
                                <span class="mini-shorts-views">${m.views}</span>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

export function setupMinisPlayer(videoUrl) {
    return `
        <div class="minis-player-wrapper">
            <video src="${videoUrl}" class="minis-video" autoplay loop controls playsinline></video>
        </div>
    `;
}